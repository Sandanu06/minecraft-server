import { jsonStore } from './store.js';
import { streamLogs } from './docker.js';
import { emit } from './events.js';

export const sessionStore = jsonStore('sessions.json', { players: {} });
export const chat = [];          // recent chat, newest last
const CHAT_MAX = 150;

const JOIN = /: (\w{3,16}) joined the game$/;
const LEAVE = /: (\w{3,16}) left the game$/;
const CHAT = /: <(\w{3,16})> (.+)$/;
const DONE = /: Done \(/;

async function onLine(line) {
  let m;
  if ((m = line.match(JOIN))) {
    const name = m[1], now = Date.now();
    await sessionStore.mutate((d) => { const p = (d.players[name] ||= { firstSeen: now, totalSeconds: 0, sessions: 0, online: null }); p.online = now; p.lastSeen = now; p.sessions += 1; });
    emit('join', { player: name });
  } else if ((m = line.match(LEAVE))) {
    const name = m[1], now = Date.now();
    await sessionStore.mutate((d) => { const p = d.players[name]; if (p) { if (p.online) p.totalSeconds += Math.round((now - p.online) / 1000); p.online = null; p.lastSeen = now; } });
    emit('leave', { player: name });
  } else if ((m = line.match(CHAT))) {
    chat.push({ t: Date.now(), player: m[1], text: m[2] }); if (chat.length > CHAT_MAX) chat.shift();
    emit('chat', { player: m[1], text: m[2] });
  } else if (DONE.test(line)) emit('ready');
}

/** Close sessions for anyone the server no longer reports as online (after a restart or crash). */
export async function reconcile(onlineNames) {
  const set = new Set(onlineNames);
  const d = await sessionStore.read();
  if (!Object.entries(d.players).some(([n, p]) => p.online && !set.has(n))) return;
  const now = Date.now();
  await sessionStore.mutate((x) => { for (const [n, p] of Object.entries(x.players)) if (p.online && !set.has(n)) { p.totalSeconds += Math.round((now - p.online) / 1000); p.online = null; p.lastSeen = now; } });
}

export function startFollower() {
  const loop = async () => {
    let ended = false;
    try {
      await streamLogs({ tail: 0, onLine: (l) => { if (l === null) { ended = true; } else onLine(l).catch(() => {}); } });
    } catch { ended = true; }
    // Reconnect whenever the log stream ends (server restart, container recreated).
    const wait = () => setTimeout(loop, 4000).unref();
    const poll = setInterval(() => { if (ended) { clearInterval(poll); wait(); } }, 1000); poll.unref();
  };
  loop();
}
