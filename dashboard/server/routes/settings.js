import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../config.js';
import { HttpError, audit, withOp, exists } from '../util.js';
import { readProps, writeProps, readRuntime, writeRuntime, parseNbt, worldInfo } from '../mc.js';
import { createBackup } from '../backups.js';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { restartMc, startMc, inspectMc } from '../docker.js';
import { live, refreshNow } from '../collector.js';

/* Editable server.properties keys with their validation. Port, RCON and online-mode stay locked on purpose. */
const SCHEMA = {
  motd: { t: 'text', max: 120 },
  'max-players': { t: 'int', min: 1, max: 200 },
  difficulty: { t: 'enum', values: ['peaceful', 'easy', 'normal', 'hard'] },
  gamemode: { t: 'enum', values: ['survival', 'creative', 'adventure', 'spectator'] },
  'force-gamemode': { t: 'bool' }, hardcore: { t: 'bool' }, pvp: { t: 'bool' },
  'allow-nether': { t: 'bool' }, 'allow-flight': { t: 'bool' }, 'enable-command-block': { t: 'bool' },
  'spawn-monsters': { t: 'bool' }, 'spawn-animals': { t: 'bool' }, 'spawn-npcs': { t: 'bool' },
  'generate-structures': { t: 'bool' }, 'white-list': { t: 'bool' }, 'enforce-whitelist': { t: 'bool' },
  'view-distance': { t: 'int', min: 3, max: 32 }, 'simulation-distance': { t: 'int', min: 3, max: 32 },
  'spawn-protection': { t: 'int', min: 0, max: 64 }, 'player-idle-timeout': { t: 'int', min: 0, max: 1440 },
  'op-permission-level': { t: 'int', min: 1, max: 4 }, 'max-world-size': { t: 'int', min: 1000, max: 29999984 },
  'entity-broadcast-range-percentage': { t: 'int', min: 10, max: 500 },
  'network-compression-threshold': { t: 'int', min: -1, max: 65535 },
};

function validate(key, value) {
  const s = SCHEMA[key];
  if (!s) throw new HttpError(400, `${key} cannot be changed here`);
  if (s.t === 'bool') return value === true || value === 'true' ? 'true' : 'false';
  if (s.t === 'int') { const n = Number(value); if (!Number.isInteger(n) || n < s.min || n > s.max) throw new HttpError(400, `${key} must be between ${s.min} and ${s.max}`); return String(n); }
  if (s.t === 'enum') { if (!s.values.includes(value)) throw new HttpError(400, `${key} must be one of ${s.values.join(', ')}`); return value; }
  return String(value).replace(/[\r\n]/g, ' ').slice(0, s.max);
}

const OPTIMIZED = { 'view-distance': '8', 'simulation-distance': '6', 'entity-broadcast-range-percentage': '80', 'network-compression-threshold': '256' };

/* Files the editor may touch (relative paths only, never outside the data volume). */
const FILE_OK = /^(server\.properties|bukkit\.yml|spigot\.yml|commands\.yml|help\.yml|permissions\.yml|config\/[\w.\-]+\.ya?ml|plugins\/[\w.\- ]+(\/[\w.\- ]+)*\.(ya?ml|json|properties|txt|toml|conf))$/;
function safeFile(rel) {
  rel = String(rel || '').replace(/^\/+/, '');
  if (!FILE_OK.test(rel) || rel.includes('..')) throw new HttpError(400, 'That file cannot be edited here');
  return { rel, abs: path.join(config.mcData, rel) };
}
async function walk(dir, base, out, depth = 0) {
  if (depth > 3 || !exists(dir)) return;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) await walk(path.join(dir, e.name), rel, out, depth + 1);
    else if (FILE_OK.test(rel) && !/\/(tmp|cache)\//.test(rel)) out.push(rel);
  }
}

/* Paper versions (cached) */
let verCache = { at: 0, list: [] };
async function paperVersions() {
  if (Date.now() - verCache.at < 10 * 60 * 1000 && verCache.list.length) return verCache.list;
  const res = await fetch('https://fill.papermc.io/v3/projects/paper', { headers: { 'User-Agent': config.modrinthUA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new HttpError(502, 'Could not reach the PaperMC download service');
  const data = await res.json();
  const list = Object.values(data.versions).flat();
  verCache = { at: Date.now(), list };
  return list;
}

/* Paper builds: the entrypoint boots the newest jar for the chosen version, so updating = downloading a newer jar. */
const jarDir = () => path.join(config.mcData, 'paper');
async function installedBuild(version) {
  const files = (await fsp.readdir(jarDir()).catch(() => [])).map((f) => f.match(new RegExp(`^paper-${version.replace(/\./g, '\\.')}-(\\d+)\\.jar$`))).filter(Boolean);
  return files.length ? Math.max(...files.map((m) => Number(m[1]))) : null;
}
let latestCache = { at: 0, version: '', data: null };
async function latestBuild(version) {
  if (latestCache.version === version && Date.now() - latestCache.at < 10 * 60 * 1000) return latestCache.data;
  const res = await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds/latest`, { headers: { 'User-Agent': config.modrinthUA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const j = await res.json(), d = j.downloads?.['server:default'];
  const data = d ? { id: j.id, channel: j.channel, name: d.name, url: d.url, sha256: d.checksums?.sha256 } : null;
  latestCache = { at: Date.now(), version, data };
  return data;
}

async function worldVersion() {
  try {
    const { dir } = await worldInfo();
    const nbt = parseNbt(zlib.gunzipSync(await fsp.readFile(path.join(dir, 'level.dat'))));
    return (nbt.Data || nbt).Version?.Name || null;
  } catch { return null; }
}

export default async function (app) {
  app.get('/api/settings', async () => {
    const { props } = await readProps();
    const values = {};
    for (const k of Object.keys(SCHEMA)) values[k] = props[k] ?? '';
    return { schema: SCHEMA, values, locked: { 'online-mode': props['online-mode'], 'server-port': props['server-port'], 'level-seed': props['level-seed'] || '' }, runtime: await readRuntime(), optimized: OPTIMIZED };
  });

  app.put('/api/settings', async (req) => {
    const changes = {};
    for (const [k, v] of Object.entries(req.body?.values || {})) changes[k] = validate(k, v);
    if (!Object.keys(changes).length) throw new HttpError(400, 'Nothing to save');
    await writeProps(changes);
    await audit(req, 'settings.update', Object.keys(changes).join(', '));
    return { ok: true, restartNeeded: true };
  });

  app.post('/api/settings/optimize', async (req) => {
    await writeProps(OPTIMIZED);
    await audit(req, 'settings.optimize');
    return { ok: true, applied: OPTIMIZED, restartNeeded: true };
  });

  app.put('/api/settings/runtime', async (req) => {
    const { initMemory, maxMemory, jvmPreset } = req.body || {};
    const toMb = (s) => (s.endsWith('G') ? parseInt(s) * 1024 : parseInt(s));
    const patch = {};
    for (const [k, v] of Object.entries({ initMemory, maxMemory })) {
      if (v === undefined) continue;
      if (!/^\d{2,5}[MG]$/.test(v)) throw new HttpError(400, 'Memory looks like 512M or 3G');
      patch[k] = v;
    }
    if (jvmPreset !== undefined) { if (!['aikar', 'default'].includes(jvmPreset)) throw new HttpError(400, 'Unknown JVM preset'); patch.jvmPreset = jvmPreset; }
    const merged = { ...(await readRuntime()), ...patch };
    if (toMb(merged.maxMemory) < toMb(merged.initMemory)) throw new HttpError(400, 'Max memory must be at least the starting memory');
    if (toMb(merged.maxMemory) > 6144) throw new HttpError(400, 'This machine is shared with other apps. Keep max memory at 6G or less.');
    await writeRuntime(patch);
    await audit(req, 'runtime.update', JSON.stringify(patch));
    return { ok: true, restartNeeded: true, runtime: merged };
  });

  /* ---- versions ---- */
  app.get('/api/versions', async () => {
    const [list, runtime, world, info] = await Promise.all([paperVersions(), readRuntime(), worldVersion(), inspectMc().catch(() => null)]);
    const envVersion = info?.Config?.Env?.find((e) => e.startsWith('MC_VERSION='))?.split('=')[1] || '';
    const version = runtime.version || envVersion;
    const [build, latest] = version ? await Promise.all([installedBuild(version), latestBuild(version).catch(() => null)]) : [null, null];
    return {
      build, latestBuild: latest ? { id: latest.id, channel: latest.channel } : null,
      buildUpdateAvailable: !!(build && latest && latest.id > build),
      software: info?.Config?.Image?.includes('paper') || runtime.version ? 'Paper' : 'Vanilla',
      current: runtime.version || envVersion, world,
      versions: list.map((v) => ({ id: v, preview: /rc|pre/i.test(v) })),
    };
  });

  app.post('/api/versions/switch', async (req) => {
    const target = String(req.body?.version || '');
    const [list, world] = await Promise.all([paperVersions(), worldVersion()]);
    if (!list.includes(target)) throw new HttpError(400, 'Paper does not publish that version');
    // The list is ordered newest first, so a lower index means newer. Worlds cannot be opened by older versions.
    const iT = list.indexOf(target), iW = world ? list.indexOf(world) : -1;
    if (iW !== -1 && iT > iW) throw new HttpError(409, `This world was last opened in ${world}. Going back to ${target} would corrupt it. Pick ${world} or newer.`);
    await withOp('version switch', async (progress) => {
      progress('Backing up before the switch');
      await createBackup(`pre-switch-${target}`.replace(/[^\w.\-]/g, ''), progress);
      await writeRuntime({ version: target });
      progress(`Restarting on ${target}`);
      if (live.state === 'stopped') await startMc(); else await restartMc();
      await refreshNow();
    });
    await audit(req, 'version.switch', target);
    return { ok: true };
  });

  app.post('/api/versions/update-build', async (req) => {
    const version = (await readRuntime()).version;
    if (!version) throw new HttpError(409, 'The server has not recorded its version yet');
    const latest = await latestBuild(version);
    const have = await installedBuild(version);
    if (!latest) throw new HttpError(502, 'Could not reach the PaperMC download service');
    if (have && latest.id <= have) throw new HttpError(409, 'Paper is already on the newest build');
    await withOp('paper update', async (progress) => {
      progress('Backing up before the update');
      await createBackup(`pre-paper-build-${latest.id}`, progress);
      progress(`Downloading build ${latest.id}`);
      await fsp.mkdir(jarDir(), { recursive: true });
      const tmp = path.join(jarDir(), `${latest.name}.part`);
      const res = await fetch(latest.url, { headers: { 'User-Agent': config.modrinthUA }, signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new HttpError(502, 'Download failed');
      await pipeline(res.body, fs.createWriteStream(tmp));
      const sum = crypto.createHash('sha256').update(await fsp.readFile(tmp)).digest('hex');
      if (latest.sha256 && sum !== latest.sha256) { await fsp.rm(tmp, { force: true }); throw new HttpError(502, 'Checksum mismatch, download discarded'); }
      await fsp.rename(tmp, path.join(jarDir(), latest.name));
      const jars = (await fsp.readdir(jarDir())).filter((f) => /^paper-.*\.jar$/.test(f));
      const stats = await Promise.all(jars.map(async (f) => ({ f, t: (await fsp.stat(path.join(jarDir(), f))).mtimeMs })));
      for (const old of stats.sort((a, b) => b.t - a.t).slice(2)) await fsp.rm(path.join(jarDir(), old.f), { force: true });
      progress('Restarting');
      if (live.state === 'stopped') await startMc(); else await restartMc();
      await refreshNow();
    });
    await audit(req, 'version.update-build', `${version} build ${latest.id}`);
    return { ok: true, build: latest.id };
  });

  /* ---- raw files ---- */
  app.get('/api/files', async () => {
    const out = [];
    for (const top of ['server.properties', 'bukkit.yml', 'spigot.yml', 'commands.yml', 'permissions.yml']) if (exists(path.join(config.mcData, top))) out.push(top);
    await walk(path.join(config.mcData, 'config'), 'config', out);
    await walk(path.join(config.mcData, 'plugins'), 'plugins', out);
    return { files: out };
  });
  app.get('/api/files/content', async (req) => {
    const { abs, rel } = safeFile(req.query.path);
    const st = await fsp.stat(abs).catch(() => { throw new HttpError(404, 'File not found'); });
    if (st.size > 1024 * 1024) throw new HttpError(413, 'File is too large to edit here');
    return { path: rel, content: await fsp.readFile(abs, 'utf8') };
  });
  app.put('/api/files/content', async (req) => {
    const { abs, rel } = safeFile(req.body?.path);
    const content = String(req.body?.content ?? '');
    if (content.length > 1024 * 1024) throw new HttpError(413, 'File is too large');
    if (exists(abs)) await fsp.copyFile(abs, `${abs}.bak`);
    await fsp.writeFile(abs, content);
    await audit(req, 'file.save', rel);
    return { ok: true, restartNeeded: true };
  });

}
