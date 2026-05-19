import express, { type Express } from 'express';
import { authMiddleware } from '../api/middleware/auth.js';
import { createMcpRouter } from './transport.js';

/**
 * Mounts the MCP Streamable HTTP endpoint at `/mcp`.
 *
 * Auth: same `x-api-key` / `Authorization: Bearer` model as the REST API.
 * Body limit: 4 MB — larger than `/api` default since MCP tool calls can
 * carry larger structured arguments.
 */
export function registerMcp(app: Express): void {
  app.use(
    '/mcp',
    express.json({ limit: '4mb' }),
    authMiddleware,
    createMcpRouter(),
  );
}
