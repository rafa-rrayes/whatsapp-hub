import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { checkMcpConnection } from '../src/lib/mcp-connect.js';

vi.mock('../../src/config.js', () => ({ config: {
  apiKey: 'transport-test-key', publicBaseUrl: 'https://hub.example.test',
  security: { stripRawMessages: false }, logLevel: 'silent',
} }));
vi.mock('../../src/connection/manager.js', () => ({ connectionManager: {} }));
vi.mock('../../src/mcp/oauth/provider.js', () => ({ provider: { verifyAccessToken: vi.fn() } }));
const getDb = vi.fn(() => { throw new Error('Connection checks must not access message data'); });
vi.mock('../../src/database/index.js', () => ({ getDb: () => getDb() }));

const { registerMcp } = await import('../../src/mcp/index.js');
let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
});

async function serve() {
  const app = express();
  registerMcp(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const origin = `http://127.0.0.1:${address.port}`;
  const realFetch = globalThis.fetch;
  const requests: string[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string).method);
    return realFetch(new URL(url, origin), init);
  });
  return requests;
}

describe('dashboard check against real MCP HTTP transport', () => {
  it('authenticates and negotiates initialize/tools-list through SSE without reading conversations', async () => {
    const requests = await serve();
    const result = await checkMcpConnection('transport-test-key');
    expect(result.serverName).toBe('whatsapp-hub');
    expect(result.toolCount).toBeGreaterThan(10);
    expect(result.protocolVersion).toBeTruthy();
    expect(requests).toEqual(['initialize', 'tools/list']);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('rejects an incorrect key before discovery', async () => {
    const requests = await serve();
    await expect(checkMcpConnection('incorrect-test-key')).rejects.toThrow('Authentication failed');
    expect(requests).toEqual(['initialize']);
    expect(getDb).not.toHaveBeenCalled();
  });
});
