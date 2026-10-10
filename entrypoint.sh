#!/usr/bin/env bash
# Starts Paper. The dashboard owns the day-to-day settings (version, memory, server.properties);
# environment variables only provide first-boot defaults. SIGTERM from Docker triggers a clean save-and-stop.
set -euo pipefail
cd /data
mkdir -p .dashboard paper plugins

RUNTIME=.dashboard/server.json
[ -s "$RUNTIME" ] || echo '{}' > "$RUNTIME"
rt() { jq -r --arg k "$1" '.[$k] // empty' "$RUNTIME" 2>/dev/null || true; }

VERSION="$(rt version)";      VERSION="${VERSION:-${MC_VERSION:-26.2}}"
INIT_MEM="$(rt initMemory)";  INIT_MEM="${INIT_MEM:-${INIT_MEMORY:-1G}}"
MAX_MEM="$(rt maxMemory)";    MAX_MEM="${MAX_MEM:-${MAX_MEMORY:-2G}}"
PRESET="$(rt jvmPreset)";     PRESET="${PRESET:-aikar}"
# Record what is running so the dashboard shows the truth from the first boot.
jq --arg v "$VERSION" --arg i "$INIT_MEM" --arg m "$MAX_MEM" --arg p "$PRESET" \
   '. + {version:$v, initMemory:$i, maxMemory:$m, jvmPreset:$p}' "$RUNTIME" > "$RUNTIME.tmp" && mv "$RUNTIME.tmp" "$RUNTIME"

echo "eula=${EULA:-true}" > eula.txt

props=server.properties
touch "$props"
set_prop() {
  local key=$1 value=$2 esc
  esc=$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')
  if grep -q "^${key}=" "$props"; then sed -i "s|^${key}=.*|${key}=${esc}|" "$props"; else printf '%s=%s\n' "$key" "$value" >> "$props"; fi
}

# Always enforced: the port, and the private RCON channel the dashboard uses (never published to the host).
set_prop server-port 25565
set_prop enable-rcon true
set_prop rcon.port 25575
set_prop broadcast-rcon-to-ops false
RCON_PW="$(grep '^rcon.password=' "$props" | cut -d= -f2- || true)"
if [ -z "$RCON_PW" ]; then set_prop rcon.password "$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"; fi

# First boot only: seed from environment, then leave the file to the dashboard.
if [ ! -f .dashboard/.seeded ]; then
  seed() { [ -n "${2:-}" ] && set_prop "$1" "$2" || true; }
  seed online-mode            "${ONLINE_MODE:-false}"
  seed enforce-secure-profile "${ENFORCE_SECURE_PROFILE:-false}"
  seed motd                   "${MOTD:-}"
  seed difficulty             "${DIFFICULTY:-}"
  seed gamemode               "${GAMEMODE:-}"
  seed max-players            "${MAX_PLAYERS:-}"
  seed view-distance          "${VIEW_DISTANCE:-}"
  seed simulation-distance    "${SIMULATION_DISTANCE:-}"
  seed pvp                    "${PVP:-}"
  seed spawn-protection       "${SPAWN_PROTECTION:-}"
  seed level-seed             "${SEED:-}"

  offline_uuid() {
    local h; h=$(printf 'OfflinePlayer:%s' "$1" | md5sum | cut -c1-32)
    local b6=$(( (0x${h:12:2} & 0x0f) | 0x30 )) b8=$(( (0x${h:16:2} & 0x3f) | 0x80 ))
    h="${h:0:12}$(printf '%02x' $b6)${h:14:2}$(printf '%02x' $b8)${h:18:14}"
    echo "${h:0:8}-${h:8:4}-${h:12:4}-${h:16:4}-${h:20:12}"
  }
  names_to_json() {
    local extra=$1 list=$2 out="" name
    IFS=',' read -ra names <<< "$list"
    for name in "${names[@]}"; do
      name=$(echo "$name" | xargs); [ -z "$name" ] && continue
      out+="${out:+,}{\"uuid\":\"$(offline_uuid "$name")\",\"name\":\"$name\"$extra}"
    done
    echo "[$out]"
  }
  if [ -n "${OPS:-}" ] && { [ ! -s ops.json ] || [ "$(cat ops.json)" = "[]" ]; }; then
    names_to_json ',"level":4,"bypassesPlayerLimit":false' "$OPS" > ops.json
  fi
  if [ -n "${WHITELIST:-}" ]; then
    names_to_json '' "${WHITELIST}${OPS:+,$OPS}" > whitelist.json
    set_prop white-list true; set_prop enforce-whitelist true
  fi
  touch .dashboard/.seeded
fi

# Find (or download and verify) the Paper jar for this version.
JAR="$(ls -1t paper/paper-"${VERSION}"-*.jar 2>/dev/null | head -n1 || true)"
if [ -z "$JAR" ]; then
  echo "Downloading Paper ${VERSION}..."
  meta=$(curl -fsSL "https://fill.papermc.io/v3/projects/paper/versions/${VERSION}/builds/latest") \
    || { echo "Paper ${VERSION} is not available from PaperMC" >&2; exit 1; }
  url=$(echo "$meta" | jq -r '.downloads["server:default"].url')
  sha=$(echo "$meta" | jq -r '.downloads["server:default"].checksums.sha256')
  name=$(echo "$meta" | jq -r '.downloads["server:default"].name')
  curl -fsSL -o "paper/${name}.part" "$url"
  echo "${sha}  paper/${name}.part" | sha256sum -c -
  mv "paper/${name}.part" "paper/${name}"
  JAR="paper/${name}"
  # Keep only the two newest jars.
  ls -1t paper/paper-*.jar | tail -n +3 | xargs -r rm -f
fi

AIKAR="-XX:+DisableExplicitGC -XX:+ParallelRefProcEnabled -XX:+PerfDisableSharedMem -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC \
-XX:G1HeapRegionSize=8M -XX:G1HeapWastePercent=5 -XX:G1MaxNewSizePercent=40 -XX:G1MixedGCCountTarget=4 -XX:G1MixedGCLiveThresholdPercent=90 \
-XX:G1NewSizePercent=30 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:G1ReservePercent=20 -XX:InitiatingHeapOccupancyPercent=15 \
-XX:MaxGCPauseMillis=200 -XX:MaxTenuringThreshold=1 -XX:SurvivorRatio=32 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true"
FLAGS="-XX:+UseG1GC"; [ "$PRESET" = "aikar" ] && FLAGS="$AIKAR"

echo "Starting Paper ${VERSION} (${JAR}) heap ${INIT_MEM}-${MAX_MEM}, flags=${PRESET}"
# shellcheck disable=SC2086
exec java -Xms"${INIT_MEM}" -Xmx"${MAX_MEM}" $FLAGS -jar "$JAR" --nogui
