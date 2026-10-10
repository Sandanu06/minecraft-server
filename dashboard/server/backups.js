import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from './config.js';
import { HttpError, run, readJson, writeJson, audit, withOp } from './util.js';
import { rcon } from './mc.js';
import { live } from './collector.js';
import { startMc, stopMc } from './docker.js';

export const NAME_OK = /^[\w.\-]+\.tgz$/;
// Regenerable or noisy data that never needs to be backed up.
const EXCLUDES = ['./libraries', './versions', './cache', './logs', './crash-reports', './paper', './.trash', './.pre-restore-*', './.dashboard/installed.json.tmp'];
const PROTECTED = new Set(['libraries', 'versions', 'cache', 'logs', 'paper', '.dashboard', '.trash']);

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const resolveBackup = (name) => {
  if (!NAME_OK.test(name || '')) throw new HttpError(400, 'Invalid backup name');
  return path.join(config.backupDir, name);
};

export async function listBackups() {
  await fsp.mkdir(config.backupDir, { recursive: true });
  const files = (await fsp.readdir(config.backupDir)).filter((f) => NAME_OK.test(f));
  const out = await Promise.all(files.map(async (name) => {
    const st = await fsp.stat(path.join(config.backupDir, name));
    const kind = /-auto\.tgz$/.test(name) ? 'auto' : /pre-/.test(name) ? 'safety' : 'manual';
    return { name, size: st.size, created: st.mtime, kind };
  }));
  return out.sort((a, b) => new Date(b.created) - new Date(a.created));
}

export async function createBackup(label = 'manual', progress = () => {}) {
  await fsp.mkdir(config.backupDir, { recursive: true });
  const name = `minecraft-${stamp()}-${label}.tgz`.replace(/[^\w.\-]/g, '');
  const final = path.join(config.backupDir, name), tmp = `${final}.part`;
  const running = live.state === 'running';
  let saveOff = false;
  try {
    if (running) {
      try { progress('Pausing world saves'); await rcon('save-off'); saveOff = true; await rcon('save-all flush'); } catch { /* fall back to a live copy */ }
    }
    progress('Compressing the world');
    const args = ['-n', '10', 'tar', '-czf', tmp, '--warning=no-file-changed', ...EXCLUDES.flatMap((e) => ['--exclude', e]), '-C', config.mcData, '.'];
    try { await run('nice', args, { env: { ...process.env, GZIP: '-4' } }); }
    catch (e) { if (!/exited 1:/.test(e.message)) throw e; /* exit 1 = files changed while reading, still usable */ }
    await fsp.rename(tmp, final);
  } finally {
    await fsp.rm(tmp, { force: true });
    if (saveOff) { try { await rcon('save-on'); } catch { /* ignore */ } }
  }
  const st = await fsp.stat(final);
  return { name, size: st.size };
}

export async function pruneAuto(keep) {
  const autos = (await listBackups()).filter((b) => b.kind === 'auto');
  for (const b of autos.slice(keep)) await fsp.rm(path.join(config.backupDir, b.name), { force: true });
}

export async function restoreBackup(name, progress = () => {}) {
  const file = resolveBackup(name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Backup not found');
  progress('Checking the archive');
  const listing = (await run('tar', ['-tzf', file], { maxBuffer: 1 << 28 })).split('\n');
  if (!listing.some((l) => /^(\.\/)?[^/]+\/level\.dat$/.test(l))) throw new HttpError(400, 'This archive has no world (level.dat) in a known layout');
  progress('Taking a safety backup first');
  await createBackup('pre-restore', progress);
  const wasRunning = live.state === 'running' || live.state === 'starting';
  if (wasRunning) { progress('Stopping the server'); await stopMc(); }
  const holding = path.join(config.mcData, `.pre-restore-${stamp()}`);
  await fsp.mkdir(holding);
  const moved = [];
  try {
    progress('Moving current files aside');
    for (const entry of await fsp.readdir(config.mcData)) {
      if (PROTECTED.has(entry) || entry.startsWith('.pre-restore-')) continue;
      await fsp.rename(path.join(config.mcData, entry), path.join(holding, entry)); moved.push(entry);
    }
    progress('Restoring files');
    await run('tar', ['-xzf', file, '-C', config.mcData, '--no-same-owner']);
  } catch (e) {
    for (const entry of moved) { await fsp.rm(path.join(config.mcData, entry), { recursive: true, force: true }).catch(() => {}); await fsp.rename(path.join(holding, entry), path.join(config.mcData, entry)).catch(() => {}); }
    throw new HttpError(500, `Restore failed and was rolled back: ${e.message}`);
  } finally { if (wasRunning) { progress('Starting the server'); await startMc().catch(() => {}); } }
}

/* ---------- daily schedule ---------- */
const scheduleFile = () => paths.state('backup-schedule.json');
export const defaultSchedule = { enabled: true, hourUtc: 4, keep: 7, lastRunDay: '' };
export const getSchedule = async () => ({ ...defaultSchedule, ...(await readJson(scheduleFile(), {})) });
export const setSchedule = async (patch) => { const next = { ...(await getSchedule()), ...patch }; await writeJson(scheduleFile(), next); return next; };

// Restore leaves the replaced files in .pre-restore-*; drop them after a week.
async function cleanupHolding() {
  for (const entry of await fsp.readdir(config.mcData).catch(() => [])) {
    if (!entry.startsWith('.pre-restore-')) continue;
    const st = await fsp.stat(path.join(config.mcData, entry)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 7 * 864e5) await fsp.rm(path.join(config.mcData, entry), { recursive: true, force: true });
  }
}

export function startScheduler() {
  setInterval(() => cleanupHolding().catch(() => {}), 6 * 3600 * 1000).unref();
  setInterval(async () => {
    try {
      const s = await getSchedule(), now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (!s.enabled || s.lastRunDay === day || now.getUTCHours() < s.hourUtc) return;
      await setSchedule({ lastRunDay: day });
      await withOp('scheduled backup', async (progress) => { const b = await createBackup('auto', progress); await pruneAuto(s.keep); await audit(null, 'backup.auto', b.name); });
    } catch { /* busy or failing: retried tomorrow, visible in activity if it errors */ }
  }, 60000).unref();
}
