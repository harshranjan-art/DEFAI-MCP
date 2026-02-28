# Stage 1: Build backend
FROM node:18-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY tsconfig.json ./
COPY src/ ./src/
COPY abis/ ./abis/
RUN npx tsc

# Stage 2: Build dashboard
FROM node:18-alpine AS dashboard-builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# Stage 3: Production
FROM node:18-alpine
RUN apk add --no-cache python3 make g++ wget
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev && apk del python3 make g++
COPY --from=builder /app/dist ./dist
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist
COPY abis/ ./abis/
COPY loadEnv.js ./
RUN mkdir -p data

EXPOSE 3002
EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
