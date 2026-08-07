FROM node:20-bookworm-slim AS transcription

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-transcription.txt /tmp/requirements-transcription.txt
RUN python3 -m venv /opt/crisperwhisper \
    && /opt/crisperwhisper/bin/pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu "torch>=2.4" \
    && /opt/crisperwhisper/bin/pip install --no-cache-dir \
      -r /tmp/requirements-transcription.txt \
    && /opt/crisperwhisper/bin/python -c \
      "from crisperwhisper.hallucination import find_token_loop; assert find_token_loop([1] * 8) is not None"

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
    && apt-get install -y --no-install-recommends git gosu python3 ffmpeg libsndfile1 ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=transcription /opt/crisperwhisper /opt/crisperwhisper
ENV CRISPERWHISPER_PYTHON=/opt/crisperwhisper/bin/python

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /output ./public
COPY scripts/crisperwhisper_worker.py ./scripts/crisperwhisper_worker.py

# Create non-root user and own the app directory
RUN groupadd --gid 1001 appgroup \
    && useradd --uid 1001 --gid appgroup --shell /usr/sbin/nologin appuser
RUN chown -R appuser:appgroup /app

# Entrypoint fixes data dir ownership at startup (needed for bind mounts), then drops to appuser
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3100

ENTRYPOINT ["/app/entrypoint.sh"]
