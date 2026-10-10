import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  // Where the Minecraft container's /data volume is mounted in this container.
  mcData: env.MC_DATA || '/mc-data',
  backupDir: env.BACKUP_DIR || '/backups',
  stateDir: env.STATE_DIR || '/state',
  publicDir: env.PUBLIC_DIR || path.resolve('public'),
  dockerSocket: env.DOCKER_SOCKET || '/var/run/docker.sock',
  // Coolify resource uuid of the Minecraft app (docker compose project name).
  mcProject: env.MC_PROJECT || 'fb06ymf6y88v42zcevgm7m9m',
  mcService: env.MC_SERVICE || 'minecraft',
  stopGraceSeconds: Number(env.STOP_GRACE_SECONDS || 60),
  mapUrl: env.MAP_URL || 'https://map.minecraft.teczos.com',
  adminUser: env.ADMIN_USER || 'admin',
  adminPasswordHash: env.ADMIN_PASSWORD_HASH || '',
  sessionSecret: env.SESSION_SECRET || '',
  secureCookies: env.INSECURE_COOKIES !== '1',
  modrinthUA: 'teczos-minecraft-dashboard/1.0 (github.com/Sandanu06/minecraft-server)',
};

export const paths = {
  props: () => path.join(config.mcData, 'server.properties'),
  runtime: () => path.join(config.mcData, '.dashboard', 'server.json'),
  plugins: () => path.join(config.mcData, 'plugins'),
  state: (f) => path.join(config.stateDir, f),
};
