import { config } from '../config.js';
import { HttpError, audit, withOp, currentOp, readAudit } from '../util.js';
import { live, history, disk, refreshNow } from '../collector.js';
import { startMc, stopMc, restartMc, killMc, streamLogs, recentLogs } from '../docker.js';
import { rcon, readProps, readRuntime, currentVersion } from '../mc.js';

export default async function (app) {
  app.get('/api/overview', async () => {
    const [{ props }, runtime, version] = await Promise.all([readProps(), readRuntime(), currentVersion()]);
    return {
      live, op: currentOp(), disk,
      runtime: { ...runtime, version },
      server: {
        motd: props.motd, port: props['server-port'], maxPlayers: Number(props['max-players'] || 0),
        difficulty: props.difficulty, gamemode: props.gamemode, whitelist: props['white-list'] === 'true',
        onlineMode: props['online-mode'] === 'true', rcon: props['enable-rcon'] === 'true',
        level: props['level-name'], viewDistance: Number(props['view-distance'] || 0), simulationDistance: Number(props['simulation-distance'] || 0),
      },
    };
  });

  app.post('/api/server/:action', async (req) => {
    const { action } = req.params;
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) throw new HttpError(400, 'Unknown action');
    await withOp(`server ${action}`, async () => {
      // Flush the world to disk before a stop or restart when we can.
      if ((action === 'stop' || action === 'restart') && live.state === 'running') { try { await rcon('save-all flush'); } catch { /* docker stop still saves */ } }
      if (action === 'start') await startMc();
      if (action === 'stop') await stopMc();
      if (action === 'restart') await restartMc();
      if (action === 'kill') await killMc();
    });
    await refreshNow();
    await audit(req, `server.${action}`);
    return { ok: true };
  });

  app.post('/api/console', async (req) => {
    const command = String(req.body?.command || '').trim().replace(/^\//, '');
    if (!command || command.length > 400) throw new HttpError(400, 'Type a command');
    if (/^stop\b/i.test(command)) throw new HttpError(400, 'Use the power switch to stop the server, so it stays off.');
    const output = await rcon(command);
    await audit(req, 'console', command.slice(0, 200));
    return { output };
  });

  app.get('/api/logs', async (req) => ({ text: await recentLogs(Math.min(Number(req.query.tail) || 300, 2000)) }));

  // Live log tail over Server-Sent Events.
  app.get('/api/logs/stream', async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const ctl = new AbortController();
    const hb = setInterval(() => res.write(': ping\n\n'), 20000);
    req.raw.on('close', () => { ctl.abort(); clearInterval(hb); });
    try {
      await streamLogs({
        tail: Math.min(Number(req.query.tail) || 200, 1000), signal: ctl.signal,
        onLine: (line) => { if (line === null) { if (!res.writableEnded) { res.write('event: end\ndata: {}\n\n'); res.end(); } } else res.write(`data: ${JSON.stringify(line)}\n\n`); },
      });
    } catch (e) { res.write(`event: error\ndata: ${JSON.stringify(e.message)}\n\n`); res.end(); }
  });

  app.get('/api/history', async (req) => ({ points: req.query.range === '24h' ? history.long : history.short }));
  app.get('/api/audit', async () => ({ entries: await readAudit(300) }));
}
