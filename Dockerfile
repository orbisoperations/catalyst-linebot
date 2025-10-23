# syntax=docker/dockerfile:1
ARG BUN_VERSION=1.2.22

FROM gcr.io/datadoghq/agent:7 AS datadogagent

# Adjust BUN_VERSION as desired
FROM oven/bun:${BUN_VERSION}-slim AS base

LABEL fly_launch_runtime="Bun"

# Set working directory
WORKDIR /app

ENV NODE_ENV=production

# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ca-certificates

# Install dependencies based on lockfile
COPY bun.lock bun.lock
COPY package.json package.json
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src/ src/
COPY tsconfig.json tsconfig.json
COPY entrypoint.sh .

# Bun automatically transpiles TS, but you might need to build if using decorators or complex features
# If needed: RUN bun run build

# Application runs on port 3000 by default in many frameworks, but this app doesn't expose one.
# EXPOSE 3000 # Remove or keep commented if the app doesn't listen on a port

# Production stage
FROM base

# CA certs fix for TLS (prevents x509 unknown authority)
RUN apt-get update && apt-get install -y --no-install-recommends tini curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Create directory for persistent sqlite DB (Fly volume mounts here)
RUN mkdir -p /data && chown -R 1000:1000 /data

# Copy Datadog Agent into this image and the /etc config skeleton
COPY --from=datadogagent /opt/datadog-agent /opt/datadog-agent
COPY --from=datadogagent /etc/datadog-agent /etc/datadog-agent

# Copy Datadog config files
COPY datadog/system-probe.yaml /etc/datadog-agent/system-probe.yaml
COPY datadog/datadog.yaml /etc/datadog-agent/datadog.yaml
COPY datadog/security-agent.yaml /etc/datadog-agent/security-agent.yaml

# Copy built application
COPY --from=build /app /app
COPY --from=build /app/entrypoint.sh /entrypoint.sh

# Post Quantum

# Use the static binary to avoid apt repo + autoupdate daemons
RUN curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" \
      -o /usr/local/bin/cloudflared \
 && chmod +x /usr/local/bin/cloudflared

# Make entrypoint script executable
RUN chmod +x /entrypoint.sh

EXPOSE 8080

# Use tini to reap child processes
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["/entrypoint.sh"]