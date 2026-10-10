import { HttpError, audit } from '../util.js';
import { scriptStore, scheduleStore, runs, startRun, cancelRun, parseScript, validateWhen, validTimezone } from '../scripts.js';
import { newId } from '../access.js';

const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const publicRun = (r, full) => ({ id: r.id, scriptId: r.scriptId, name: r.name, user: r.user, startedAt: r.startedAt, endedAt: r.endedAt, status: r.status, step: r.step, total: r.total, ...(full ? { lines: r.lines } : {}) });

export default async function (app) {
  const canRun = (script, user) => script.enabled && (user.role === 'owner' || script.roles.length === 0 || script.roles.includes(user.role));

  app.get('/api/scripts', async (req) => {
    const d = await scriptStore.read();
    return { scripts: d.scripts.map((s) => ({ ...s, canRun: canRun(s, req.user) && req.user.perms.has('scripts.run') })) };
  });

  function clean(body, existing) {
    const name = clip(body.name ?? existing?.name, 60);
    if (name.length < 2) throw new HttpError(400, 'Give the script a name');
    const text = String(body.body ?? existing?.body ?? '');
    if (text.length > 20000) throw new HttpError(400, 'That script is too long');
    parseScript(text);   // throws a readable error with the line number
    return { name, description: clip(body.description ?? existing?.description, 160), body: text, enabled: body.enabled ?? existing?.enabled ?? true, roles: Array.isArray(body.roles) ? body.roles.map(String).slice(0, 20) : existing?.roles || [] };
  }

  app.post('/api/scripts', async (req) => {
    const fields = clean(req.body || {});
    const script = await scriptStore.mutate((d) => { const s = { id: newId(), ...fields, createdBy: req.user.username, updatedAt: new Date().toISOString() }; d.scripts.push(s); return s; });
    await audit(req, 'script.create', script.name);
    return { script };
  });
  app.put('/api/scripts/:id', async (req) => {
    const script = await scriptStore.mutate((d) => {
      const s = d.scripts.find((x) => x.id === req.params.id);
      if (!s) throw new HttpError(404, 'Script not found');
      Object.assign(s, clean(req.body || {}, s), { updatedAt: new Date().toISOString() });
      return s;
    });
    await audit(req, 'script.update', script.name);
    return { script };
  });
  app.delete('/api/scripts/:id', async (req) => {
    const sch = await scheduleStore.read();
    if (sch.schedules.some((x) => x.target.scriptId === req.params.id)) throw new HttpError(409, 'A schedule uses this script. Remove the schedule first.');
    const name = await scriptStore.mutate((d) => { const s = d.scripts.find((x) => x.id === req.params.id); if (!s) throw new HttpError(404, 'Script not found'); d.scripts = d.scripts.filter((x) => x !== s); return s.name; });
    await audit(req, 'script.delete', name);
    return { ok: true };
  });

  app.post('/api/scripts/:id/run', async (req) => {
    const s = (await scriptStore.read()).scripts.find((x) => x.id === req.params.id);
    if (!s) throw new HttpError(404, 'Script not found');
    if (!canRun(s, req.user)) throw new HttpError(403, s.enabled ? 'Your role is not allowed to run this script' : 'This script is turned off');
    const run = startRun(s, req.user.username);
    await audit(req, 'script.run', s.name);
    return { run: publicRun(run) };
  });

  app.get('/api/script-runs', async () => ({ runs: runs.map((r) => publicRun(r)) }));
  app.get('/api/script-runs/:id', async (req) => {
    const r = runs.find((x) => x.id === req.params.id);
    if (!r) throw new HttpError(404, 'Run not found');
    return { run: publicRun(r, true) };
  });
  app.post('/api/script-runs/:id/cancel', async (req) => { cancelRun(req.params.id); await audit(req, 'script.cancel', req.params.id); return { ok: true }; });

  /* ---- schedules ---- */
  app.get('/api/schedules', async () => { const d = await scheduleStore.read(); return { schedules: d.schedules, timezone: d.timezone }; });

  async function cleanSchedule(body, existing) {
    const name = clip(body.name ?? existing?.name, 60);
    if (name.length < 2) throw new HttpError(400, 'Give the schedule a name');
    const t = body.target ?? existing?.target;
    if (!t || !['script', 'backup', 'restart'].includes(t.type)) throw new HttpError(400, 'Choose what to run');
    if (t.type === 'script' && !(await scriptStore.read()).scripts.some((s) => s.id === t.scriptId)) throw new HttpError(400, 'Choose a script');
    return { name, enabled: body.enabled ?? existing?.enabled ?? true, target: t.type === 'script' ? { type: 'script', scriptId: t.scriptId } : { type: t.type }, when: validateWhen(body.when ?? existing?.when) };
  }
  app.post('/api/schedules', async (req) => {
    const f = await cleanSchedule(req.body || {});
    const schedule = await scheduleStore.mutate((d) => { const s = { id: newId(), ...f, lastRunAt: null, lastStatus: null, createdAt: new Date().toISOString() }; d.schedules.push(s); return s; });
    await audit(req, 'schedule.create', schedule.name);
    return { schedule };
  });
  app.put('/api/schedules/timezone', async (req) => {
    const tz = String(req.body?.timezone || '');
    if (!validTimezone(tz)) throw new HttpError(400, 'Unknown time zone');
    await scheduleStore.mutate((d) => { d.timezone = tz; });
    await audit(req, 'schedule.timezone', tz);
    return { timezone: tz };
  });
  app.put('/api/schedules/:id', async (req) => {
    const existing = (await scheduleStore.read()).schedules.find((x) => x.id === req.params.id);
    if (!existing) throw new HttpError(404, 'Schedule not found');
    const f = await cleanSchedule(req.body || {}, existing);
    const schedule = await scheduleStore.mutate((d) => { const s = d.schedules.find((x) => x.id === req.params.id); Object.assign(s, f); return s; });
    await audit(req, 'schedule.update', schedule.name);
    return { schedule };
  });
  app.delete('/api/schedules/:id', async (req) => {
    const name = await scheduleStore.mutate((d) => { const s = d.schedules.find((x) => x.id === req.params.id); if (!s) throw new HttpError(404, 'Schedule not found'); d.schedules = d.schedules.filter((x) => x !== s); return s.name; });
    await audit(req, 'schedule.delete', name);
    return { ok: true };
  });
}
