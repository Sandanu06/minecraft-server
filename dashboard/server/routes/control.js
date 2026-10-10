import { HttpError, audit, assertName } from '../util.js';
import { rcon, rconMany } from '../mc.js';

const ITEM_RE = /^[a-z0-9_.\-]+(:[a-z0-9_.\-/]+)?$/;
const MODES = ['survival', 'creative', 'adventure', 'spectator'];
const clean = (s, n = 200) => String(s || '').replace(/[\r\n]/g, ' ').slice(0, n).trim();
const num = (v, lo, hi, what) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `${what} must be between ${lo} and ${hi}`); return n; };

/* Game rules shown in the dashboard: [26.x name, older camelCase name, label]. The server decides which exist. */
export const GAMERULES = [
  ['keep_inventory', 'keepInventory', 'Keep inventory after dying'],
  ['mob_griefing', 'mobGriefing', 'Mobs can break blocks (creepers, endermen)'],
  ['advance_time', 'doDaylightCycle', 'Day and night cycle'],
  ['advance_weather', 'doWeatherCycle', 'Weather changes'],
  ['spawn_mobs', 'doMobSpawning', 'Mobs spawn naturally'],
  ['spawn_monsters', null, 'Hostile mobs spawn'],
  ['spawn_phantoms', 'doInsomnia', 'Phantoms spawn'],
  ['spawn_wandering_traders', 'doTraderSpawning', 'Wandering traders spawn'],
  ['spawn_patrols', 'doPatrolSpawning', 'Pillager patrols spawn'],
  ['players_sleeping_percentage', 'playersSleepingPercentage', 'Players that must sleep to skip the night (%)'],
  ['immediate_respawn', 'doImmediateRespawn', 'Respawn immediately'],
  ['show_death_messages', 'showDeathMessages', 'Show death messages'],
  ['natural_health_regeneration', 'naturalRegeneration', 'Natural health regeneration'],
  ['random_tick_speed', 'randomTickSpeed', 'Random tick speed (crop growth)'],
  ['tnt_explodes', null, 'TNT explodes'],
  ['mob_drops', 'doMobLoot', 'Mobs drop items'],
  ['block_drops', 'doTileDrops', 'Blocks drop items'],
  ['pvp', null, 'Player vs player'],
  ['water_source_conversion', null, 'Water makes new source blocks'],
  ['lava_source_conversion', null, 'Lava makes new source blocks'],
];

const VALUE = /(?:currently set to|is currently set to):?\s*(\S+)/i;

export default async function (app) {
  app.get('/api/world-control', async () => {
    const cmds = ['difficulty', 'time query day', 'time query daytime', 'worldborder get'];
    for (const [snake, camel] of GAMERULES) { cmds.push(`gamerule ${snake}`); if (camel) cmds.push(`gamerule ${camel}`); }
    const out = await rconMany(cmds);
    let i = 4;
    const gamerules = GAMERULES.map(([snake, camel, label]) => {
      const a = out[i++]; const b = camel ? out[i++] : '';
      const hit = [[snake, a], [camel, b]].find(([, t]) => t && VALUE.test(t));
      const value = hit ? hit[1].match(VALUE)[1] : null;
      return { name: snake, label, value, supported: !!hit, usedName: hit?.[0] || snake, kind: value && /^-?\d+$/.test(value) ? 'number' : 'bool' };
    }).filter((r) => r.supported);
    const tick = (t) => { const m = (t || '').match(/(\d+)\s*tick/i) || (t || '').match(/time is (\d+)/i); return m ? Number(m[1]) : null; };
    return {
      difficulty: (out[0].match(/difficulty is (\w+)/i) || [])[1] || null,
      daytime: tick(out[1]) ?? tick(out[2]),
      worldBorder: Number((out[3].match(/(\d+(?:\.\d+)?)/) || [])[1] ?? NaN),
      gamerules,
    };
  });

  app.post('/api/world-control/time', async (req) => {
    const v = String(req.body?.value ?? '');
    const named = ['day', 'noon', 'night', 'midnight'];
    const arg = named.includes(v) ? v : String(num(v, 0, 24000, 'Time'));
    await rcon(`time set ${arg}`); await audit(req, 'world.time', arg); return { ok: true };
  });
  app.post('/api/world-control/weather', async (req) => {
    const kind = String(req.body?.kind || '');
    if (!['clear', 'rain', 'thunder'].includes(kind)) throw new HttpError(400, 'Choose clear, rain or thunder');
    await rcon(`weather ${kind}`); await audit(req, 'world.weather', kind); return { ok: true };
  });
  app.post('/api/world-control/difficulty', async (req) => {
    const v = String(req.body?.value || '');
    if (!['peaceful', 'easy', 'normal', 'hard'].includes(v)) throw new HttpError(400, 'Unknown difficulty');
    await rcon(`difficulty ${v}`); await audit(req, 'world.difficulty', v); return { ok: true };
  });
  app.post('/api/world-control/gamerule', async (req) => {
    const def = GAMERULES.find(([n]) => n === req.body?.name);
    if (!def) throw new HttpError(400, 'Unknown game rule');
    const value = typeof req.body.value === 'boolean' ? String(req.body.value) : String(num(req.body.value, 0, 100000, 'Value'));
    let out = await rcon(`gamerule ${def[0]} ${value}`);
    if (/unknown|incorrect|expected/i.test(out) && def[1]) out = await rcon(`gamerule ${def[1]} ${value}`);
    if (/unknown|incorrect|expected/i.test(out)) throw new HttpError(400, 'The server did not accept that game rule');
    await audit(req, 'world.gamerule', `${def[0]}=${value}`);
    return { ok: true, output: out };
  });
  app.post('/api/world-control/worldborder', async (req) => {
    const size = num(req.body?.size, 1, 59999968, 'Border size');
    await rcon(`worldborder set ${size}`); await audit(req, 'world.border', String(size)); return { ok: true };
  });
  app.post('/api/world-control/save', async (req) => { await rcon('save-all flush'); await audit(req, 'world.save'); return { ok: true }; });

  /* ---- per-player actions ---- */
  app.post('/api/player-control/:name/:action', async (req) => {
    const name = assertName(req.params.name), b = req.body || {};
    let command;
    switch (req.params.action) {
      case 'gamemode': if (!MODES.includes(b.mode)) throw new HttpError(400, 'Unknown game mode'); command = `gamemode ${b.mode} ${name}`; break;
      case 'teleport-to': command = `tp ${name} ${assertName(b.target)}`; break;
      case 'teleport-xyz': command = `tp ${name} ${num(b.x, -3e7, 3e7, 'X')} ${num(b.y, -2048, 4096, 'Y')} ${num(b.z, -3e7, 3e7, 'Z')}`; break;
      case 'give': {
        if (!ITEM_RE.test(b.item || '')) throw new HttpError(400, 'Use an item id like diamond or minecraft:oak_log');
        command = `give ${name} ${b.item} ${Math.round(num(b.count ?? 1, 1, 2304, 'Amount'))}`; break;
      }
      case 'message': if (!clean(b.text)) throw new HttpError(400, 'Write a message'); command = `msg ${name} ${clean(b.text)}`; break;
      case 'heal': command = `effect give ${name} minecraft:instant_health 1 10 true`; break;
      case 'feed': command = `effect give ${name} minecraft:saturation 1 10 true`; break;
      case 'kill': command = `kill ${name}`; break;
      case 'clear': command = `clear ${name}`; break;
      default: throw new HttpError(400, 'Unknown action');
    }
    const output = await rcon(command);
    await audit(req, `player.${req.params.action}`, `${name}${b.item ? ` ${b.item}` : ''}`);
    return { output };
  });
}
