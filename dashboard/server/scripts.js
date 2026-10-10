import crypto from 'node:crypto';
import { jsonStore } from './store.js';
import { HttpError, audit, withOp } from './util.js';
import { rcon, parseList } from './mc.js';
import { live } from './collector.js';
import { power } from './power.js';
import { createBackup } from './backups.js';
import { emit } from './events.js';

export const scriptStore = jsonStore('scripts.json', { scripts: null });
export const scheduleStore = jsonStore('schedules.json', { timezone: 'UTC', schedules: null });

const id = () => crypto.randomBytes(5).toString('hex');
const SEED = [
  { name: 'Restart with countdown', description: 'Warns players, saves the world, then restarts the server.', body: `# Warns players, saves, then restarts.
@broadcast The server restarts in 5 minutes
wait 4m
@broadcast The server restarts in 1 minute
wait 50s
@broadcast Restarting in 10 seconds
wait 10s
save-all flush
@restart` },
  { name: 'Backup with notice', description: 'Takes a backup and tells everyone.', body: `@broadcast Saving a backup. You may notice a short pause.
@backup scripted
@broadcast Backup complete.` },
  { name: 'Fresh morning', description: 'Sets the time to day and clears the weather.', body: `time set day
weather clear
@broadcast Good morning!` },
  { name: 'Clear dropped items', description: 'Removes loose items lying around to cut lag.', body: `kill @e[type=item]
@broadcast Dropped items were cleared.` },
];

export async function ensureSeeded() {
  await scriptStore.mutate((d) => {
    if (d.scripts) return;
    // Restarting the server is for admins by default; owners can always run everything.
    d.scripts = SEED.map((s) => ({ id: id(), ...s, enabled: true, roles: s.name === 'Restart with countdown' ? ['admin'] : [], createdBy: 'system', updatedAt: new Date().toISOString() }));
  });
  await scheduleStore.mutate(async (d) => {
    if (d.schedules) return;
    const restart = (await scriptStore.read()).scripts.find((s) => s.name === 'Restart with countdown');
    d.schedules = [{ id: id(), name: 'Nightly restart', enabled: false, target: { type: 'script', scriptId: restart.id }, when: { kind: 'daily', time: '05:00' }, lastRunAt: null, lastStatus: null, createdAt: new Date().toISOString() }];
  });
}

/* ---------------- script parsing ---------------- */
const DUR = /^(\d+)\s*(s|m|h)?$/i;
export function parseScript(body) {
  const steps = [];
  String(body || '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const n = i + 1;
    if (/^wait\s/i.test(line)) {
      const m = line.slice(5).trim().match(DUR);
      if (!m) throw new HttpError(400, `Line ${n}: write a wait like “wait 30s”, “wait 5m” or “wait 1h”`);
      const secs = Number(m[1]) * ({ s: 1, m: 60, h: 3600 }[(m[2] || 's').toLowerCase()]);
      if (secs > 3600) throw new HttpError(400, `Line ${n}: a single wait can be at most 1 hour`);
      steps.push({ type: 'wait', secs, line: n, text: line });
    } else if (line.startsWith('@')) {
      const [word, ...rest] = line.slice(1).split(/\s+/);
      const arg = rest.join(' ');
      const k = word.toLowerCase();
      if (!['restart', 'stop', 'start', 'backup', 'broadcast', 'save', 'abort-if-players'].includes(k)) throw new HttpError(400, `Line ${n}: unknown step @${word}`);
      if (k === 'broadcast' && !arg) throw new HttpError(400, `Line ${n}: @broadcast needs a message`);
      steps.push({ type: k, arg, line: n, text: line });
    } else {
      const command = line.replace(/^\//, '');
      if (/^stop\b/i.test(command)) throw new HttpError(400, `Line ${n}: use @stop so the server stays off`);
      steps.push({ type: 'cmd', arg: command, line: n, text: line });
    }
  });
  if (steps.length > 200) throw new HttpError(400, 'Scripts can have at most 200 steps');
  return steps;
}

/* ---------------- runner ---------------- */
export const runs = [];      // newest first
const active = new Map();    // runId -> { cancelled }

const log = (run, kind, text) => { run.lines.push({ t: Date.now(), kind, text: String(text).slice(0, 600) }); if (run.lines.length > 400) run.lines.shift(); };
const sleep = (ms, run) => new Promise((resolve) => {
  const end = Date.now() + ms;
  const tick = () => (run.cancelled || Date.now() >= end ? resolve() : setTimeout(tick, Math.min(500, end - Date.now())));
  tick();
});

export function startRun(script, who) {
  const steps = parseScript(script.body);
  if (!steps.length) throw new HttpError(400, 'This script has no steps');
  if ([...active.keys()].some((rid) => runs.find((r) => r.id === rid)?.scriptId === script.id)) throw new HttpError(409, 'This script is already running');
  if (active.size >= 3) throw new HttpError(429, 'Three scripts are already running');
  const run = { id: id(), scriptId: script.id, name: script.name, user: who, startedAt: Date.now(), endedAt: null, status: 'running', cancelled: false, lines: [], total: steps.length, step: 0 };
  runs.unshift(run); if (runs.length > 40) runs.pop();
  active.set(run.id, run);
  execute(run, steps).finally(() => active.delete(run.id));
  return run;
}

async function execute(run, steps) {
  const deadline = Date.now() + 2 * 3600 * 1000;
  try {
    for (const [i, step] of steps.entries()) {
      if (run.cancelled) { run.status = 'cancelled'; log(run, 'info', 'Cancelled'); return; }
      if (Date.now() > deadline) throw new Error('Script ran longer than 2 hours');
      run.step = i + 1;
      log(run, 'step', step.text);
      switch (step.type) {
        case 'wait': await sleep(step.secs * 1000, run); break;
        case 'broadcast': log(run, 'out', await rcon(`say ${step.arg.replace(/[\r\n]/g, ' ')}`) || 'sent'); break;
        case 'save': await rcon('save-all flush'); log(run, 'out', 'World saved'); break;
        case 'abort-if-players': {
          const n = parseList(await rcon('list')).online;
          if (n > 0) { run.status = 'skipped'; log(run, 'info', `${n} player${n === 1 ? ' is' : 's are'} online, so the script stopped here`); return; }
          log(run, 'out', 'Nobody is online, continuing'); break;
        }
        case 'backup': { const label = (step.arg || 'scripted').replace(/[^\w-]/g, '').slice(0, 24) || 'scripted'; const b = await withOp('backup', (p) => createBackup(label, p)); log(run, 'out', `Backup saved: ${b.name}`); break; }
        case 'restart': case 'stop': case 'start': await power(step.type); log(run, 'out', `Server ${step.type} done`); break;
        default: { const out = await rcon(step.arg); log(run, 'out', out || '(no output)'); }
      }
    }
    run.status = run.cancelled ? 'cancelled' : 'done';
  } catch (e) {
    run.status = 'failed'; log(run, 'error', e.message);
  } finally {
    run.endedAt = Date.now();
    await audit({ user: run.user }, `script.${run.status}`, run.name);
    emit('script', { name: run.name, status: run.status, user: run.user });
  }
}

export const cancelRun = (rid) => { const r = active.get(rid); if (!r) throw new HttpError(404, 'That run is not active'); r.cancelled = true; };

/* ---------------- schedules ---------------- */
function localParts(tz, date = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`, time: `${p.hour}:${p.minute}`, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
export const validTimezone = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

export function validateWhen(w) {
  if (!w || !['daily', 'weekly', 'interval'].includes(w.kind)) throw new HttpError(400, 'Choose when it runs');
  if (w.kind !== 'interval' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.time || '')) throw new HttpError(400, 'Time must look like 04:30');
  if (w.kind === 'weekly' && !(Array.isArray(w.days) && w.days.length && w.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))) throw new HttpError(400, 'Pick at least one day');
  if (w.kind === 'interval' && !(Number.isInteger(w.everyMinutes) && w.everyMinutes >= 5 && w.everyMinutes <= 10080)) throw new HttpError(400, 'Repeat every 5 minutes to 7 days');
  return w.kind === 'interval' ? { kind: 'interval', everyMinutes: w.everyMinutes } : { kind: w.kind, time: w.time, ...(w.kind === 'weekly' ? { days: [...new Set(w.days)].sort() } : {}) };
}

async function fire(s) {
  const who = `schedule: ${s.name}`;
  try {
    if (s.target.type === 'backup') { await withOp('scheduled backup', (p) => createBackup('scheduled', p)); }
    else if (s.target.type === 'restart') { await power('restart'); }
    else {
      const script = (await scriptStore.read()).scripts.find((x) => x.id === s.target.scriptId);
      if (!script || !script.enabled) throw new Error('The script is missing or disabled');
      startRun(script, who);
    }
    return 'started';
  } catch (e) { await audit({ user: who }, 'schedule.failed', e.message); return `failed: ${e.message}`; }
}

export function startScheduler() {
  setInterval(async () => {
    try {
      const d = await scheduleStore.read();
      const now = Date.now();
      for (const s of d.schedules || []) {
        if (!s.enabled) continue;
        const lp = localParts(d.timezone);
        let due = false;
        if (s.when.kind === 'interval') due = now - (s.lastRunAt || Date.parse(s.createdAt)) >= s.when.everyMinutes * 60000;
        else due = s.lastKey !== lp.key && s.when.time === lp.time && (s.when.kind === 'daily' || s.when.days.includes(lp.dow));
        if (!due) continue;
        const status = await fire(s);
        await scheduleStore.mutate((x) => { const t = x.schedules.find((y) => y.id === s.id); if (t) { t.lastRunAt = now; t.lastKey = lp.key; t.lastStatus = status; } });
      }
    } catch { /* retried on the next tick */ }
  }, 15000).unref();
}
