import { paths } from './config.js';
import { readJson, writeJson, dirSize, diskFree } from './util.js';
import { config } from './config.js';
import { findMc, inspectMc, statsMc } from './docker.js';
import { rcon, parseList, parseTps, parseMspt, readProps } from './mc.js';
import { emit } from './events.js';
import { audit } from './util.js';
import { reconcile } from './follower.js';

const SHORT = 720;   // 1 hour at 5s
const LONG = 1440;   // 24 hours at 1min
export const history = { short: [], long: [] };
export const live = { state: 'unknown', health: null, startedAt: null, restarts: 0, players: { online: 0, max: 0, names: [] }, tps: null, mspt: null, cpu: 0, cpuCores: 1, memUsed: 0, memLimit: 0, image: '', updatedAt: 0 };
export const disk = { world: 0, data: { total: 0, free: 0 }, backups: { total: 0, free: 0 } };

let tick = 0, longAcc = [], prevState = null, expectedStopAt = 0, lowTpsReadings = 0;
/** Called when the dashboard itself stops or restarts the server, so it is not reported as a crash. */
export const markExpectedStop = () => { expectedStopAt = Date.now(); };

async function poll() {
  tick++;
  try {
    const c = await findMc(true);
    if (!c) { live.state = 'missing'; return; }
    const info = await inspectMc();
    live.state = info.State.Running ? (info.State.Health?.Status === 'starting' ? 'starting' : 'running') : 'stopped';
    if (prevState === 'running' && live.state === 'stopped') {
      const expected = Date.now() - expectedStopAt < 180000;
      emit(expected ? 'stop' : 'crash', { exitCode: info.State.ExitCode });
      if (!expected) audit(null, 'server.stopped-unexpectedly', `exit code ${info.State.ExitCode}`);
    }
    if (live.state !== 'unknown') prevState = live.state;
    live.health = info.State.Health?.Status || null;
    live.startedAt = info.State.Running ? info.State.StartedAt : null;
    live.restarts = info.RestartCount || 0;
    live.image = info.Config?.Image || '';
    if (!info.State.Running) { Object.assign(live, { cpu: 0, memUsed: 0, tps: null, mspt: null, players: { ...live.players, online: 0, names: [] } }); }
    else {
      const s = await statsMc();
      if (s) Object.assign(live, s);
      if (tick % 3 === 1) {
        try {
          const [list, tps, mspt] = await Promise.all([rcon('list'), rcon('tps').catch(() => ''), rcon('mspt').catch(() => '')]);
          live.players = parseList(list);
          reconcile(live.players.names).catch(() => {});
          live.tps = parseTps(tps);
          lowTpsReadings = live.tps != null && live.tps < 15 ? lowTpsReadings + 1 : 0;
          if (lowTpsReadings === 3) emit('lag', { tps: live.tps });
          live.mspt = parseMspt(mspt);
        } catch { /* RCON may be off or the server still booting */ }
      }
    }
    live.updatedAt = Date.now();
    const point = { t: Date.now(), cpu: live.cpu, mem: live.memUsed, players: live.players.online, tps: live.tps, mspt: live.mspt };
    history.short.push(point); if (history.short.length > SHORT) history.short.shift();
    longAcc.push(point);
    if (longAcc.length >= 12) {
      const avg = (k) => { const v = longAcc.map((p) => p[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      history.long.push({ t: Date.now(), cpu: avg('cpu'), mem: avg('mem'), players: Math.max(...longAcc.map((p) => p.players)), tps: avg('tps'), mspt: avg('mspt') });
      if (history.long.length > LONG) history.long.shift();
      longAcc = [];
      if (history.long.length % 5 === 0) writeJson(paths.state('history.json'), history.long).catch(() => {});
    }
  } catch (e) { live.state = live.state === 'unknown' ? 'unknown' : live.state; }
}

async function pollDisk() {
  try {
    const { props } = await readProps();
    disk.world = await dirSize(`${config.mcData}/${props['level-name'] || 'world'}`);
    disk.data = await diskFree(config.mcData);
    disk.backups = await diskFree(config.backupDir);
    if (disk.data.total && disk.data.free / disk.data.total < 0.1) emit('disk', { freePercent: Math.round((disk.data.free / disk.data.total) * 100) });
  } catch { /* ignore */ }
}

export const refreshNow = () => poll().catch(() => {});

export async function startCollector() {
  history.long = await readJson(paths.state('history.json'), []);
  await poll(); await pollDisk();
  setInterval(() => poll().catch(() => {}), 5000).unref();
  setInterval(() => pollDisk().catch(() => {}), 120000).unref();
}
