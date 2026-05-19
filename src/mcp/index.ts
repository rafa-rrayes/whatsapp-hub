import express, { type Express, type RequestHandler } from 'express';
import crypto from 'node:crypto';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { config } from '../config.js';
import { provider } from './oauth/provider.js';
import { createMcpRouter } from './transport.js';

/**
 * Combined auth for /mcp:
 * - If `x-api-key` is present: must be the configured key (timing-safe). Wrong → 401, no fallthrough.
 * - Else: validates `Authorization: Bearer ...` as an OAuth 2.1 access token via our provider.
 *
 * 401s from the bearer path include the spec-mandated `WWW-Authenticate` header
 * pointing at /.well-known/oauth-protected-resource/mcp so claude.ai can discover.
 */
function buildAuth(): RequestHandler {
  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: `${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp`,
  });

  const expectedKey = Buffer.from(config.apiKey);

  return (req, res, next) => {
    const apiKey = req.header('x-api-key');
    if (apiKey !== undefined) {
      const presented = Buffer.from(apiKey);
      const ok =
        presented.length === expectedKey.length &&
        crypto.timingSafeEqual(presented, expectedKey);
      if (ok) return next();
      res.status(401).json({
        error: 'invalid_api_key',
        hint: 'CLI clients use `x-api-key: <key>`. For claude.ai-style connectors, omit x-api-key and use OAuth (Authorization: Bearer <oauth_token>).',
      });
      return;
    }
    return bearer(req, res, next);
  };
}

/**
 * Mounts the MCP Streamable HTTP endpoint at `/mcp`.
 *
 * Body parser runs BEFORE auth so the auth middleware (and downstream MCP
 * handler) both see parsed JSON. 4 MB limit accommodates large tool args.
 */
export function registerMcp(app: Express): void {
  app.use(
    '/mcp',
    express.json({ limit: '4mb' }),
    buildAuth(),
    createMcpRouter(),
  );
}
