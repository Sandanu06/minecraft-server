import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { config, paths } from '../config.js';
import { HttpError, audit, run, readJson, writeJson } from '../util.js';
import { currentVersion } from '../mc.js';

const API = 'https://api.modrinth.com/v2';
const LOADERS = ['paper', 'spigot', 'bukkit', 'purpur', 'folia'];
const trackFile = () => path.join(config.mcData, '.dashboard', 'installed.json');
const FILE_RE = /^[\w.+()\- ]+\.jar(\.disabled)?$/;

async function modrinth(p) {
  const res = await fetch(`${API}${p}`, { headers: { 'User-Agent': config.modrinthUA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new HttpError(502, `Modrinth answered ${res.status}`);
  return res.json();
}

const gameVersion = currentVersion;

async function pluginMeta(file, mtime) {
  const cacheKey = `${file}:${mtime}`;
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);
  let meta = { name: file.replace(/\.jar(\.disabled)?$/, ''), version: '', description: '' };
  for (const yml of ['paper-plugin.yml', 'plugin.yml']) {
    try {
      const text = await run('unzip', ['-p', path.join(paths.plugins(), file), yml]);
      const get = (k) => text.match(new RegExp(`^${k}:\\s*['"]?(.+?)['"]?\\s*$`, 'm'))?.[1] || '';
      meta = { name: get('name') || meta.name, version: get('version'), description: get('description') };
      break;
    } catch { /* try next descriptor */ }
  }
  metaCache.set(cacheKey, meta);
  return meta;
}
const metaCache = new Map();

async function latestVersion(projectId, gv) {
  const q = new URLSearchParams({ loaders: JSON.stringify(LOADERS) });
  if (gv) q.set('game_versions', JSON.stringify([gv]));
  const versions = await modrinth(`/project/${projectId}/version?${q}`);
  return versions.find((v) => v.version_type === 'release') || versions[0] || null;
}

async function download(version, targetDir) {
  const file = version.files.find((f) => f.primary) || version.files[0];
  if (!file || !FILE_RE.test(file.filename)) throw new HttpError(502, 'Unexpected file from Modrinth');
  await fsp.mkdir(targetDir, { recursive: true });
  const res = await fetch(file.url, { headers: { 'User-Agent': config.modrinthUA }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new HttpError(502, 'Download failed');
  const tmp = path.join(targetDir, `.${file.filename}.part`);
  await pipeline(res.body, fs.createWriteStream(tmp));
  const hash = crypto.createHash('sha512').update(await fsp.readFile(tmp)).digest('hex');
  if (file.hashes?.sha512 && hash !== file.hashes.sha512) { await fsp.rm(tmp); throw new HttpError(502, 'Checksum mismatch, download discarded'); }
  await fsp.rename(tmp, path.join(targetDir, file.filename));
  return file.filename;
}

async function installProject(projectId, gv, seen = new Set()) {
  if (seen.has(projectId)) return [];
  seen.add(projectId);
  const version = await latestVersion(projectId, gv);
  if (!version) throw new HttpError(404, gv ? `No release for Minecraft ${gv}` : 'No release found');
  const project = await modrinth(`/project/${projectId}`);
  const tracked = await readJson(trackFile(), {});
  const old = tracked[project.id]?.file;
  const filename = await download(version, paths.plugins());
  if (old && old !== filename) await fsp.rm(path.join(paths.plugins(), old), { force: true });
  tracked[project.id] = { slug: project.slug, title: project.title, icon: project.icon_url, file: filename, versionId: version.id, versionNumber: version.version_number, installedAt: new Date().toISOString() };
  await writeJson(trackFile(), tracked);
  const installed = [{ title: project.title, file: filename, version: version.version_number }];
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id && !tracked[dep.project_id]) {
      try { installed.push(...await installProject(dep.project_id, gv, seen)); } catch { /* optional best effort */ }
    }
  }
  return installed;
}

// Hand-picked plugins, shown only when a release exists for the running Minecraft version.
const FEATURED = [
  ['luckperms', 'Ranks and permissions: decide who can do what'],
  ['viaversion', 'Lets players on newer game versions join'],
  ['viabackwards', 'Lets players on older game versions join'],
  ['authmereloaded', 'Passwords for offline-mode players, so nobody can steal a name'],
  ['worldguard', 'Protect areas and spawn from griefing'],
  ['coreprotect', 'See who changed what, and roll it back'],
  ['worldedit', 'Build and reshape terrain quickly'],
  ['chunky', 'Pre-generate the world to cut exploration lag'],
  ['placeholderapi', 'Shared placeholders that many plugins rely on'],
  ['multiverse-core', 'Run several worlds with portals between them'],
];
let featuredCache = { at: 0, key: '', data: [] };

export default async function (app) {
  await app.register((await import('@fastify/multipart')).default, { limits: { fileSize: 150 * 1024 * 1024, files: 1 } });

  app.get('/api/plugins', async () => {
    await fsp.mkdir(paths.plugins(), { recursive: true });
    const tracked = await readJson(trackFile(), {});
    const byFile = Object.fromEntries(Object.entries(tracked).map(([id, t]) => [t.file, { id, ...t }]));
    const files = (await fsp.readdir(paths.plugins())).filter((f) => FILE_RE.test(f));
    const items = await Promise.all(files.map(async (f) => {
      const st = await fsp.stat(path.join(paths.plugins(), f));
      const meta = await pluginMeta(f, st.mtimeMs);
      return { file: f, enabled: !f.endsWith('.disabled'), size: st.size, modified: st.mtime, ...meta, source: byFile[f] ? { id: byFile[f].id, slug: byFile[f].slug, icon: byFile[f].icon, versionId: byFile[f].versionId } : null };
    }));
    return { plugins: items.sort((a, b) => a.name.localeCompare(b.name)), gameVersion: await gameVersion() };
  });

  app.get('/api/plugins/featured', async () => {
    const gv = await gameVersion();
    if (featuredCache.key === gv && Date.now() - featuredCache.at < 10 * 60 * 1000) return { gameVersion: gv, items: featuredCache.data };
    const ids = FEATURED.map(([slug]) => slug);
    const projects = await modrinth(`/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`);
    const tracked = await readJson(trackFile(), {});
    const items = (await Promise.all(FEATURED.map(async ([slug, why]) => {
      const p = projects.find((x) => x.slug === slug);
      if (!p) return null;
      const v = await latestVersion(p.id, gv).catch(() => null);
      return v ? { id: p.id, slug, title: p.title, description: why, icon: p.icon_url, downloads: p.downloads, version: v.version_number, installed: !!tracked[p.id] } : null;
    }))).filter(Boolean);
    featuredCache = { at: Date.now(), key: gv, data: items };
    return { gameVersion: gv, items };
  });

  app.get('/api/plugins/search', async (req) => {
    const gv = req.query.all === '1' ? '' : await gameVersion();
    const facets = [['project_type:mod', 'project_type:plugin'], LOADERS.map((l) => `categories:${l}`)];
    if (gv) facets.push([`versions:${gv}`]);
    const q = new URLSearchParams({ limit: '24', index: req.query.q ? 'relevance' : 'downloads', facets: JSON.stringify(facets) });
    if (req.query.q) q.set('query', String(req.query.q).slice(0, 80));
    const data = await modrinth(`/search?${q}`);
    const tracked = await readJson(trackFile(), {});
    return {
      gameVersion: gv, total: data.total_hits,
      hits: data.hits.map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, author: h.author, icon: h.icon_url, downloads: h.downloads, categories: h.display_categories, updated: h.date_modified, installed: !!tracked[h.project_id] })),
    };
  });

  app.post('/api/plugins/install', async (req) => {
    const id = String(req.body?.id || '');
    if (!/^[A-Za-z0-9]{8}$/.test(id)) throw new HttpError(400, 'Invalid project');
    const installed = await installProject(id, await gameVersion());
    await audit(req, 'plugin.install', installed.map((i) => `${i.title} ${i.version}`).join(', '));
    return { installed, restartNeeded: true };
  });

  app.get('/api/plugins/updates', async () => {
    const tracked = await readJson(trackFile(), {});
    const gv = await gameVersion();
    const updates = [];
    await Promise.all(Object.entries(tracked).map(async ([id, t]) => {
      try { const v = await latestVersion(id, gv); if (v && v.id !== t.versionId) updates.push({ id, title: t.title, current: t.versionNumber, latest: v.version_number }); } catch { /* skip */ }
    }));
    return { updates };
  });

  app.post('/api/plugins/upload', async (req) => {
    const part = await req.file();
    if (!part) throw new HttpError(400, 'Choose a .jar file');
    const name = path.basename(part.filename || '');
    if (!FILE_RE.test(name) || name.endsWith('.disabled')) throw new HttpError(400, 'Only .jar plugin files are accepted');
    await fsp.mkdir(paths.plugins(), { recursive: true });
    const target = path.join(paths.plugins(), name);
    await pipeline(part.file, fs.createWriteStream(target));
    if (part.file.truncated) { await fsp.rm(target, { force: true }); throw new HttpError(413, 'File is too large (150 MB max)'); }
    await audit(req, 'plugin.upload', name);
    return { ok: true, file: name, restartNeeded: true };
  });

  const resolveFile = (name) => {
    if (!FILE_RE.test(name || '')) throw new HttpError(400, 'Invalid plugin file');
    return path.join(paths.plugins(), name);
  };

  app.post('/api/plugins/:file/toggle', async (req) => {
    const from = resolveFile(req.params.file);
    const to = req.params.file.endsWith('.disabled') ? from.replace(/\.disabled$/, '') : `${from}.disabled`;
    await fsp.rename(from, to);
    const tracked = await readJson(trackFile(), {});
    for (const t of Object.values(tracked)) if (t.file === req.params.file) t.file = path.basename(to);
    await writeJson(trackFile(), tracked);
    await audit(req, 'plugin.toggle', req.params.file);
    return { ok: true, restartNeeded: true };
  });

  app.delete('/api/plugins/:file', async (req) => {
    await fsp.rm(resolveFile(req.params.file), { force: true });
    const tracked = await readJson(trackFile(), {});
    for (const [id, t] of Object.entries(tracked)) if (t.file === req.params.file) delete tracked[id];
    await writeJson(trackFile(), tracked);
    await audit(req, 'plugin.delete', req.params.file);
    return { ok: true, restartNeeded: true };
  });
}
