import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools/index.js';

const SERVER_INFO = {
  name: 'whatsapp-hub',
  version: '1.0.0',
};

const SERVER_INSTRUCTIONS = [
  'WhatsApp Hub exposes your local WhatsApp data — chats, contacts, groups,',
  'messages, media — via tools designed for efficient LLM navigation.',
  '',
  'Recommended workflow:',
  '  1. Start with `whatsapp_overview` for activity at a glance.',
  '  2. Use `resolve_contact` to map a name like "Mom" or "dev group" to a JID.',
  '  3. Drill in with `get_conversation`, `search_messages`, or `recent_activity`.',
  '  4. Use `chat_summary` to summarize without reading every message.',
  '  5. To send, use `send_message` with an explicit JID (no fuzzy matching).',
].join('\n');

export function buildMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
  });
  registerAllTools(server);
  return server;
}
