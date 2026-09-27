#!/usr/bin/env bash
# Writes eula/server.properties/ops/whitelist from environment variables, then
# execs the server so SIGTERM from Docker triggers a clean save-and-stop.
set -euo pipefail

cd /data

echo "eula=${EULA:-true}" > eula.txt

props=server.properties
touch "$props"

set_prop() {
  local key=$1 value=$2
  if grep -q "^${key}=" "$props"; then
    # Escape sed replacement specials in the value.
    local esc
    esc=$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')
    sed -i "s|^${key}=.*|${key}=${esc}|" "$props"
  else
    printf '%s=%s\n' "$key" "$value" >> "$props"
  fi
}

set_prop server-port            25565
set_prop online-mode            "${ONLINE_MODE:-false}"
set_prop enforce-secure-profile "${ENFORCE_SECURE_PROFILE:-false}"
set_prop motd                   "${MOTD:-A Minecraft Server}"
set_prop difficulty             "${DIFFICULTY:-normal}"
set_prop gamemode               "${GAMEMODE:-survival}"
set_prop max-players            "${MAX_PLAYERS:-10}"
set_prop view-distance          "${VIEW_DISTANCE:-10}"
set_prop simulation-distance    "${SIMULATION_DISTANCE:-10}"
set_prop pvp                    "${PVP:-true}"
set_prop hardcore               "${HARDCORE:-false}"
set_prop allow-nether           "${ALLOW_NETHER:-true}"
set_prop enable-command-block   "${ENABLE_COMMAND_BLOCK:-false}"
set_prop spawn-protection       "${SPAWN_PROTECTION:-0}"
[ -n "${SEED:-}" ] && set_prop level-seed "$SEED"

# Offline-mode UUID, identical to Java's UUID.nameUUIDFromBytes("OfflinePlayer:<name>").
offline_uuid() {
  local h
  h=$(printf 'OfflinePlayer:%s' "$1" | md5sum | cut -c1-32)
  local b6=$(( (0x${h:12:2} & 0x0f) | 0x30 ))
  local b8=$(( (0x${h:16:2} & 0x3f) | 0x80 ))
  h="${h:0:12}$(printf '%02x' $b6)${h:14:2}$(printf '%02x' $b8)${h:18:14}"
  echo "${h:0:8}-${h:8:4}-${h:12:4}-${h:16:4}-${h:20:12}"
}

# Comma-separated names -> JSON list. Only managed when the variable is set,
# so /op and /whitelist changes made in-game persist otherwise.
names_to_json() {
  local extra=$1 list=$2 out="" name
  IFS=',' read -ra names <<< "$list"
  for name in "${names[@]}"; do
    name=$(echo "$name" | xargs)
    [ -z "$name" ] && continue
    out+="${out:+,}{\"uuid\":\"$(offline_uuid "$name")\",\"name\":\"$name\"$extra}"
  done
  echo "[$out]"
}

if [ "${ONLINE_MODE:-false}" = "false" ]; then
  if [ -n "${OPS:-}" ]; then
    names_to_json ',"level":4,"bypassesPlayerLimit":false' "$OPS" > ops.json
  fi
  if [ -n "${WHITELIST:-}" ]; then
    # Ops are always allowed in too.
    names_to_json '' "${WHITELIST}${OPS:+,$OPS}" > whitelist.json
    set_prop white-list true
    set_prop enforce-whitelist true
  else
    set_prop white-list false
    set_prop enforce-whitelist false
  fi
else
  echo "ONLINE_MODE=true: OPS/WHITELIST env ignored, manage with /op and /whitelist in-game."
fi

echo "Starting Minecraft ${MC_VERSION} (online-mode=${ONLINE_MODE:-false})"
exec java -Xms"${INIT_MEMORY:-512M}" -Xmx"${MAX_MEMORY:-2G}" -XX:+UseG1GC \
  -jar /opt/minecraft/server.jar --nogui
