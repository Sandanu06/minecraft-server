# Paper Minecraft server. The jar is fetched from PaperMC at start-up (checksum verified), so the
# version can be switched from the dashboard without rebuilding this image.
FROM eclipse-temurin:25-jre

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /data && chown -R ubuntu:ubuntu /data

USER ubuntu
WORKDIR /data
VOLUME /data
EXPOSE 25565

HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=5 \
  CMD bash -c '</dev/tcp/127.0.0.1/25565' || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
