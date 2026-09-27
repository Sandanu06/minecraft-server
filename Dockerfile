# Vanilla Minecraft server built straight from Mojang's official download.
# No third-party Minecraft images — only a plain Java runtime base.
FROM eclipse-temurin:25-jre

ARG MC_VERSION=26.2

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Resolve the version in Mojang's manifest, download server.jar, verify its SHA-1.
RUN set -eu; \
    manifest=$(curl -fsSL https://piston-meta.mojang.com/mc/game/version_manifest_v2.json); \
    url=$(echo "$manifest" | jq -r --arg v "$MC_VERSION" '.versions[] | select(.id == $v) | .url'); \
    [ -n "$url" ] || { echo "Minecraft version $MC_VERSION not found" >&2; exit 1; }; \
    meta=$(curl -fsSL "$url"); \
    jar_url=$(echo "$meta" | jq -r '.downloads.server.url'); \
    jar_sha=$(echo "$meta" | jq -r '.downloads.server.sha1'); \
    mkdir -p /opt/minecraft; \
    curl -fsSL -o /opt/minecraft/server.jar "$jar_url"; \
    echo "$jar_sha  /opt/minecraft/server.jar" | sha1sum -c -

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /data && chown -R ubuntu:ubuntu /data

ENV MC_VERSION=${MC_VERSION}
USER ubuntu
WORKDIR /data
VOLUME /data
EXPOSE 25565

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=5 \
  CMD bash -c '</dev/tcp/127.0.0.1/25565' || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
