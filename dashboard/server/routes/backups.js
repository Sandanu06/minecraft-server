import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError, audit, withOp } from '../util.js';
import { listBackups, createBackup, restoreBackup, getSchedule, setSchedule, NAME_OK } from '../backups.js';
import { disk } from '../collector.js';

const guard = (name) => { if (!NAME_OK.test(name || '')) throw new HttpError(400, 'Invalid backup name'); return path.join(config.backupDir, name); };

export default async function (app) {
  app.get('/api/backups', async () => ({ backups: await listBackups(), schedule: await getSchedule(), disk: disk.backups }));

  app.post('/api/backups', async (req) => {
    const note = String(req.body?.note || 'manual').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'manual';
    const r = await withOp('backup', (progress) => createBackup(note, progress));
    await audit(req, 'backup.create', r.name);
    return r;
  });

  app.post('/api/backups/:name/restore', async (req) => {
    guard(req.params.name);
    withOp('restore', (progress) => restoreBackup(req.params.name, progress))
      .then(() => audit(req, 'backup.restore', req.params.name))
      .catch((e) => audit(req, 'backup.restore.failed', `${req.params.name}: ${e.message}`));
    return { started: true };
  });

  app.get('/api/backups/:name/download', async (req, reply) => {
    const file = guard(req.params.name);
    const st = await fsp.stat(file).catch(() => { throw new HttpError(404, 'Backup not found'); });
    reply.header('Content-Type', 'application/gzip').header('Content-Length', st.size).header('Content-Disposition', `attachment; filename="${req.params.name}"`);
    await audit(req, 'backup.download', req.params.name);
    return reply.send(fs.createReadStream(file));
  });

  app.delete('/api/backups/:name', async (req) => {
    await fsp.rm(guard(req.params.name), { force: true });
    await audit(req, 'backup.delete', req.params.name);
    return { ok: true };
  });

  app.put('/api/backups/schedule', async (req) => {
    const { enabled, hourUtc, keep } = req.body || {};
    const patch = {};
    if (typeof enabled === 'boolean') patch.enabled = enabled;
    if (Number.isInteger(hourUtc) && hourUtc >= 0 && hourUtc <= 23) patch.hourUtc = hourUtc;
    if (Number.isInteger(keep) && keep >= 1 && keep <= 60) patch.keep = keep;
    const next = await setSchedule(patch);
    await audit(req, 'backup.schedule', JSON.stringify(patch));
    return next;
  });
}
