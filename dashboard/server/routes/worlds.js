import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { HttpError, audit, dirSize, exists } from '../util.js';
import { readProps, writeProps, parseNbt } from '../mc.js';
import zlib from 'node:zlib';

const NAME = /^[A-Za-z0-9_\-]{1,32}$/;

async function worldMeta(dir) {
  try {
    const nbt = parseNbt(zlib.gunzipSync(await fsp.readFile(path.join(dir, 'level.dat'))));
    const d = nbt.Data || nbt;
    return { version: d.Version?.Name || null, dataVersion: d.DataVersion || null, seed: d.WorldGenSettings?.seed ?? null, lastPlayed: d.LastPlayed || null, gameTime: d.Time || null, hardcore: !!d.hardcore };
  } catch { return {}; }
}

export default async function (app) {
  app.get('/api/worlds', async () => {
    const { props } = await readProps();
    const active = props['level-name'] || 'world';
    const entries = await fsp.readdir(config.mcData, { withFileTypes: true });
    const worlds = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = path.join(config.mcData, e.name);
      if (!exists(path.join(dir, 'level.dat'))) continue;
      worlds.push({ name: e.name, active: e.name === active, size: await dirSize(dir), ...(await worldMeta(dir)) });
    }
    return { worlds: worlds.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), active, pendingNew: !worlds.some((w) => w.name === active) ? active : null };
  });

  app.post('/api/worlds/activate', async (req) => {
    const name = String(req.body?.name || '');
    if (!NAME.test(name)) throw new HttpError(400, 'Invalid world name');
    const create = !!req.body?.create;
    if (!create && !exists(path.join(config.mcData, name, 'level.dat'))) throw new HttpError(404, 'That world does not exist');
    const changes = { 'level-name': name };
    if (create) changes['level-seed'] = String(req.body?.seed || '').replace(/[\r\n]/g, '').slice(0, 40);
    await writeProps(changes);
    await audit(req, create ? 'world.create' : 'world.activate', name);
    return { ok: true, restartNeeded: true };
  });

  app.get('/api/worlds/:name/download', async (req, reply) => {
    if (!NAME.test(req.params.name) || !exists(path.join(config.mcData, req.params.name, 'level.dat'))) throw new HttpError(404, 'World not found');
    const tar = spawn('tar', ['-czf', '-', '-C', config.mcData, req.params.name]);
    reply.header('Content-Type', 'application/gzip').header('Content-Disposition', `attachment; filename="${req.params.name}.tgz"`);
    await audit(req, 'world.download', req.params.name);
    req.raw.on('close', () => tar.kill());
    return reply.send(tar.stdout);
  });

  // Worlds are never hard-deleted: they move to .trash where a person can still recover them.
  app.delete('/api/worlds/:name', async (req) => {
    const { props } = await readProps();
    const { name } = req.params;
    if (!NAME.test(name) || !exists(path.join(config.mcData, name, 'level.dat'))) throw new HttpError(404, 'World not found');
    if (name === (props['level-name'] || 'world')) throw new HttpError(409, 'Switch to another world before removing the active one');
    await fsp.mkdir(path.join(config.mcData, '.trash'), { recursive: true });
    await fsp.rename(path.join(config.mcData, name), path.join(config.mcData, '.trash', `${name}-${Date.now()}`));
    await audit(req, 'world.trash', name);
    return { ok: true };
  });
}
