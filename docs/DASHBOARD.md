# Dashboard guide

`https://admin.minecraft.teczos.com` · built from `dashboard/` · deployed as its own Coolify app, so redeploying it never restarts the game.

## Sign in and security

- Sign in with your own account. The first **Owner** comes from `ADMIN_USER` / `ADMIN_PASSWORD_HASH`.
- Turn on **two-step sign-in** under *Account* (any authenticator app). Strongly recommended: this dashboard can control Docker on the host.
- Six failed sign-ins from one address (or ten for one account) lock out sign-in for 15 minutes.
- Every action is written to *Activity*. Security events (failed sign-ins) can go to Discord (*Alerts*).

## Roles and permissions

*Access → Roles and permissions.* Every API call is checked on the server against the person's role; hiding a button is only a convenience.

| Role | Intended for | Can |
|---|---|---|
| Owner | You | Everything, including managing people. Cannot be edited. |
| Admin | Trusted co-admins | Everything except managing dashboard users. |
| Moderator | Chat moderators | Players (kick/ban/allowlist/controls), safe console commands, game controls, run scripts, read-only elsewhere. |
| Viewer | Read-only | Overview, players, plugins, worlds, backups, scripts. |

Create your own roles (for example *Event host*) and toggle individual permissions. Powerful permissions are labelled. Rules that keep this safe:

- You can only grant permissions you hold yourself.
- You cannot change your own role, delete yourself, or remove the last Owner.
- Scripts can run any command, so *manage scripts* is as powerful as the console.
- A role with only **safe commands** may run a short allowlist (`list`, `tps`, `say`, `time`, `weather`, `whitelist`, `tp`, `gamemode`, `give`…), never `op`, `stop` or arbitrary commands.

## Scripts and schedules

*Scripts*: one step per line.

```
# comment
say Hello                  any console command (leading / optional)
wait 30s | wait 5m         pause (up to 1 hour per wait)
@broadcast Text            say to everyone
@backup label              back up the world
@restart | @stop | @start  server power (saves the world first)
@save                      save-all flush
@abort-if-players          stop the script when anyone is online
```

Each script can be limited to certain roles; owners can always run everything. *Schedules* run a script, a backup or a restart daily, on chosen weekdays, or every N minutes, in a time zone you choose. The seeded *Nightly restart* is off until you turn it on.

## In-game permissions (LuckPerms)

*Permissions → Install LuckPerms* installs the plugin with JSON storage. The page then manages groups, weights, chat prefixes, inheritance, per-group and per-player permissions, with no restart. Players are addressed by their (offline) UUID, so it works for TLauncher players.

## Backups

- Daily automatic backup (default 04:00 UTC, keep 7), plus *Back up now*. Running servers are flushed with `save-off` / `save-all flush` first.
- *Restore* takes a safety backup of the current world, stops the server, sets current files aside, restores, then starts the server.
- Version switches, Paper updates and restores always back up first.
- Backups live in `/srv/minecraft-backups` on the host. Copy them off the machine as well.

## Plugins, worlds, versions

- *Plugins*: one-click install from Modrinth (only builds for your Minecraft version), update checks, enable/disable, upload a `.jar`.
- *Worlds*: switch/create/download worlds; removed worlds go to a hidden `.trash` folder. *Game controls*: time, weather, difficulty, world border, game rules, save now.
- *Versions*: switch Paper versions (never to a version older than the world) and update to the newest build.

## Live map (BlueMap)

`https://map.minecraft.teczos.com` is a public 3D map of the world, served by the BlueMap plugin inside the game container and routed through Coolify (the domain is set on the game app as `https://map.minecraft.teczos.com:8100`). The *Live map* page shows render progress and has update / pause / resume buttons. The first full render takes about an hour for the current world and uses extra CPU; pause it if the server lags. Anyone with the address can see the map and where players are.

## Offline mode (TLauncher)

`online-mode=false` stays on so TLauncher players can join. Anyone can then join under any name, so turn the allowlist on and consider the AuthMe plugin.
