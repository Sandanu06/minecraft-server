import crypto from 'node:crypto';
import { config, paths } from './config.js';
import { HttpError, readJson, writeJson, audit } from './util.js';

const SESSION_DAYS = 7;
let secret = null;

async function getSecret() {
  if (secret) return secret;
  if (config.sessionSecret) return (secret = config.sessionSecret);
  const file = paths.state('secret.json');
  let s = (await readJson(file, {})).secret;
  if (!s) { s = crypto.randomBytes(32).toString('hex'); await writeJson(file, { secret: s }, 0o600); }
  return (secret = s);
}

/** Hash format: scrypt:<saltHex>:<hashHex> (no $ so it survives docker-compose env interpolation) */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split(':');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// A password changed from the dashboard is stored in the state volume and wins over the env hash.
async function credentials() {
  const saved = await readJson(paths.state('auth.json'), null);
  return saved?.hash ? { user: saved.user || config.adminUser, hash: saved.hash, v: saved.v || 1 } : { user: config.adminUser, hash: config.adminPasswordHash, v: 0 };
}

const sign = async (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
};

export async function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    const cred = await credentials();
    if (p.exp < Date.now() || p.v !== cred.v || p.u !== cred.user) return null;
    return p;
  } catch { return null; }
}

// Slow down password guessing: 6 failures per 15 minutes per address.
const fails = new Map();
function throttle(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  fails.set(ip, list);
  if (list.length >= 6) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  return list;
}

export async function login(req, reply, { username, password }) {
  const list = throttle(req.ip);
  const cred = await credentials();
  const ok = cred.hash && username === cred.user && verifyPassword(String(password || ''), cred.hash);
  if (!ok) {
    list.push(Date.now());
    await audit({ ip: req.ip }, 'login.failed', String(username || '').slice(0, 40));
    throw new HttpError(401, 'Wrong username or password');
  }
  const token = await sign({ u: cred.user, v: cred.v, exp: Date.now() + SESSION_DAYS * 864e5 });
  reply.header('Set-Cookie', cookie(token, SESSION_DAYS * 86400));
  await audit({ user: cred.user, ip: req.ip }, 'login');
  return { user: cred.user };
}

export const logoutCookie = () => cookie('', 0);
function cookie(value, maxAge) {
  return `tz_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`;
}

export async function changePassword(user, current, next) {
  const cred = await credentials();
  if (!verifyPassword(String(current || ''), cred.hash)) throw new HttpError(403, 'Current password is wrong');
  if (String(next || '').length < 10) throw new HttpError(400, 'Use at least 10 characters');
  await writeJson(paths.state('auth.json'), { user: cred.user, hash: hashPassword(next), v: cred.v + 1 }, 0o600);
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
}
