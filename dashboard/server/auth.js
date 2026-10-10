import crypto from 'node:crypto';
import { config, paths } from './config.js';
import { HttpError, readJson, writeJson, audit } from './util.js';
import * as access from './access.js';
import { verifyTotp } from './totp.js';
import { emit } from './events.js';

export const hashPassword = access.hashPassword;
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

const sign = async (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url')}`;
};

/** Resolves a session cookie to { id, username, role, perms } or null. Permissions are read fresh each time. */
export async function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now()) return null;
    const data = await access.read();
    const user = data.users.find((u) => u.id === p.u);
    if (!user || user.disabled || user.v !== p.v) return null;
    return { id: user.id, username: user.username, role: user.role, perms: access.permsOf(data, user) };
  } catch { return null; }
}

// Slow down guessing: 6 failures / 15 min per address, 10 per account.
const fails = new Map();
function attempts(key) {
  const now = Date.now();
  const list = (fails.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  fails.set(key, list);
  return list;
}

export async function login(req, reply, { username, password, code }) {
  const byIp = attempts(`ip:${req.ip}`), byUser = attempts(`u:${String(username).toLowerCase()}`);
  if (byIp.length >= 6 || byUser.length >= 10) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const user = await access.findUser(username);
  const ok = user && !user.disabled && access.verifyPassword(String(password || ''), user.hash);
  const fail = async (msg, status = 401) => {
    byIp.push(Date.now()); byUser.push(Date.now());
    await audit({ ip: req.ip }, 'login.failed', String(username || '').slice(0, 40));
    emit('security', { text: `Failed dashboard sign-in for “${String(username || '').slice(0, 30)}” from ${req.ip}` });
    throw new HttpError(status, msg);
  };
  if (!ok) await fail('Wrong username or password');
  if (user.totp?.enabled) {
    if (!code) throw Object.assign(new HttpError(401, 'Enter the 6-digit code from your authenticator app'), { needCode: true });
    if (!verifyTotp(user.totp.secret, code)) await fail('That code is not right. Check your phone clock and try again.');
  }
  await access.mutate((d) => { d.users.find((u) => u.id === user.id).lastLoginAt = new Date().toISOString(); });
  reply.header('Set-Cookie', cookie(await sign({ u: user.id, v: user.v, exp: Date.now() + SESSION_DAYS * 864e5 }), SESSION_DAYS * 86400));
  await audit({ user: user.username, ip: req.ip }, 'login');
  return { user: user.username };
}

export const logoutCookie = () => cookie('', 0);
function cookie(value, maxAge) {
  return `tz_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`;
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
}
