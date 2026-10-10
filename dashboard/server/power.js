import { withOp } from './util.js';
import { live, refreshNow, markExpectedStop } from './collector.js';
import { startMc, stopMc, restartMc, killMc } from './docker.js';
import { rcon } from './mc.js';

/** start | stop | restart | kill, flushing the world first when the console is reachable. */
export async function power(action, { alreadyLocked = false } = {}) {
  const work = async () => {
    if (action !== 'start') markExpectedStop();
    if ((action === 'stop' || action === 'restart') && live.state === 'running') { try { await rcon('save-all flush'); } catch { /* docker stop still saves */ } }
    if (action === 'start') await startMc();
    if (action === 'stop') await stopMc();
    if (action === 'restart') await restartMc();
    if (action === 'kill') await killMc();
    await refreshNow();
  };
  return alreadyLocked ? work() : withOp(`server ${action}`, work);
}
