import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { HttpError } from './util.js';
import { login, logoutCookie, readSession, parseCookies, hashPassword } from './auth.js';
import { requirement, satisfies } from './rbac.js';
import { startCollector } from './collector.js';
import { startScheduler } from './backups.js';
import { ensureSeeded, startScheduler as startAutomation } from './scripts.js';
import { startFollower } from './follower.js';
import { startNotifier } from './notify.js';

// `node index.js --hash <password>` prints a password hash for ADMIN_PASSWORD_HASH.
if (process.argv[2] === '--hash') { console.log(hashPassword(process.argv[3])); process.exit(0); }

const app = Fastify({ logger: { level: 'warn' }, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

app.addHook('onSend', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'same-origin')
    .header('Strict-Transport-Security', 'max-age=31536000')
    .header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://mc-heads.net https://cdn.modrinth.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
});

/** Runs for every API route (it is installed on the scope that contains them), whatever the URL looks like. */
async function guard(req) {
  const session = await readSession(parseCookies(req.headers.cookie).tz_session);
  if (!session) throw new HttpError(401, 'Please sign in');
  req.user = session;
  // Match on the route Fastify actually resolved, with its decoded parameters filled in.
  const pattern = req.routeOptions?.url || '';
  const path = pattern.replace(/:(\w+)/g, (_, k) => encodeURIComponent(req.params?.[k] ?? ''));
  const need = requirement(req.method, path);
  // Deny by default: a route must be listed in rbac.js, and the person's role must grant it.
  if (!need || !satisfies(session.perms, need.perm)) throw new HttpError(403, 'Your role does not allow this');
}

app.setErrorHandler((err, req, reply) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) req.log.error(err);
  reply.code(status).send({ error: status >= 500 && !err.status ? 'Something went wrong on the server' : err.message, needCode: err.needCode || undefined });
});

app.get('/api/health', async () => ({ ok: true }));
app.post('/api/login', async (req, reply) => login(req, reply, req.body || {}));
app.post('/api/logout', async (req, reply) => { reply.header('Set-Cookie', logoutCookie()); return { ok: true }; });

await app.register(async (api) => {
  api.addHook('onRequest', guard);
  for (const name of ['users', 'server', 'players', 'plugins', 'backups', 'worlds', 'settings', 'scripts', 'alerts', 'control', 'lp']) {
    await api.register((await import(`./routes/${name}.js`)).default);
  }
});

if (fs.existsSync(config.publicDir)) {
  await app.register(fastifyStatic, { root: config.publicDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
}

await ensureSeeded();
await startCollector();
startScheduler();
startAutomation();
startFollower();
startNotifier();
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Teczos Minecraft dashboard listening on :${config.port}`);
