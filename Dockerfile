FROM node:20-alpine AS builder

# git is required by some transitive deps during npm install
RUN apk add --no-cache git python3 make g++

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
FROM node:20-alpine

RUN apk add --no-cache git su-exec

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /output ./public

# Create non-root user and own the app directory
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
RUN chown -R appuser:appgroup /app

# Entrypoint fixes data dir ownership at startup (needed for bind mounts), then drops to appuser
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3100

ENTRYPOINT ["/app/entrypoint.sh"]
