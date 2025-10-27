# Pull down image from Orbis GHCR and do a fly local only deploy
FROM ghcr.io/orbisoperations/catalyst-adapter-base:0.1.0 AS base

LABEL fly_launch_runtime="Bun"

# Set working directory
WORKDIR /app

ENV NODE_ENV=production

FROM base AS build

COPY bun.lock bun.lock
COPY package.json package.json
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src/ src/
COPY tsconfig.json tsconfig.json

# Bun automatically transpiles TS, but you might need to build if using decorators or complex features
# If needed: RUN bun run build

# Application runs on port 3000 by default in many frameworks, but this app doesn't expose one.
# EXPOSE 3000 # Remove or keep commented if the app doesn't listen on a port

# Production stage
FROM base

# Create directory for persistent sqlite DB (Fly volume mounts here)
RUN mkdir -p /data && chown -R 1000:1000 /data

# Copy built application
COPY --from=build /app /app


EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]