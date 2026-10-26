FROM node:20-bookworm-slim AS builder

# git is required by some transitive deps during npm install
RUN apt-get update \
    && apt-get install -y --no-install-recommends git python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Limit Node heap to avoid swapping on low-memory machines
ENV NODE_OPTIONS="--max-old-space-size=384"

WORKDIR /app

# Install dependencies first (cache layer)
COPY package*.json ./
RUN npm install

# Copy source & build backend
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Build frontend (same stage to avoid parallel builds competing for RAM)
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build --outDir /output

# --- Production stage ---
FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git gosu ffmpeg ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /output ./public

# Create non-root user and own the app directory
RUN groupadd --gid 1001 appgroup \
    && useradd --uid 1001 --gid appgroup --shell /usr/sbin/nologin appuser
RUN chown -R appuser:appgroup /app

# Entrypoint fixes data dir ownership at startup (needed for bind mounts), then drops to appuser
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3100

ENTRYPOINT ["/app/entrypoint.sh"]
