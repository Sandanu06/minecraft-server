import net from 'node:net';
import { HttpError, stripColors } from './util.js';

const SERVERDATA_AUTH = 3, SERVERDATA_EXEC = 2;

function packet(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const out = Buffer.alloc(14 + b.length);
  out.writeInt32LE(10 + b.length, 0);
  out.writeInt32LE(id, 4);
  out.writeInt32LE(type, 8);
  b.copy(out, 12);
  return out;
}

/**
 * Runs one or more RCON commands over a single short-lived connection and returns their outputs in order.
 * After each command an empty marker packet is sent; the reply to the marker tells us the output is complete.
 */
export function rconRun({ host, port, password, commands, timeout = 8000 }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0), authed = false, done = false, index = 0, output = '';
    const results = [];
    const finish = (err, val) => {
      if (done) return; done = true; clearTimeout(timer); sock.destroy();
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new HttpError(504, 'RCON timed out')), timeout + commands.length * 600);
    const next = () => {
      if (index >= commands.length) return finish(null, results);
      sock.write(packet(2, SERVERDATA_EXEC, commands[index]));
      sock.write(packet(3, 200, ''));
    };
    sock.on('connect', () => sock.write(packet(1, SERVERDATA_AUTH, password)));
    sock.on('error', (e) => finish(new HttpError(503, `RCON unavailable: ${e.code || e.message}`)));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (buf.length < 4 + len) break;
        const id = buf.readInt32LE(4), body = buf.toString('utf8', 12, 4 + len - 2);
        buf = buf.subarray(4 + len);
        if (!authed) {
          if (id === -1) return finish(new HttpError(401, 'RCON password rejected'));
          if (id === 1) { authed = true; next(); }
        } else if (id === 2) output += body;
        else if (id === 3) { results.push(stripColors(output).trim()); output = ''; index += 1; next(); }
      }
    });
  });
}
export const rconExec = async (opts) => (await rconRun({ ...opts, commands: [opts.command] }))[0];
