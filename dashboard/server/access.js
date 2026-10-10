import crypto from 'node:crypto';
import { config, paths } from './config.js';
import { HttpError, readJson, writeJson } from './util.js';
import { BUILTIN_ROLES, ALL_PERMS } from './rbac.js';

const FILE = () => paths.state('access.json');
let cache = null;
let chain = Promise.resolve();

const id = () => crypto.randomBytes(5).toString('hex');
export const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split(':');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length), expected);
}
export const generatePassword = () => crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(16, 'x').slice(0, 16);

async function bootstrap() {
  // First run: the environment's admin becomes the Owner. A password changed under the old single-user
  // dashboard (auth.json) is carried over.
  const legacy = await readJson(paths.state('auth.json'), null);
  const hash = legacy?.hash || config.adminPasswordHash;
  return {
    roles: [],
    users: hash ? [{ id: id(), username: legacy?.user || config.adminUser, hash, role: 'owner', disabled: false, v: 1, totp: null, createdAt: new Date().toISOString(), lastLoginAt: null }] : [],
  };
}

async function load() {
  if (cache) return cache;
  const data = (await readJson(FILE(), null)) || (await bootstrap());
  data.roles ||= [];
  // Built-in roles are always present; the owner always has every permission (including new ones).
  for (const b of BUILTIN_ROLES) {
    const have = data.roles.find((r) => r.id === b.id);
    if (!have) data.roles.push({ ...b });
    else { have.builtin = true; if (b.locked) { have.permissions = [...ALL_PERMS]; have.locked = true; } }
  }
  cache = data;
  await writeJson(FILE(), data, 0o600);
  return data;
}

/** Serialise read-modify-write cycles so concurrent requests cannot clobber each other. */
export function mutate(fn) {
  const run = chain.then(async () => {
    const data = await load();
    const result = await fn(data);
    await writeJson(FILE(), data, 0o600);
    return result;
  });
  chain = run.catch(() => {});
  return run;
}
export const read = load;

export const publicUser = (u, roles) => ({
  id: u.id, username: u.username, role: u.role, roleName: roles.find((r) => r.id === u.role)?.name || u.role,
  disabled: !!u.disabled, totp: !!u.totp?.enabled, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
});

export const permsOf = (data, user) => new Set(data.roles.find((r) => r.id === user.role)?.permissions || []);

export async function findUser(username) {
  const data = await load();
  return data.users.find((u) => u.username.toLowerCase() === String(username || '').toLowerCase());
}
export async function getUser(userId) {
  const data = await load();
  return data.users.find((u) => u.id === userId);
}

export function assertPassword(pw) {
  if (String(pw || '').length < 10) throw new HttpError(400, 'Use at least 10 characters');
}

export { id as newId };
