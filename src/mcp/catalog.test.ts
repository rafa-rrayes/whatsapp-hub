import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('../config.js', () => ({ config: { security: { stripRawMessages: false }, logLevel: 'silent' } }));
vi.mock('../connection/manager.js', () => ({ connectionManager: {} }));
const getDb = vi.fn(() => { throw new Error('Catalog listing must not read WhatsApp data'); });
vi.mock('../database/index.js', () => ({ getDb: () => getDb() }));

const { getMcpToolCatalog } = await import('./catalog.js');
const { buildMcpServer } = await import('./server.js');

describe('MCP tool catalog', () => {
  it('matches an agent tools/list response without executing any tool or reading private data', async () => {
    const catalog = await getMcpToolCatalog();
    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    const server = buildMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect(catalog).toEqual((await client.listTools()).tools);
      expect(catalog.length).toBeGreaterThan(10);
      expect(catalog.find((tool) => tool.name === 'send_message')?.annotations?.readOnlyHint).toBe(false);
      expect(catalog.find((tool) => tool.name === 'whatsapp_inbox')?.annotations?.readOnlyHint).toBe(true);
      expect(catalog.every((tool) => tool.inputSchema.type === 'object')).toBe(true);
      expect(getDb).not.toHaveBeenCalled();
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});
