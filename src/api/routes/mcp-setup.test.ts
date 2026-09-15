import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const { settings, getCatalog } = vi.hoisted(() => ({
  settings: {
    apiKey: 'test-api-key-for-setup-endpoint',
    publicBaseUrl: 'https://whatsapp.example.com',
    publicBaseUrlConfigured: true,
    mcpOauthPassword: 'separate-oauth-consent-password',
    security: { disableHttpQueryAuth: true },
  },
  getCatalog: vi.fn(),
}));
vi.mock('../../config.js', () => ({ config: settings }));
vi.mock('../../mcp/catalog.js', () => ({ getMcpToolCatalog: getCatalog }));

import { describeMcpSetup, createMcpSetupRouter } from './mcp-setup.js';
import { authMiddleware } from '../middleware/auth.js';

describe('MCP setup metadata', () => {
  it('prefers the configured public endpoint over an internal proxy request address', () => {
    const result = describeMcpSetup(settings, 'http://127.0.0.1:3100', true);
    expect(result.mcpUrl).toBe('https://whatsapp.example.com/mcp');
    expect(result.urlSource).toBe('configured');
    expect(result.auth.oauth).toEqual({
      enabled: true,
      issuerUrl: 'https://whatsapp.example.com',
      discoveryUrl: 'https://whatsapp.example.com/.well-known/oauth-protected-resource/mcp',
      reason: null,
    });
  });

  it('does not advertise a default localhost URL to a remote dashboard', () => {
    const result = describeMcpSetup({ ...settings, publicBaseUrlConfigured: false, publicBaseUrl: 'http://localhost:3100' }, 'https://whatsapp.example.com', true);
    expect(result.mcpUrl).toBe('https://whatsapp.example.com/mcp');
    expect(result.urlSource).toBe('request');
    expect(result.warnings).toHaveLength(1);
    expect(result.auth.oauth.enabled).toBe(false);
    expect(result.auth.oauth.reason).toContain('PUBLIC_BASE_URL');
  });

  it.each(['not a url', 'ftp://whatsapp.example.com', 'https://user:secret@example.com', 'https://example.com?key=secret', 'https://example.com#secret'])('rejects invalid or credential-bearing configured URL %s', (publicBaseUrl) => {
    const result = describeMcpSetup({ ...settings, publicBaseUrl }, 'https://dashboard.example.com', true);
    expect(result.mcpUrl).toBe('https://dashboard.example.com/mcp');
    expect(result.auth.oauth.enabled).toBe(false);
    expect(result.auth.oauth.issuerUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('reports a missing OAuth consent password separately from router availability', () => {
    expect(describeMcpSetup({ ...settings, mcpOauthPassword: '' }, 'http://localhost:3100', true).auth.oauth.reason).toContain('MCP_OAUTH_PASSWORD');
    const disabled = describeMcpSetup(settings, 'http://localhost:3100', false).auth.oauth;
    expect(disabled.enabled).toBe(false);
    expect(disabled.discoveryUrl).toBeNull();
  });

  it('warns honestly for a local-only HTTP endpoint', () => {
    const result = describeMcpSetup({ ...settings, publicBaseUrl: 'http://localhost:3100' }, 'https://elsewhere.example.com', true);
    expect(result.warnings.join(' ')).toContain('HTTP');
    expect(result.warnings.join(' ')).toContain('same computer');
  });
});

describe('MCP setup route', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    getCatalog.mockReset().mockResolvedValue([{ name: 'actual_registered_tool', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]);
    const app = express();
    app.use('/api/mcp', authMiddleware, createMcpSetupRouter(true));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server failed to listen');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('requires authentication before retrieving the catalog', async () => {
    const response = await fetch(`${baseUrl}/api/mcp/setup`);
    expect(response.status).toBe(401);
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it('returns actual catalog metadata and no credentials with no-store caching', async () => {
    const response = await fetch(`${baseUrl}/api/mcp/setup`, { headers: { 'x-api-key': settings.apiKey, Origin: 'https://untrusted.example.com' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json() as { mcpUrl: string; tools: Array<{ name: string }> };
    expect(body.mcpUrl).toBe('https://whatsapp.example.com/mcp');
    expect(body.tools[0].name).toBe('actual_registered_tool');
    expect(JSON.stringify(body)).not.toContain(settings.apiKey);
    expect(JSON.stringify(body)).not.toContain(settings.mcpOauthPassword);
  });
});
