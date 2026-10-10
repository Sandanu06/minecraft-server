import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, paths } from './config.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

// Write via a temp file so a crash never leaves a half-written config behind.
export async function writeFileAtomic(file, data, mode) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data, mode ? { mode } : undefined);
  await fsp.rename(tmp, file);
}
export const writeJson = (file, obj, mode) => writeFileAtomic(file, JSON.stringify(obj, null, 2), mode);

export async function audit(req, action, detail = '') {
  const who = typeof req?.user === 'string' ? req.user : req?.user?.username;
  const line = JSON.stringify({ t: new Date().toISOString(), user: who || 'system', ip: req?.ip || '', action, detail }) + '\n';
  try {
    await fsp.mkdir(config.stateDir, { recursive: true });
    await fsp.appendFile(paths.state('audit.jsonl'), line);
  } catch { /* auditing must never break the action itself */ }
}

export async function readAudit(limit = 200) {
  try {
    const text = await fsp.readFile(paths.state('audit.jsonl'), 'utf8');
    return text.trim().split('\n').slice(-limit).reverse().map((l) => JSON.parse(l));
  } catch { return []; }
}

export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts });
    let out = '', err = '';
    p.stdout?.on('data', (d) => (out += d));
    p.stderr?.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(0, 400)}`))));
  });
}

export async function dirSize(dir) {
  try { return Number((await run('du', ['-sk', dir])).split('\t')[0]) * 1024; } catch { return 0; }
}

export async function diskFree(dir) {
  try {
    const s = await fsp.statfs(dir);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch { return { total: 0, free: 0 }; }
}

export const exists = (p) => fs.existsSync(p);

// One long-running operation (backup, restore, version switch) at a time.
let busy = null;
export const currentOp = () => busy;
export async function withOp(type, fn) {
  if (busy) throw new HttpError(409, `Busy: ${busy.type} is in progress`);
  busy = { type, startedAt: Date.now() };
  try { return await fn((m) => { busy.message = m; }); } finally { busy = null; }
}

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export function assertName(name) {
  if (!NAME_RE.test(name || '')) throw new HttpError(400, 'Player names are 3–16 letters, numbers or underscores');
  return name;
}

export function stripColors(s) { return String(s).replace(/§./g, '').replace(/\u001b\[[0-9;]*m/g, ''); }
