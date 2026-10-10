import { jsonStore } from './store.js';
import { onEvent } from './events.js';
import { config } from './config.js';

export const alertStore = jsonStore('alerts.json', {
  discordUrl: '',
  events: { start: true, stop: true, crash: true, backup: true, backupFailed: true, lag: true, disk: true, join: false, leave: false, script: false, security: true },
});

export const EVENT_LABELS = {
  start: 'Server started', stop: 'Server stopped', crash: 'Server crashed or stopped unexpectedly', backup: 'Backup finished', backupFailed: 'Backup failed',
  lag: 'Server is lagging (low TPS)', disk: 'Disk space is running low', join: 'Player joined', leave: 'Player left', script: 'Script finished', security: 'Failed or new dashboard sign-ins',
};

const COLORS = { green: 0x6bd99b, red: 0xf2635f, yellow: 0xfdd32f, blue: 0x7cb7ff, grey: 0x9aa0ac };
const last = new Map();
const throttled = (key, ms) => { const now = Date.now(); if (now - (last.get(key) || 0) < ms) return true; last.set(key, now); return false; };

export function validateWebhook(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('That does not look like a web address'); }
  if (u.protocol !== 'https:') throw new Error('The webhook address must start with https://');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname) || /^[\d.:[\]]+$/.test(u.hostname)) throw new Error('Use a public webhook address, not an IP or local name');
  return u.toString();
}

export async function sendDiscord(url, { title, description, color = 'grey', fields }) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': config.modrinthUA },
    body: JSON.stringify({ username: 'Teczos Minecraft', embeds: [{ title, description, color: COLORS[color], fields, timestamp: new Date().toISOString(), footer: { text: 'Teczos Minecraft' } }] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`The webhook answered ${res.status}`);
}

const MAP = {
  start: () => ({ title: '🟢 Server is online', color: 'green' }),
  stop: () => ({ title: '⏹️ Server stopped', color: 'grey' }),
  crash: () => ({ title: '🔴 Server stopped unexpectedly', description: 'It was not stopped from the dashboard. Docker will try to bring it back.', color: 'red' }),
  backup: (e) => ({ title: '💾 Backup finished', description: `${e.name}${e.size ? ` (${(e.size / 1048576).toFixed(0)} MB)` : ''}`, color: 'blue' }),
  backupFailed: (e) => ({ title: '⚠️ Backup failed', description: e.error, color: 'red' }),
  lag: (e) => ({ title: '🐢 Server is lagging', description: `TPS has been below 15 (now ${e.tps?.toFixed?.(1)}).`, color: 'yellow' }),
  disk: (e) => ({ title: '💽 Disk space is low', description: `${e.freePercent}% free on the server disk.`, color: 'yellow' }),
  join: (e) => ({ title: `➡️ ${e.player} joined`, color: 'green' }),
  leave: (e) => ({ title: `⬅️ ${e.player} left`, color: 'grey' }),
  script: (e) => ({ title: `📜 Script ${e.status}: ${e.name}`, description: `Run by ${e.user}`, color: e.status === 'failed' ? 'red' : 'blue' }),
  security: (e) => ({ title: `🔐 ${e.text}`, color: 'yellow' }),
};

export function startNotifier() {
  onEvent(async (e) => {
    const key = e.type === 'ready' ? 'start' : e.type;
    const make = MAP[key];
    if (!make) return;
    try {
      const s = await alertStore.read();
      if (!s.discordUrl || !s.events[key]) return;
      if (key === 'lag' && throttled('lag', 10 * 60000)) return;
      if (key === 'disk' && throttled('disk', 6 * 3600000)) return;
      if (key === 'security' && throttled(`sec:${e.text}`, 5 * 60000)) return;
      await sendDiscord(s.discordUrl, make(e));
    } catch { /* a failing webhook must never affect the server */ }
  });
}
