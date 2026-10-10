import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError, audit, assertName } from '../util.js';
import { rcon, parseList, readNamedJson, readProps, worldInfo, writeProps } from '../mc.js';
import { live } from '../collector.js';

async function playtime(uuid, worldDir) {
  for (const p of [`players/stats/${uuid}.json`, `stats/${uuid}.json`]) {
    try {
      const j = JSON.parse(await fsp.readFile(path.join(worldDir, p), 'utf8'));
      const ticks = j.stats?.['minecraft:custom']?.['minecraft:play_time'] ?? j.stats?.['minecraft:custom']?.['minecraft:play_one_minute'];
      if (ticks != null) return Math.round(ticks / 20);
    } catch { /* not found */ }
  }
  return null;
}

export default async function (app) {
  app.get('/api/players', async () => {
    const [ops, whitelist, bans, ipBans, cache, { props }, world] = await Promise.all([
      readNamedJson('ops.json'), readNamedJson('whitelist.json'), readNamedJson('banned-players.json'),
      readNamedJson('banned-ips.json'), readNamedJson('usercache.json'), readProps(), worldInfo(),
    ]);
    let online = live.players;
    try { online = parseList(await rcon('list')); } catch { /* offline */ }
    const opSet = new Set(ops.map((o) => o.name.toLowerCase()));
    const wlSet = new Set(whitelist.map((o) => o.name.toLowerCase()));
    const banSet = new Set(bans.map((o) => o.name.toLowerCase()));
    const known = await Promise.all(cache.map(async (p) => ({
      name: p.name, uuid: p.uuid, expiresOn: p.expiresOn,
      op: opSet.has(p.name.toLowerCase()), whitelisted: wlSet.has(p.name.toLowerCase()), banned: banSet.has(p.name.toLowerCase()),
      online: online.names.includes(p.name), playSeconds: await playtime(p.uuid, world.dir),
    })));
    return {
      online, known, ops, whitelist, bans, ipBans,
      whitelistEnabled: props['white-list'] === 'true', maxPlayers: Number(props['max-players'] || 0),
    };
  });

  const simple = {
    op: (n) => `op ${n}`, deop: (n) => `deop ${n}`,
    'whitelist-add': (n) => `whitelist add ${n}`, 'whitelist-remove': (n) => `whitelist remove ${n}`,
    kick: (n, r) => `kick ${n} ${r || 'Removed by an admin'}`,
    ban: (n, r) => `ban ${n} ${r || 'Banned by an admin'}`, pardon: (n) => `pardon ${n}`,
  };
  app.post('/api/players/:action', async (req) => {
    const build = simple[req.params.action];
    if (!build) throw new HttpError(400, 'Unknown action');
    const name = assertName(req.body?.name);
    const reason = String(req.body?.reason || '').replace(/[\r\n]/g, ' ').slice(0, 120);
    const output = await rcon(build(name, reason));
    await audit(req, `player.${req.params.action}`, name);
    return { output };
  });

  app.post('/api/whitelist/enabled', async (req) => {
    const on = !!req.body?.on;
    await rcon(`whitelist ${on ? 'on' : 'off'}`);
    await writeProps({ 'white-list': on, 'enforce-whitelist': on });
    await audit(req, 'whitelist.enabled', String(on));
    return { ok: true };
  });

  app.post('/api/broadcast', async (req) => {
    const message = String(req.body?.message || '').replace(/[\r\n]/g, ' ').slice(0, 200).trim();
    if (!message) throw new HttpError(400, 'Write a message first');
    await rcon(`say ${message}`);
    await audit(req, 'broadcast', message);
    return { ok: true };
  });
}
