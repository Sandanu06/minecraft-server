# Teczos Minecraft

A **Paper** Minecraft server with its own admin dashboard, deployed on Coolify.

| | |
|---|---|
| Play | `minecraft.teczos.com` (port 25565). TLauncher and paid accounts both work (offline mode). |
| Admin | `https://admin.minecraft.teczos.com` (sign in required) |

## What is in this repo

| Path | What it is |
|---|---|
| `Dockerfile`, `entrypoint.sh`, `docker-compose.yml` | The game server. Fetches the Paper jar for the chosen version from PaperMC (checksum verified). |
| `dashboard/` | The admin dashboard: React UI + a small Node API. Deployed as a second Coolify app from `dashboard/docker-compose.yml`. |
| `.github/workflows/ci.yml` | Checks both images build, smoke-tests Paper, and deploys the app(s) that changed. |

## The dashboard

Power switch (start, stop, restart), live console and logs, monitoring (TPS, tick time, CPU, memory, players), player management (allowlist, operators, kick, ban), plugin browser with one-click Modrinth install, worlds, Paper version switching, backups with one-click restore, a settings editor, a config-file editor and an activity log.

Safety built in:
- Every version switch and restore takes a backup first.
- Backups flush the world (`save-off`, `save-all flush`) before copying.
- Versions older than the world are refused, so a world can never be downgraded.
- Worlds are moved to `.trash`, never deleted.
- Sign-in is rate limited and every action is written to the activity log.

### How it works

The game server and the dashboard are separate Coolify apps, so redeploying the dashboard never restarts the game. The dashboard:
- talks to the game over **RCON** on the private Docker network (the RCON port is not published),
- starts/stops the container through the Docker socket,
- reads and writes the game's data volume directly (plugins, config, backups).

Day-to-day settings (version, memory, `server.properties`) are owned by the dashboard and stored on the data volume. The environment variables in `docker-compose.yml` only seed the first boot.

### Run the dashboard

Create a Coolify app: *Public repository* `Sandanu06/minecraft-server`, build pack **Docker Compose**, base directory `/dashboard`, domain `admin.minecraft.teczos.com`. Environment:

| Variable | Notes |
|---|---|
| `ADMIN_USER` | Sign-in name. |
| `ADMIN_PASSWORD_HASH` | Generate with `docker run --rm <dashboard image> node index.js --hash '<password>'`. Changing the password from the dashboard overrides this. |
| `MC_PROJECT` | Coolify UUID of the Minecraft app (its compose project name). |
| `DOCKER_GID` | Group id of `/var/run/docker.sock` on the host (`stat -c %g /var/run/docker.sock`). |

Host prerequisites: `/srv/minecraft-backups` owned by uid 1000.

> The dashboard can control Docker on the host. Keep the admin password strong and do not expose it without sign-in.

## Game server settings

On the very first boot these seed the world (`docker-compose.yml`); afterwards use the dashboard.

| Variable | Default | Notes |
|---|---|---|
| `MC_VERSION` | `26.2` | Paper version. Switch later from the dashboard. |
| `ONLINE_MODE` | `false` | Keep `false` so TLauncher players can join. |
| `OPS` | `IGhost_RiderI` | Seeds `ops.json` only when it is empty. |
| `INIT_MEMORY` / `MAX_MEMORY` | `1G` / `2G` | Java heap. |

> **Offline mode:** the server cannot verify who a player is, so anyone can join under any name. Turn the allowlist on in the dashboard and install an auth plugin such as AuthMe.

## CI/CD secrets

GitHub → Settings → Secrets and variables → Actions: `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_MINECRAFT_UUID`, `COOLIFY_DASHBOARD_UUID`.
Only changes to `Dockerfile`, `entrypoint.sh` or `docker-compose.yml` redeploy (restart) the game; changes under `dashboard/` redeploy only the dashboard.
