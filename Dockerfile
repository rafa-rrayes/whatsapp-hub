FROM node:20-alpine AS builder

# git is required by some transitive deps during npm install
RUN apk add --no-cache git python3 make g++

WORKDIR /app

# Install dependencies first (cache layer)
COPY package*.json ./
RUN npm install

# Copy source & build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- Frontend build stage ---
FROM node:20-alpine AS frontend

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build --outDir /output

# --- Production stage ---
FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=frontend /output ./public

# Create data directories
RUN mkdir -p /app/data/media /app/data/auth

# Run as non-root user
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3100

CMD ["node", "dist/index.js"]
