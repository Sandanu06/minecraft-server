import QRCode from 'qrcode';
import { HttpError, audit } from '../util.js';
import * as access from '../access.js';
import { PERMISSIONS, ALL_PERMS } from '../rbac.js';
import { newSecret, otpauthUri, verifyTotp } from '../totp.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

/** You can only hand out permissions you hold yourself. */
function assertCanGrant(req, perms) {
  const missing = perms.filter((p) => !req.user.perms.has(p));
  if (missing.length) throw new HttpError(403, `You cannot grant permissions you do not have: ${missing.slice(0, 3).join(', ')}`);
}
const activeOwners = (d, exceptId) => d.users.filter((u) => u.role === 'owner' && !u.disabled && u.id !== exceptId).length;

export default async function (app) {
  /* ---- the signed-in person ---- */
  app.get('/api/me', async (req) => {
    const d = await access.read();
    const u = d.users.find((x) => x.id === req.user.id);
    return { user: u.username, ...access.publicUser(u, d.roles), permissions: [...req.user.perms] };
  });

  app.post('/api/account/password', async (req) => {
    const { current, next } = req.body || {};
    access.assertPassword(next);
    await access.mutate((d) => {
      const u = d.users.find((x) => x.id === req.user.id);
      if (!access.verifyPassword(String(current || ''), u.hash)) throw new HttpError(403, 'Current password is wrong');
      u.hash = access.hashPassword(next); u.v += 1;
    });
    await audit(req, 'account.password');
    return { ok: true };
  });

  app.post('/api/account/totp/setup', async (req) => {
    const secret = newSecret();
    await access.mutate((d) => { d.users.find((x) => x.id === req.user.id).totp = { secret, enabled: false }; });
    const uri = otpauthUri(secret, req.user.username);
    return { secret, uri, qr: await QRCode.toString(uri, { type: 'svg', margin: 1, color: { dark: '#15181e', light: '#ffffff' } }) };
  });
  app.post('/api/account/totp/enable', async (req) => {
    await access.mutate((d) => {
      const u = d.users.find((x) => x.id === req.user.id);
      if (!u.totp?.secret || !verifyTotp(u.totp.secret, req.body?.code)) throw new HttpError(400, 'That code is not right. Scan the QR code again and retry.');
      u.totp.enabled = true;
    });
    await audit(req, 'account.2fa.enabled');
    return { ok: true };
  });
  app.post('/api/account/totp/disable', async (req) => {
    await access.mutate((d) => {
      const u = d.users.find((x) => x.id === req.user.id);
      if (!access.verifyPassword(String(req.body?.password || ''), u.hash)) throw new HttpError(403, 'Password is wrong');
      u.totp = null;
    });
    await audit(req, 'account.2fa.disabled');
    return { ok: true };
  });

  /* ---- dashboard users ---- */
  app.get('/api/users', async () => {
    const d = await access.read();
    return { users: d.users.map((u) => access.publicUser(u, d.roles)), roles: d.roles };
  });

  app.post('/api/users', async (req) => {
    const { username, role } = req.body || {};
    if (!access.USERNAME_RE.test(username || '')) throw new HttpError(400, 'Usernames are 3–32 letters, numbers, dots, dashes or underscores');
    let password = req.body?.password; const generated = !password;
    if (generated) password = access.generatePassword(); else access.assertPassword(password);
    const user = await access.mutate((d) => {
      const r = d.roles.find((x) => x.id === role);
      if (!r) throw new HttpError(400, 'Choose a role');
      assertCanGrant(req, r.permissions);
      if (d.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new HttpError(409, 'That username is taken');
      const u = { id: access.newId(), username, hash: access.hashPassword(password), role, disabled: false, v: 1, totp: null, createdAt: new Date().toISOString(), lastLoginAt: null };
      d.users.push(u);
      return access.publicUser(u, d.roles);
    });
    await audit(req, 'user.create', `${username} (${role})`);
    return { user, password: generated ? password : undefined };
  });

  app.patch('/api/users/:id', async (req) => {
    const { role, disabled } = req.body || {};
    const user = await access.mutate((d) => {
      const u = d.users.find((x) => x.id === req.params.id);
      if (!u) throw new HttpError(404, 'User not found');
      if (u.id === req.user.id) throw new HttpError(400, 'You cannot change your own role or disable yourself');
      const current = d.roles.find((r) => r.id === u.role);
      assertCanGrant(req, current.permissions);   // cannot touch someone more powerful than you
      if (role !== undefined && role !== u.role) {
        const r = d.roles.find((x) => x.id === role);
        if (!r) throw new HttpError(400, 'Unknown role');
        assertCanGrant(req, r.permissions);
        if (u.role === 'owner' && !activeOwners(d, u.id)) throw new HttpError(409, 'There must be at least one active owner');
        u.role = role; u.v += 1;
      }
      if (disabled !== undefined) {
        if (disabled && u.role === 'owner' && !activeOwners(d, u.id)) throw new HttpError(409, 'There must be at least one active owner');
        u.disabled = !!disabled; u.v += 1;
      }
      return access.publicUser(u, d.roles);
    });
    await audit(req, 'user.update', `${user.username}: ${JSON.stringify({ role, disabled })}`);
    return { user };
  });

  app.post('/api/users/:id/reset-password', async (req) => {
    const password = req.body?.password || access.generatePassword();
    if (req.body?.password) access.assertPassword(password);
    const name = await access.mutate((d) => {
      const u = d.users.find((x) => x.id === req.params.id);
      if (!u) throw new HttpError(404, 'User not found');
      assertCanGrant(req, d.roles.find((r) => r.id === u.role).permissions);
      u.hash = access.hashPassword(password); u.v += 1;
      return u.username;
    });
    await audit(req, 'user.reset-password', name);
    return { password: req.body?.password ? undefined : password };
  });

  app.post('/api/users/:id/reset-2fa', async (req) => {
    const name = await access.mutate((d) => {
      const u = d.users.find((x) => x.id === req.params.id);
      if (!u) throw new HttpError(404, 'User not found');
      assertCanGrant(req, d.roles.find((r) => r.id === u.role).permissions);
      u.totp = null; u.v += 1; return u.username;
    });
    await audit(req, 'user.reset-2fa', name);
    return { ok: true };
  });

  app.delete('/api/users/:id', async (req) => {
    const name = await access.mutate((d) => {
      const u = d.users.find((x) => x.id === req.params.id);
      if (!u) throw new HttpError(404, 'User not found');
      if (u.id === req.user.id) throw new HttpError(400, 'You cannot delete yourself');
      assertCanGrant(req, d.roles.find((r) => r.id === u.role).permissions);
      if (u.role === 'owner' && !activeOwners(d, u.id)) throw new HttpError(409, 'There must be at least one active owner');
      d.users = d.users.filter((x) => x.id !== u.id);
      return u.username;
    });
    await audit(req, 'user.delete', name);
    return { ok: true };
  });

  app.get('/api/role-names', async () => ({ roles: (await access.read()).roles.map((r) => ({ id: r.id, name: r.name })) }));

  /* ---- roles ---- */
  app.get('/api/roles', async () => ({ roles: (await access.read()).roles, permissions: PERMISSIONS }));

  const cleanPerms = (perms) => {
    const list = [...new Set(Array.isArray(perms) ? perms : [])];
    const bad = list.filter((p) => !ALL_PERMS.includes(p));
    if (bad.length) throw new HttpError(400, `Unknown permission: ${bad[0]}`);
    return list;
  };

  app.post('/api/roles', async (req) => {
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (name.length < 2) throw new HttpError(400, 'Give the role a name');
    const permissions = cleanPerms(req.body?.permissions);
    assertCanGrant(req, permissions);
    const role = await access.mutate((d) => {
      let rid = slug(name) || 'role'; while (d.roles.some((r) => r.id === rid)) rid += '-2';
      const r = { id: rid, name, description: String(req.body?.description || '').slice(0, 120), builtin: false, permissions };
      d.roles.push(r); return r;
    });
    await audit(req, 'role.create', name);
    return { role };
  });

  app.put('/api/roles/:id', async (req) => {
    const role = await access.mutate((d) => {
      const r = d.roles.find((x) => x.id === req.params.id);
      if (!r) throw new HttpError(404, 'Role not found');
      if (r.locked) throw new HttpError(400, 'The Owner role cannot be edited');
      const permissions = cleanPerms(req.body?.permissions ?? r.permissions);
      // You may remove permissions you lack but not add them.
      assertCanGrant(req, permissions.filter((p) => !r.permissions.includes(p)));
      r.permissions = permissions;
      if (req.body?.name && !r.builtin) r.name = String(req.body.name).trim().slice(0, 40);
      if (req.body?.description !== undefined) r.description = String(req.body.description).slice(0, 120);
      return r;
    });
    await audit(req, 'role.update', role.name);
    return { role };
  });

  app.delete('/api/roles/:id', async (req) => {
    const name = await access.mutate((d) => {
      const r = d.roles.find((x) => x.id === req.params.id);
      if (!r) throw new HttpError(404, 'Role not found');
      if (r.builtin) throw new HttpError(400, 'Built-in roles cannot be deleted');
      if (d.users.some((u) => u.role === r.id)) throw new HttpError(409, 'Move the people in this role to another role first');
      d.roles = d.roles.filter((x) => x.id !== r.id);
      return r.name;
    });
    await audit(req, 'role.delete', name);
    return { ok: true };
  });
}
