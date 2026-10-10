import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { HttpError } from './util.js';
import { login, logoutCookie, readSession, parseCookies, hashPassword } from './auth.js';
import { startCollector } from './collector.js';
import { startScheduler } from './backups.js';

// `node index.js --hash <password>` prints a password hash for ADMIN_PASSWORD_HASH.
if (process.argv[2] === '--hash') { console.log(hashPassword(process.argv[3])); process.exit(0); }

const app = Fastify({ logger: { level: 'warn' }, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

app.addHook('onSend', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'same-origin');
  if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
});

const OPEN = new Set(['/api/login', '/api/health']);
app.addHook('onRequest', async (req, reply) => {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/') || OPEN.has(url)) return;
  const session = await readSession(parseCookies(req.headers.cookie).tz_session);
  if (!session) throw new HttpError(401, 'Please sign in');
  req.user = session.u;
});

app.setErrorHandler((err, req, reply) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) req.log.error(err);
  reply.code(status).send({ error: status >= 500 && !err.status ? 'Something went wrong on the server' : err.message });
});

app.get('/api/health', async () => ({ ok: true }));
app.post('/api/login', async (req, reply) => login(req, reply, req.body || {}));
app.post('/api/logout', async (req, reply) => { reply.header('Set-Cookie', logoutCookie()); return { ok: true }; });
app.get('/api/me', async (req) => ({ user: req.user }));

for (const name of ['server', 'players', 'plugins', 'backups', 'worlds', 'settings']) {
  await app.register((await import(`./routes/${name}.js`)).default);
}

if (fs.existsSync(config.publicDir)) {
  await app.register(fastifyStatic, { root: config.publicDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
}

await startCollector();
startScheduler();
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Teczos Minecraft dashboard listening on :${config.port}`);
