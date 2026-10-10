/** Permission catalog, built-in roles, and the route -> permission map (deny by default). */

export const PERMISSIONS = [
  { id: 'view', group: 'General', label: 'See the overview and monitoring' },
  { id: 'server.power', group: 'Server', label: 'Start, stop and restart the server' },
  { id: 'server.kill', group: 'Server', label: 'Force-kill the server process', danger: true },
  { id: 'console.view', group: 'Console', label: 'Read the live console and logs' },
  { id: 'console.safe', group: 'Console', label: 'Run safe commands (list, tps, say, time, weather…)' },
  { id: 'console.run', group: 'Console', label: 'Run any console command', danger: true },
  { id: 'players.view', group: 'Players', label: 'See players, allowlist and bans' },
  { id: 'players.moderate', group: 'Players', label: 'Allowlist, kick, ban and unban players' },
  { id: 'players.control', group: 'Players', label: 'Change game mode, teleport, give items, message players' },
  { id: 'players.op', group: 'Players', label: 'Make and remove operators', danger: true },
  { id: 'players.broadcast', group: 'Players', label: 'Broadcast messages to everyone' },
  { id: 'plugins.view', group: 'Plugins', label: 'See installed plugins' },
  { id: 'plugins.manage', group: 'Plugins', label: 'Install, remove and toggle plugins (they run code on the server)', danger: true },
  { id: 'worlds.view', group: 'Worlds', label: 'See worlds and versions' },
  { id: 'worlds.manage', group: 'Worlds', label: 'Create, switch, download and remove worlds' },
  { id: 'world.control', group: 'Worlds', label: 'Change time, weather, difficulty and game rules' },
  { id: 'versions.manage', group: 'Worlds', label: 'Switch or update the Paper version', danger: true },
  { id: 'backups.view', group: 'Backups', label: 'See backups' },
  { id: 'backups.create', group: 'Backups', label: 'Create backups' },
  { id: 'backups.download', group: 'Backups', label: 'Download backups' },
  { id: 'backups.restore', group: 'Backups', label: 'Restore a backup', danger: true },
  { id: 'backups.delete', group: 'Backups', label: 'Delete backups' },
  { id: 'backups.schedule', group: 'Backups', label: 'Change the automatic backup schedule' },
  { id: 'settings.view', group: 'Configuration', label: 'See server settings' },
  { id: 'settings.edit', group: 'Configuration', label: 'Change server settings and memory' },
  { id: 'files.view', group: 'Configuration', label: 'Read config files' },
  { id: 'files.edit', group: 'Configuration', label: 'Edit config files', danger: true },
  { id: 'scripts.view', group: 'Automation', label: 'See scripts and schedules' },
  { id: 'scripts.run', group: 'Automation', label: 'Run scripts' },
  { id: 'scripts.manage', group: 'Automation', label: 'Create and edit scripts (scripts can run any command)', danger: true },
  { id: 'schedules.manage', group: 'Automation', label: 'Create and edit schedules (they run scripts regardless of who may run them)', danger: true },
  { id: 'permissions.view', group: 'In-game permissions', label: 'See in-game groups and permissions' },
  { id: 'permissions.manage', group: 'In-game permissions', label: 'Change in-game groups and permissions', danger: true },
  { id: 'alerts.manage', group: 'System', label: 'Manage notifications and alerts' },
  { id: 'audit.view', group: 'System', label: 'Read the activity log' },
  { id: 'users.manage', group: 'System', label: 'Manage dashboard users and roles', danger: true },
];
export const ALL_PERMS = PERMISSIONS.map((p) => p.id);

export const BUILTIN_ROLES = [
  { id: 'owner', name: 'Owner', description: 'Full control. Cannot be edited.', builtin: true, locked: true, permissions: ALL_PERMS },
  { id: 'admin', name: 'Admin', description: 'Everything except managing dashboard users.', builtin: true, permissions: ALL_PERMS.filter((p) => p !== 'users.manage') },
  {
    id: 'moderator', name: 'Moderator', description: 'Keeps the server friendly: players, chat, safe commands.', builtin: true,
    permissions: ['view', 'console.view', 'console.safe', 'players.view', 'players.moderate', 'players.control', 'players.broadcast', 'world.control', 'worlds.view', 'backups.view', 'scripts.view', 'scripts.run', 'permissions.view'],
  },
  { id: 'viewer', name: 'Viewer', description: 'Read-only access to the basics.', builtin: true, permissions: ['view', 'players.view', 'plugins.view', 'worlds.view', 'backups.view', 'scripts.view'] },
];

/** Commands a role with only "console.safe" may run. */
export const SAFE_COMMANDS = new Set(['list', 'tps', 'mspt', 'say', 'msg', 'tell', 'w', 'time', 'weather', 'difficulty', 'seed', 'whitelist', 'save-all', 'tellraw', 'title', 'me', 'playsound', 'kick', 'gamemode', 'tp', 'teleport', 'give', 'effect', 'experience', 'xp', 'spawnpoint', 'setworldspawn', 'worldborder', 'gamerule', 'spark', 'version', 'plugins', 'pl']);

const ANY = (...p) => ({ any: p });
// [method, path regex, permission | { any: [...] } | null (any signed-in user)]
export const ROUTES = [
  ['GET', /^\/api\/(me)$/, null],
  ['POST', /^\/api\/account\//, null],
  ['GET', /^\/api\/overview$/, 'view'],
  ['GET', /^\/api\/history$/, 'view'],
  ['GET', /^\/api\/(logs(\/stream)?|chat)$/, 'console.view'],
  ['POST', /^\/api\/console$/, ANY('console.run', 'console.safe')],
  ['POST', /^\/api\/server\/kill$/, 'server.kill'],
  ['POST', /^\/api\/server\/(start|stop|restart)$/, 'server.power'],
  ['GET', /^\/api\/audit$/, 'audit.view'],
  ['GET', /^\/api\/players$/, 'players.view'],
  ['POST', /^\/api\/players\/(op|deop)$/, 'players.op'],
  ['POST', /^\/api\/players\/(kick|ban|pardon|whitelist-add|whitelist-remove)$/, 'players.moderate'],
  ['POST', /^\/api\/whitelist\/enabled$/, 'players.moderate'],
  ['POST', /^\/api\/broadcast$/, 'players.broadcast'],
  ['POST', /^\/api\/player-control\//, 'players.control'],
  ['GET', /^\/api\/plugins/, 'plugins.view'],
  ['*', /^\/api\/plugins/, 'plugins.manage'],
  ['GET', /^\/api\/map$/, 'view'],
  ['*', /^\/api\/map\//, 'worlds.manage'],
  ['GET', /^\/api\/worlds$/, 'worlds.view'],
  ['*', /^\/api\/worlds/, 'worlds.manage'],
  ['GET', /^\/api\/world-control$/, 'worlds.view'],
  ['POST', /^\/api\/world-control\//, 'world.control'],
  ['GET', /^\/api\/versions$/, 'worlds.view'],
  ['*', /^\/api\/versions\//, 'versions.manage'],
  ['GET', /^\/api\/backups$/, 'backups.view'],
  ['POST', /^\/api\/backups$/, 'backups.create'],
  ['GET', /^\/api\/backups\/[^/]+\/download$/, 'backups.download'],
  ['POST', /^\/api\/backups\/[^/]+\/restore$/, 'backups.restore'],
  ['DELETE', /^\/api\/backups\//, 'backups.delete'],
  ['PUT', /^\/api\/backups\/schedule$/, 'backups.schedule'],
  ['GET', /^\/api\/settings$/, 'settings.view'],
  ['*', /^\/api\/settings/, 'settings.edit'],
  ['GET', /^\/api\/files/, 'files.view'],
  ['PUT', /^\/api\/files\//, 'files.edit'],
  ['GET', /^\/api\/(scripts|schedules|script-runs)/, 'scripts.view'],
  ['POST', /^\/api\/scripts\/[^/]+\/run$/, 'scripts.run'],
  ['POST', /^\/api\/script-runs\/[^/]+\/cancel$/, 'scripts.run'],
  ['*', /^\/api\/scripts/, 'scripts.manage'],
  ['*', /^\/api\/schedules/, 'schedules.manage'],
  ['GET', /^\/api\/lp\//, 'permissions.view'],
  ['*', /^\/api\/lp\//, 'permissions.manage'],
  ['*', /^\/api\/alerts/, 'alerts.manage'],
  ['GET', /^\/api\/role-names$/, ANY('scripts.manage', 'users.manage')],
  ['*', /^\/api\/(users|roles|access)/, 'users.manage'],
];

/** Returns the requirement for a request, or undefined when no rule matches (=> denied). */
export function requirement(method, url) {
  const path = url.split('?')[0];
  for (const [m, re, perm] of ROUTES) if ((m === '*' || m === method) && re.test(path)) return { perm };
  return undefined;
}
export function satisfies(perms, perm) {
  if (perm === null) return true;
  if (typeof perm === 'string') return perms.has(perm);
  return perm.any.some((p) => perms.has(p));
}
