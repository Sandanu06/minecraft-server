# SandMan Minecraft Server

Vanilla Minecraft **26.2** server in **offline mode** (TLauncher / non-premium accounts can join), deployed on Coolify with CI/CD from GitHub Actions.

- `Dockerfile` downloads the official server jar directly from Mojang and verifies its SHA-1 — no third-party Minecraft image.
- `entrypoint.sh` writes `server.properties`, `ops.json` and `whitelist.json` from environment variables (offline UUIDs are computed automatically).
- `docker-compose.yml` is what Coolify deploys. World data lives in the `minecraft-data` volume and survives redeploys.
- `.github/workflows/deploy.yml` builds and smoke-tests the image on every push to `main`, then triggers a Coolify redeploy.

## Connect

Server address: `minecraft.teczos.com` (port 25565). Pick **Release 26.2** in TLauncher.

## Configuration (Coolify → Environment Variables)

| Variable | Default | Notes |
|---|---|---|
| `MC_VERSION` | `26.2` | Changing it rebuilds the image. Minecraft can't load a world in an older version than it was saved with. |
| `ONLINE_MODE` | `false` | `false` = cracked/TLauncher accounts allowed. |
| `OPS` | `IGhost_RiderI` | Comma-separated admin names. |
| `WHITELIST` | *(empty)* | Comma-separated friend names. When set, only these players (plus `OPS`) can join. |
| `MAX_MEMORY` / `INIT_MEMORY` | `2G` / `512M` | Java heap. |
| `MOTD`, `DIFFICULTY`, `GAMEMODE`, `MAX_PLAYERS`, `VIEW_DISTANCE`, `PVP`, `SEED`, … | | See `docker-compose.yml`. |

> **Security note:** in offline mode the server can't verify who a player is. Anyone who knows the address can join with any name, including an op's name. Setting `WHITELIST` keeps random people out, but it can't stop someone who guesses a whitelisted name. Share the address only with friends.

## CI/CD secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `COOLIFY_URL` | `https://coolify.teczos.com` |
| `COOLIFY_TOKEN` | Coolify → Keys & Tokens → API tokens (needs `deploy` permission) |
| `COOLIFY_RESOURCE_UUID` | UUID of this resource in Coolify (from its URL) |
