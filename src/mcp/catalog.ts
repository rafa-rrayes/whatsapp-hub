import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildMcpServer } from './server.js';

let catalog: Promise<Tool[]> | undefined;

/** Read the same public tools/list response that agents receive, without running tools. */
export function getMcpToolCatalog(): Promise<Tool[]> {
  catalog ??= readCatalog().catch((error: unknown) => {
    catalog = undefined; // A transient failure must not poison subsequent setup requests.
    throw error;
  });
  return catalog;
}

async function readCatalog(): Promise<Tool[]> {
  const server = buildMcpServer();
  const client = new Client({ name: 'whatsapp-hub-setup', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}
