# Multi-stage build for DeFAI on Cloud Run.
#
# Stage 1: Compile TypeScript backend.
# Stage 2: Build the React dashboard (Vite).
# Stage 3: Production image — Node 22-alpine + only the runtime deps.
#
# Cloud Run reads the PORT env var and routes traffic to 8080 by default.
# The Express server in src/api/server.ts picks up PORT from env (with a
# 3002 fallback for local dev).

# ─── Stage 1: Backend build ──────────────────────────────────────────────
FROM node:22-alpine AS builder
# better-sqlite3 still needs build tools because it ships native bindings.
# Even on the Cloud Run / Postgres path, the SQLite dep is in package.json
# so omit-dev won't drop it; the toolchain layer is required.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY tsconfig.json ./
COPY src/ ./src/
COPY abis/ ./abis/
RUN npx tsc

# ─── Stage 2: Dashboard build ────────────────────────────────────────────
FROM node:22-alpine AS dashboard-builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ─── Stage 3: Production runtime ─────────────────────────────────────────
FROM node:22-alpine
RUN apk add --no-cache python3 make g++ wget
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev && apk del python3 make g++
COPY --from=builder /app/dist ./dist
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist
COPY abis/ ./abis/
COPY loadEnv.js ./

# Cloud Run injects PORT; default 8080 keeps local `docker run` ergonomic.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Health check used both by Docker (local) and Cloud Run readiness probes.
# wget is in the base image (added above) precisely for this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://localhost:${PORT}/api/health || exit 1

CMD ["node", "dist/index.js"]
