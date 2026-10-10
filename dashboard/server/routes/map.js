import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.js';
import { HttpError, audit, exists } from '../util.js';
import { rcon } from '../mc.js';
import { installProject, gameVersion } from './plugins.js';

const dir = () => path.join(config.mcData, 'plugins', 'BlueMap');
const jars = async () => (await fsp.readdir(paths.plugins()).catch(() => [])).filter((f) => /^bluemap.*\.jar(\.disabled)?$/i.test(f));
const readConf = (f) => fsp.readFile(path.join(dir(), f), 'utf8').catch(() => '');
const ACTIONS = { update: 'bluemap update', freeze: 'bluemap freeze', unfreeze: 'bluemap unfreeze', reload: 'bluemap reload' };

export default async function (app) {
  /** BlueMap reports its render state through the console; turn that text into numbers. */
  async function renderStatus() {
    try {
      const text = await rcon('bluemap');
      return {
        text,
        progress: Number(text.match(/progress:\s*([\d.]+)%/)?.[1] ?? NaN),
        remaining: text.match(/remaining time:\s*(.+)/)?.[1]?.trim() || null,
        map: text.match(/map (\S+) is currently being updated/)?.[1] || null,
        pending: Number(text.match(/(\d+) maps? ha(?:s|ve) pending/)?.[1] ?? 0),
        paused: /frozen|paused|stopped/i.test(text) && !/is running/i.test(text),
        working: /currently being updated/.test(text),
      };
    } catch { return null; }
  }

  app.get('/api/map', async () => {
    const list = await jars();
    const core = await readConf('core.conf'), web = await readConf('webserver.conf');
    return {
      url: config.mapUrl,
      installed: list.length > 0, enabled: list.some((j) => !j.endsWith('.disabled')),
      configured: exists(path.join(dir(), 'core.conf')),
      acceptedDownload: /accept-download:\s*true/.test(core),
      webPort: Number(web.match(/^\s*port:\s*(\d+)/m)?.[1] || 8100),
      render: list.length ? await renderStatus() : null,
      maps: await Promise.all((await fsp.readdir(path.join(dir(), 'maps')).catch(() => [])).filter((f) => f.endsWith('.conf')).map(async (f) => (await fsp.readFile(path.join(dir(), 'maps', f), 'utf8')).match(/^name:\s*"(.+)"/m)?.[1] || f.replace(/\.conf$/, ''))),
    };
  });

  // Installs BlueMap and accepts its one-time download of Minecraft's textures from Mojang.
  app.post('/api/map/setup', async (req) => {
    await fsp.mkdir(dir(), { recursive: true });
    const core = path.join(dir(), 'core.conf');
    if (!exists(core)) await fsp.writeFile(core, 'accept-download: true\n');
    else if (!/accept-download:\s*true/.test(await readConf('core.conf'))) await fsp.writeFile(core, (await readConf('core.conf')).replace(/accept-download:\s*false/, 'accept-download: true'));
    let installed = [];
    if (!(await jars()).length) installed = await installProject('bluemap', await gameVersion());
    await audit(req, 'map.setup');
    return { installed, restartNeeded: true };
  });

  app.post('/api/map/:action', async (req) => {
    const cmd = ACTIONS[req.params.action];
    if (!cmd) throw new HttpError(400, 'Unknown map action');
    await rcon(cmd);
    await audit(req, `map.${req.params.action}`);
    return { ok: true };
  });
}
