import http from 'node:http';
import os from 'node:os';
import { config } from './config.js';
import { HttpError } from './util.js';

function request(method, path, { body, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      socketPath: config.dockerSocket, path, method, timeout,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = text;
        try { data = text ? JSON.parse(text) : null; } catch { /* plain text */ }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Docker request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let cached = { at: 0, container: null };

export async function findMc(force = false) {
  if (!force && Date.now() - cached.at < 2000) return cached.container;
  const filters = encodeURIComponent(JSON.stringify({
    label: [`com.docker.compose.project=${config.mcProject}`, `com.docker.compose.service=${config.mcService}`],
  }));
  const { status, data } = await request('GET', `/containers/json?all=1&filters=${filters}`);
  if (status !== 200) throw new HttpError(502, 'Cannot reach Docker');
  const container = [...data].sort((a, b) => b.Created - a.Created)[0] || null;
  cached = { at: Date.now(), container };
  return container;
}

export async function mcContainer() {
  const c = await findMc();
  if (!c) throw new HttpError(404, 'Minecraft container not found');
  return c;
}

export async function inspectMc() {
  const c = await mcContainer();
  const { data } = await request('GET', `/containers/${c.Id}/json`);
  return data;
}

export async function statsMc() {
  const c = await mcContainer();
  const { status, data } = await request('GET', `/containers/${c.Id}/stats?stream=false&one-shot=false`, { timeout: 10000 });
  if (status !== 200 || !data?.cpu_stats) return null;
  const cpuDelta = data.cpu_stats.cpu_usage.total_usage - (data.precpu_stats?.cpu_usage?.total_usage || 0);
  const sysDelta = data.cpu_stats.system_cpu_usage - (data.precpu_stats?.system_cpu_usage || 0);
  const cpus = data.cpu_stats.online_cpus || 1;
  const cpu = sysDelta > 0 && cpuDelta >= 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;
  const cache = data.memory_stats?.stats?.inactive_file || data.memory_stats?.stats?.cache || 0;
  return {
    cpu: Math.round(cpu * 10) / 10,
    cpuCores: cpus,
    memUsed: Math.max(0, (data.memory_stats?.usage || 0) - cache),
    memLimit: data.memory_stats?.limit || 0,
    netRx: Object.values(data.networks || {}).reduce((a, n) => a + n.rx_bytes, 0),
    netTx: Object.values(data.networks || {}).reduce((a, n) => a + n.tx_bytes, 0),
  };
}

export async function action(name, query = '') {
  const c = await mcContainer();
  const { status, data } = await request('POST', `/containers/${c.Id}/${name}${query}`, { timeout: (config.stopGraceSeconds + 30) * 1000 });
  if (status >= 400 && status !== 304) throw new HttpError(500, data?.message || `Docker ${name} failed`);
  cached.at = 0;
}
export const startMc = () => action('start');
export const stopMc = () => action('stop', `?t=${config.stopGraceSeconds}`);
export const restartMc = () => action('restart', `?t=${config.stopGraceSeconds}`);
export const killMc = () => action('kill');

// Make sure this container can reach the Minecraft network (for RCON).
export async function ensureNetwork() {
  const info = await inspectMc();
  const nets = Object.keys(info.NetworkSettings?.Networks || {});
  if (!nets.length) return null;
  // Prefer the game's own private network, not the shared proxy network it may also be attached to.
  const net = nets.includes(config.mcProject) ? config.mcProject : nets[0];
  const self = os.hostname();
  const me = await request('GET', `/containers/${self}/json`);
  if (me.status === 200 && me.data?.NetworkSettings?.Networks?.[net]) return info.NetworkSettings.Networks[net].IPAddress;
  await request('POST', `/networks/${net}/connect`, { body: { Container: self } });
  const again = await inspectMc();
  return again.NetworkSettings.Networks[net]?.IPAddress || null;
}

export async function mcAddress() {
  const info = await inspectMc();
  if (!info.State?.Running) return null;
  const all = info.NetworkSettings?.Networks || {};
  return (all[config.mcProject] || Object.values(all)[0])?.IPAddress || null;
}

// Docker multiplexes stdout/stderr in 8-byte-framed chunks when there is no TTY.
export async function streamLogs({ tail = 200, onLine, signal }) {
  const c = await mcContainer();
  const req = http.request({
    socketPath: config.dockerSocket,
    path: `/containers/${c.Id}/logs?follow=1&stdout=1&stderr=1&tail=${tail}&timestamps=0`,
    method: 'GET',
  }, (res) => {
    let buf = Buffer.alloc(0), partial = '';
    res.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const len = buf.readUInt32BE(4);
        if (buf.length < 8 + len) break;
        partial += buf.subarray(8, 8 + len).toString('utf8');
        buf = buf.subarray(8 + len);
        const lines = partial.split('\n');
        partial = lines.pop();
        lines.forEach((l) => l && onLine(l));
      }
    });
    res.on('end', () => onLine(null));
  });
  req.on('error', () => onLine(null));
  signal?.addEventListener('abort', () => req.destroy());
  req.end();
}

export async function recentLogs(tail = 400) {
  const c = await mcContainer();
  const { data } = await request('GET', `/containers/${c.Id}/logs?stdout=1&stderr=1&tail=${tail}`);
  const raw = typeof data === 'string' ? data : '';
  return raw.replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
}
