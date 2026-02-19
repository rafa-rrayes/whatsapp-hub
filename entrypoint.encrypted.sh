#!/bin/sh
set -e

# Ensure data directories exist and are writable by appuser
mkdir -p /app/data/media /app/data/auth
chown -R appuser:appgroup /app/data

exec gosu appuser node dist/index.js
