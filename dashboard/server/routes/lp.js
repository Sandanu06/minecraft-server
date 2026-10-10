import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.js';
import { HttpError, audit, exists, readJson } from '../util.js';
import { rcon, readNamedJson } from '../mc.js';
import { installProject, gameVersion } from './plugins.js';
import { newId } from '../access.js';

const dir = () => path.join(config.mcData, 'plugins', 'LuckPerms');
const store = (...p) => path.join(dir(), 'json-storage', ...p);
const GROUP_RE = /^[a-z0-9_-]{1,32}$/;
const NODE_RE = /^[A-Za-z0-9_.*:\-/]{1,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SUGGESTIONS = [
  ['minecraft.command.gamemode', 'Change game mode'], ['minecraft.command.tp', 'Teleport'], ['minecraft.command.give', 'Give items'], ['minecraft.command.kick', 'Kick players'],
  ['minecraft.command.ban', 'Ban players'], ['minecraft.command.pardon', 'Unban players'], ['minecraft.command.time', 'Change time'], ['minecraft.command.weather', 'Change weather'],
  ['minecraft.command.say', 'Broadcast with /say'], ['minecraft.command.msg', 'Private messages'], ['minecraft.command.list', 'See who is online'], ['minecraft.command.effect', 'Apply effects'],
  ['minecraft.command.kill', 'Use /kill'], ['minecraft.command.difficulty', 'Change difficulty'], ['bukkit.command.plugins', 'See the plugin list'], ['bukkit.command.tps', 'See server TPS'],
  ['worldedit.*', 'All WorldEdit commands'], ['worldguard.*', 'All WorldGuard commands'], ['essentials.*', 'All EssentialsX commands'],
];

async function jars() {
  const files = await fsp.readdir(paths.plugins()).catch(() => []);
  return files.filter((f) => /^luckperms.*\.jar(\.disabled)?$/i.test(f));
}
async function storageMethod() {
  try { return (await fsp.readFile(path.join(dir(), 'config.yml'), 'utf8')).match(/^storage-method:\s*['"]?(\w+)/mi)?.[1]?.toUpperCase() || 'H2'; } catch { return null; }
}
async function readDirJson(sub) {
  const out = [];
  for (const f of await fsp.readdir(store(sub)).catch(() => [])) if (f.endsWith('.json')) { const j = await readJson(store(sub, f), null); if (j) out.push(j); }
  return out;
}
const weightOf = (g) => { const n = (g.permissions || []).find((p) => /^weight\.\d+$/.test(p.permission)); return n ? Number(n.permission.split('.')[1]) : 0; };
const realPerms = (list = []) => list.filter((p) => !/^weight\.\d+$/.test(p.permission)).map((p) => ({ permission: p.permission, value: p.value !== false, ...(p.context ? { context: p.context } : {}), ...(p.expiry ? { expiry: p.expiry } : {}) }));
const prefixOf = (g) => [...(g.prefixes || [])].sort((a, b) => b.priority - a.priority)[0]?.prefix || '';

async function names() {
  const cache = await readNamedJson('usercache.json');
  const map = new Map(cache.map((p) => [p.uuid, p.name]));
  return map;
}
const ready = async () => {
  const [jarList, method] = await Promise.all([jars(), storageMethod()]);
  return { jarList, method, usable: jarList.length > 0 && method === 'JSON' && exists(store('groups')) };
};
async function assertUsable() {
  const r = await ready();
  if (!r.jarList.length) throw new HttpError(409, 'LuckPerms is not installed');
  if (r.method !== 'JSON') throw new HttpError(409, 'LuckPerms must use JSON storage for the dashboard to manage it');
  return r;
}
const lp = async (command) => { await rcon(`lp ${command}`); await new Promise((r) => setTimeout(r, 350)); };
const groupName = (n) => { const g = String(n || '').toLowerCase(); if (!GROUP_RE.test(g)) throw new HttpError(400, 'Group names use lowercase letters, numbers, dashes and underscores'); return g; };
const node = (n) => { if (!NODE_RE.test(n || '')) throw new HttpError(400, 'Enter a permission like minecraft.command.kick'); return n; };

export default async function (app) {
  app.get('/api/lp/status', async () => {
    const r = await ready();
    return { installed: r.jarList.length > 0, enabled: r.jarList.some((j) => !j.endsWith('.disabled')), storage: r.method, usable: r.usable, suggestions: SUGGESTIONS };
  });

  // One click: install LuckPerms and start it with JSON storage so the dashboard can read it.
  app.post('/api/lp/setup', async (req) => {
    const cfg = path.join(dir(), 'config.yml');
    if (!exists(cfg)) { await fsp.mkdir(dir(), { recursive: true }); await fsp.writeFile(cfg, 'storage-method: JSON\n'); }
    let installed = [];
    if (!(await jars()).length) installed = await installProject('luckperms', await gameVersion());
    await audit(req, 'lp.setup');
    return { installed, restartNeeded: true };
  });

  app.get('/api/lp/groups', async () => {
    await assertUsable();
    const [groups, users] = await Promise.all([readDirJson('groups'), readDirJson('users')]);
    return {
      groups: groups.map((g) => ({
        name: g.name, weight: weightOf(g), prefix: prefixOf(g), permissions: realPerms(g.permissions).length,
        parents: (g.parents || []).map((p) => p.group),
        members: users.filter((u) => (u.parents || []).some((p) => p.group === g.name) && !(g.name === 'default' && u.parents.length === 1)).length,
      })).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)),
    };
  });

  app.get('/api/lp/groups/:name', async (req) => {
    await assertUsable();
    const g = await readJson(store('groups', `${groupName(req.params.name)}.json`), null);
    if (!g) throw new HttpError(404, 'Group not found');
    const [users, nm] = await Promise.all([readDirJson('users'), names()]);
    return {
      name: g.name, weight: weightOf(g), prefix: prefixOf(g), suffix: [...(g.suffixes || [])].sort((a, b) => b.priority - a.priority)[0]?.suffix || '',
      permissions: realPerms(g.permissions), parents: (g.parents || []).map((p) => p.group),
      members: users.filter((u) => (u.parents || []).some((p) => p.group === g.name)).map((u) => ({ uuid: u.uuid, name: nm.get(u.uuid) || (u.name && u.name !== 'null' ? u.name : u.uuid.slice(0, 8)) })),
    };
  });

  app.post('/api/lp/groups', async (req) => {
    await assertUsable();
    const name = groupName(req.body?.name);
    await lp(`creategroup ${name}`);
    if (Number.isInteger(req.body?.weight)) await lp(`group ${name} setweight ${Math.max(0, Math.min(100000, req.body.weight))}`);
    await audit(req, 'lp.group.create', name);
    return { ok: true };
  });

  app.delete('/api/lp/groups/:name', async (req) => {
    await assertUsable();
    const name = groupName(req.params.name);
    if (name === 'default') throw new HttpError(400, 'The default group cannot be deleted');
    await lp(`deletegroup ${name}`);
    await audit(req, 'lp.group.delete', name);
    return { ok: true };
  });

  app.put('/api/lp/groups/:name', async (req) => {
    await assertUsable();
    const name = groupName(req.params.name), { weight, prefix } = req.body || {};
    if (weight !== undefined) { if (!Number.isInteger(weight) || weight < 0 || weight > 100000) throw new HttpError(400, 'Weight is a whole number from 0 to 100000'); await lp(`group ${name} setweight ${weight}`); }
    if (prefix !== undefined) {
      const clean = String(prefix).replace(/["\r\n]/g, '').slice(0, 60);
      await lp(`group ${name} meta clear prefix`);
      if (clean) await lp(`group ${name} meta setprefix 100 "${clean}"`);
    }
    await audit(req, 'lp.group.update', name);
    return { ok: true };
  });

  app.post('/api/lp/groups/:name/permission', async (req) => {
    await assertUsable();
    const name = groupName(req.params.name), p = node(req.body?.permission);
    if (req.body?.unset) await lp(`group ${name} permission unset ${p}`);
    else await lp(`group ${name} permission set ${p} ${req.body?.value === false ? 'false' : 'true'}`);
    await audit(req, 'lp.group.permission', `${name} ${p} ${req.body?.unset ? 'unset' : req.body?.value === false ? 'false' : 'true'}`);
    return { ok: true };
  });

  app.post('/api/lp/groups/:name/parent', async (req) => {
    await assertUsable();
    const name = groupName(req.params.name), parent = groupName(req.body?.group);
    if (name === parent) throw new HttpError(400, 'A group cannot inherit from itself');
    await lp(`group ${name} parent ${req.body?.remove ? 'remove' : 'add'} ${parent}`);
    await audit(req, 'lp.group.parent', `${name} ${req.body?.remove ? '-' : '+'} ${parent}`);
    return { ok: true };
  });

  /* ---- people ---- */
  app.get('/api/lp/users', async () => {
    await assertUsable();
    const [users, nm, cache] = await Promise.all([readDirJson('users'), names(), readNamedJson('usercache.json')]);
    const byUuid = new Map(users.map((u) => [u.uuid, u]));
    const rows = cache.map((p) => ({ uuid: p.uuid, name: p.name, groups: (byUuid.get(p.uuid)?.parents || [{ group: 'default' }]).map((x) => x.group), permissions: realPerms(byUuid.get(p.uuid)?.permissions).length }));
    for (const u of users) if (!rows.some((r) => r.uuid === u.uuid)) rows.push({ uuid: u.uuid, name: nm.get(u.uuid) || u.uuid.slice(0, 8), groups: (u.parents || []).map((x) => x.group), permissions: realPerms(u.permissions).length });
    return { users: rows.sort((a, b) => a.name.localeCompare(b.name)) };
  });

  app.get('/api/lp/users/:uuid', async (req) => {
    await assertUsable();
    if (!UUID_RE.test(req.params.uuid)) throw new HttpError(400, 'Invalid player id');
    const u = await readJson(store('users', `${req.params.uuid}.json`), { uuid: req.params.uuid, parents: [{ group: 'default' }], permissions: [] });
    return { uuid: u.uuid, groups: (u.parents || []).map((p) => p.group), permissions: realPerms(u.permissions) };
  });

  app.post('/api/lp/users/:uuid/group', async (req) => {
    await assertUsable();
    if (!UUID_RE.test(req.params.uuid)) throw new HttpError(400, 'Invalid player id');
    const group = groupName(req.body?.group), action = req.body?.action;
    if (!['add', 'remove', 'set'].includes(action)) throw new HttpError(400, 'Unknown action');
    await lp(`user ${req.params.uuid} parent ${action} ${group}`);
    await audit(req, 'lp.user.group', `${req.params.uuid.slice(0, 8)} ${action} ${group}`);
    return { ok: true };
  });

  app.post('/api/lp/users/:uuid/permission', async (req) => {
    await assertUsable();
    if (!UUID_RE.test(req.params.uuid)) throw new HttpError(400, 'Invalid player id');
    const p = node(req.body?.permission);
    if (req.body?.unset) await lp(`user ${req.params.uuid} permission unset ${p}`);
    else await lp(`user ${req.params.uuid} permission set ${p} ${req.body?.value === false ? 'false' : 'true'}`);
    await audit(req, 'lp.user.permission', `${req.params.uuid.slice(0, 8)} ${p}`);
    return { ok: true };
  });
}
