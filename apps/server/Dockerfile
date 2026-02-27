# ── Build Stage ─────────────────────────────────────────────────────────
FROM node:20-bookworm AS builder

# mediasoup requires native compilation tools
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/server/package.json apps/server/

# Install all workspace deps
RUN npm ci --workspace=@reson8/server --workspace=@reson8/shared-types

# Copy source
COPY packages/shared-types/ packages/shared-types/
COPY apps/server/ apps/server/

# Build shared types
RUN cd packages/shared-types && npx tsc --build

# Generate Prisma client
RUN cd apps/server && npx prisma generate

# Build server
RUN cd apps/server && npx tsc

# ── Runtime Stage ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built output and node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types ./packages/shared-types
COPY --from=builder /app/apps/server ./apps/server

# Copy entrypoint
COPY apps/server/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

WORKDIR /app/apps/server

# Expose Fastify + WebRTC ports
EXPOSE 9800
EXPOSE 10000-10100/udp
EXPOSE 10000-10100/tcp

ENTRYPOINT ["/app/entrypoint.sh"]
