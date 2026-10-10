import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from './config.js';
import { HttpError, readJson, writeFileAtomic, stripColors } from './util.js';
import { rconExec } from './rcon.js';
import { ensureNetwork, inspectMc } from './docker.js';

/* ---------- server.properties ---------- */
export async function readProps() {
  let text = '';
  try { text = await fsp.readFile(paths.props(), 'utf8'); } catch { /* first boot */ }
  const props = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) props[line.slice(0, i)] = line.slice(i + 1).replace(/\r$/, '');
  }
  return { text, props };
}

export async function writeProps(changes) {
  const { text } = await readProps();
  const lines = text.split('\n');
  const left = { ...changes };
  const out = lines.map((line) => {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) {
      const k = line.slice(0, i);
      if (k in left) { const v = left[k]; delete left[k]; return `${k}=${v}`; }
    }
    return line;
  });
  for (const [k, v] of Object.entries(left)) out.splice(out.length - 1, 0, `${k}=${v}`);
  await writeFileAtomic(paths.props(), out.join('\n'));
}

/* ---------- runtime config shared with the container entrypoint ---------- */
export const defaultRuntime = { version: '', initMemory: '512M', maxMemory: '2G', jvmPreset: 'aikar' };
export const readRuntime = async () => ({ ...defaultRuntime, ...(await readJson(paths.runtime(), {})) });
export async function writeRuntime(patch) {
  const next = { ...(await readRuntime()), ...patch };
  await writeFileAtomic(paths.runtime(), JSON.stringify(next, null, 2));
  return next;
}

/* ---------- RCON ---------- */
export async function rcon(command) {
  const { props } = await readProps();
  if (props['enable-rcon'] !== 'true' || !props['rcon.password']) {
    throw new HttpError(409, 'Remote console is not enabled on this server yet. It turns on after the Paper upgrade.');
  }
  const info = await inspectMc();
  if (!info.State?.Running) throw new HttpError(409, 'Server is offline');
  const call = async () => {
    const host = await ensureNetwork();
    if (!host) throw new HttpError(503, 'Cannot find the server on the network');
    return rconExec({ host, port: Number(props['rcon.port'] || 25575), password: props['rcon.password'], command });
  };
  try { return await call(); }
  catch (e) { if (e.status === 503) { await new Promise((r) => setTimeout(r, 400)); return call(); } throw e; }
}

/* ---------- parsed status readings ---------- */
export function parseList(out) {
  const m = stripColors(out).match(/There are (\d+) of a max of (\d+) players online:?\s*(.*)/s);
  if (!m) return { online: 0, max: 0, names: [] };
  return { online: Number(m[1]), max: Number(m[2]), names: m[3].split(',').map((s) => s.trim()).filter(Boolean) };
}
export function parseTps(out) {
  const nums = stripColors(out).split(':').slice(1).join(':').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!nums.length) return null;
  // Newer Paper prints 5s, 1m, 5m, 15m; older prints 1m, 5m, 15m.
  return Math.min(20, nums.length >= 4 ? nums[0] : nums[0]);
}
export function parseMspt(out) {
  const m = stripColors(out).match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export async function readNamedJson(name) { return readJson(path.join(config.mcData, name), []); }

/** The Minecraft version in use: the dashboard's setting, else what the container was started with. */
export async function currentVersion() {
  const { version } = await readRuntime();
  if (version) return version;
  try { return (await inspectMc()).Config?.Env?.find((e) => e.startsWith('MC_VERSION='))?.split('=')[1] || ''; } catch { return ''; }
}

export async function worldInfo() {
  const { props } = await readProps();
  const level = props['level-name'] || 'world';
  return { level, dir: path.join(config.mcData, level) };
}

/* ---------- minimal NBT reader (for the world's Minecraft version) ---------- */
export function parseNbt(buf) {
  let o = 0;
  const readers = {
    1: () => buf.readInt8(o++), 2: () => { const v = buf.readInt16BE(o); o += 2; return v; },
    3: () => { const v = buf.readInt32BE(o); o += 4; return v; },
    4: () => { const v = buf.readBigInt64BE(o); o += 8; return Number(v); },
    5: () => { const v = buf.readFloatBE(o); o += 4; return v; },
    6: () => { const v = buf.readDoubleBE(o); o += 8; return v; },
    7: () => { const n = buf.readInt32BE(o); o += 4 + n; return null; },
    8: () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; },
    9: () => { const t = buf.readInt8(o++); const n = buf.readInt32BE(o); o += 4; return Array.from({ length: n }, () => readers[t]()); },
    10: () => { const obj = {}; for (;;) { const t = buf.readInt8(o++); if (t === 0) return obj; const nl = buf.readUInt16BE(o); o += 2; const k = buf.toString('utf8', o, o + nl); o += nl; obj[k] = readers[t](); } },
    11: () => { const n = buf.readInt32BE(o); o += 4 + n * 4; return null; },
    12: () => { const n = buf.readInt32BE(o); o += 4 + n * 8; return null; },
  };
  const t = buf.readInt8(o++); const nl = buf.readUInt16BE(o); o += 2 + nl;
  return readers[t]();
}
