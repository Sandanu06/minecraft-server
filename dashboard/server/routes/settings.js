import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../config.js';
import { HttpError, audit, withOp, exists } from '../util.js';
import { readProps, writeProps, readRuntime, writeRuntime, parseNbt, worldInfo } from '../mc.js';
import { createBackup } from '../backups.js';
import { restartMc, startMc, inspectMc } from '../docker.js';
import { live, refreshNow } from '../collector.js';
import { changePassword } from '../auth.js';

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
    return {
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

  app.post('/api/account/password', async (req) => {
    await changePassword(req.user, req.body?.current, req.body?.next);
    await audit(req, 'account.password');
    return { ok: true };
  });
}
