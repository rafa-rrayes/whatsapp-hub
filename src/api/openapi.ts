import { z } from 'zod';
import {
  sendTextSchema,
  sendMediaSchema,
  sendDocumentSchema,
  sendAudioSchema,
  sendVideoSchema,
  sendStickerSchema,
  sendLocationSchema,
  sendContactSchema,
  reactSchema,
  readSchema,
  presenceSchema,
  profileStatusSchema,
  webhookCreateSchema,
  settingsUpdateSchema,
  groupSubjectSchema,
  groupDescriptionSchema,
  groupParticipantsSchema,
  exportRequestSchema,
} from './schemas.js';

function toJsonSchema(schema: z.ZodType): object {
  try {
    return (schema as any).toJSONSchema();
  } catch {
    return { type: 'object' };
  }
}

function jsonBody(schema: z.ZodType): object {
  return {
    content: {
      'application/json': {
        schema: toJsonSchema(schema),
      },
    },
    required: true,
  };
}

const ok = { description: 'Success', content: { 'application/json': { schema: { type: 'object' } } } };
const notFound = { description: 'Not found' };
const unauthorized = { description: 'Unauthorized' };
const badRequest = { description: 'Bad request' };

export function generateOpenApiSpec(): object {
  return {
    openapi: '3.1.0',
    info: {
      title: 'WhatsApp Hub API',
      version: '1.0.0',
      description: 'Self-hosted WhatsApp API hub — REST API for messaging, contacts, groups, media, webhooks, and more.',
    },
    servers: [{ url: '/api', description: 'API base path' }],
    security: [{ apiKeyHeader: [] }, { bearerAuth: [] }],
    components: {
      securitySchemes: {
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    paths: {
      '/health': {
        get: { summary: 'Health check', tags: ['System'], security: [], responses: { '200': ok } },
      },
      '/messages': {
        get: {
          summary: 'Query messages',
          tags: ['Messages'],
          parameters: [
            { name: 'chat', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string' } },
            { name: 'from_me', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'before', in: 'query', schema: { type: 'integer' } },
            { name: 'after', in: 'query', schema: { type: 'integer' } },
            { name: 'has_media', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          ],
          responses: { '200': ok, '401': unauthorized },
        },
      },
      '/messages/search': {
        get: {
          summary: 'Full-text message search',
          tags: ['Messages'],
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'chat', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/messages/stats': {
        get: { summary: 'Message statistics', tags: ['Messages'], responses: { '200': ok, '401': unauthorized } },
      },
      '/messages/{id}': {
        get: {
          summary: 'Get message by ID',
          tags: ['Messages'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok, '404': notFound, '401': unauthorized },
        },
      },
      '/contacts': {
        get: {
          summary: 'List contacts',
          tags: ['Contacts'],
          parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }],
          responses: { '200': ok, '401': unauthorized },
        },
      },
      '/contacts/{jid}': {
        get: {
          summary: 'Get contact by JID',
          tags: ['Contacts'],
          parameters: [{ name: 'jid', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok, '404': notFound, '401': unauthorized },
        },
      },
      '/groups': {
        get: {
          summary: 'List groups',
          tags: ['Groups'],
          parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }],
          responses: { '200': ok, '401': unauthorized },
        },
      },
      '/groups/{jid}': {
        get: {
          summary: 'Get group with participants',
          tags: ['Groups'],
          parameters: [{ name: 'jid', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok, '404': notFound, '401': unauthorized },
        },
      },
      '/groups/{jid}/subject': {
        put: {
          summary: 'Update group subject',
          tags: ['Groups'],
          parameters: [{ name: 'jid', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody(groupSubjectSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/groups/{jid}/description': {
        put: {
          summary: 'Update group description',
          tags: ['Groups'],
          parameters: [{ name: 'jid', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody(groupDescriptionSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/groups/{jid}/participants': {
        post: {
          summary: 'Manage group participants',
          tags: ['Groups'],
          parameters: [{ name: 'jid', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody(groupParticipantsSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/send/text': {
        post: {
          summary: 'Send text message',
          tags: ['Actions'],
          requestBody: jsonBody(sendTextSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/send/image': {
        post: {
          summary: 'Send image',
          tags: ['Actions'],
          requestBody: jsonBody(sendMediaSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/send/document': {
        post: {
          summary: 'Send document',
          tags: ['Actions'],
          requestBody: jsonBody(sendDocumentSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/send/audio': {
        post: {
          summary: 'Send audio',
          tags: ['Actions'],
          requestBody: jsonBody(sendAudioSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/send/video': {
        post: {
          summary: 'Send video',
          tags: ['Actions'],
          requestBody: jsonBody(sendVideoSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/send/sticker': {
        post: {
          summary: 'Send sticker',
          tags: ['Actions'],
          requestBody: jsonBody(sendStickerSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/send/location': {
        post: {
          summary: 'Send location',
          tags: ['Actions'],
          requestBody: jsonBody(sendLocationSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/send/contact': {
        post: {
          summary: 'Send contact card',
          tags: ['Actions'],
          requestBody: jsonBody(sendContactSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/react': {
        post: {
          summary: 'React to a message',
          tags: ['Actions'],
          requestBody: jsonBody(reactSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/read': {
        post: {
          summary: 'Mark messages as read',
          tags: ['Actions'],
          requestBody: jsonBody(readSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/presence': {
        post: {
          summary: 'Send presence update',
          tags: ['Actions'],
          requestBody: jsonBody(presenceSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/actions/profile-status': {
        put: {
          summary: 'Update profile status text',
          tags: ['Actions'],
          requestBody: jsonBody(profileStatusSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/media/stats': {
        get: { summary: 'Media statistics', tags: ['Media'], responses: { '200': ok, '401': unauthorized } },
      },
      '/media/{id}': {
        get: {
          summary: 'Get media metadata',
          tags: ['Media'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok, '404': notFound, '401': unauthorized },
        },
      },
      '/media/{id}/download': {
        get: {
          summary: 'Download media file',
          tags: ['Media'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Binary media file' }, '404': notFound, '401': unauthorized },
        },
      },
      '/media/{id}/retry': {
        post: {
          summary: 'Retry failed media download',
          tags: ['Media'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok, '404': notFound, '401': unauthorized },
        },
      },
      '/webhooks': {
        get: { summary: 'List webhook subscriptions', tags: ['Webhooks'], responses: { '200': ok, '401': unauthorized } },
        post: {
          summary: 'Create webhook subscription',
          tags: ['Webhooks'],
          requestBody: jsonBody(webhookCreateSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/webhooks/{id}': {
        delete: {
          summary: 'Delete webhook subscription',
          tags: ['Webhooks'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok, '401': unauthorized },
        },
      },
      '/webhooks/{id}/toggle': {
        put: {
          summary: 'Toggle webhook active/inactive',
          tags: ['Webhooks'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok, '401': unauthorized },
        },
      },
      '/webhooks/deliveries': {
        get: {
          summary: 'Query webhook delivery log',
          tags: ['Webhooks'],
          parameters: [
            { name: 'subscription_id', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['failed', 'exhausted', 'delivered'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': ok, '401': unauthorized },
        },
      },
      '/webhooks/deliveries/{id}/retry': {
        post: {
          summary: 'Manually retry a failed webhook delivery',
          tags: ['Webhooks'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok, '404': notFound, '401': unauthorized },
        },
      },
      '/chats': {
        get: { summary: 'List all chats', tags: ['Chats'], responses: { '200': ok, '401': unauthorized } },
      },
      '/chats/{jid}': {
        get: {
          summary: 'Chat details with recent messages',
          tags: ['Chats'],
          parameters: [{ name: 'jid', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok, '404': notFound, '401': unauthorized },
        },
      },
      '/settings': {
        get: { summary: 'List runtime settings', tags: ['Settings'], responses: { '200': ok, '401': unauthorized } },
        put: {
          summary: 'Update runtime settings',
          tags: ['Settings'],
          requestBody: jsonBody(settingsUpdateSchema),
          responses: { '200': ok, '400': badRequest, '401': unauthorized },
        },
      },
      '/stats': {
        get: { summary: 'Dashboard overview', tags: ['Stats'], responses: { '200': ok, '401': unauthorized } },
      },
      '/connection/status': {
        get: { summary: 'Connection status', tags: ['Connection'], responses: { '200': ok, '401': unauthorized } },
      },
      '/connection/qr': {
        get: { summary: 'Get QR code for authentication', tags: ['Connection'], responses: { '200': ok, '401': unauthorized } },
      },
      '/connection/restart': {
        post: { summary: 'Restart WhatsApp connection', tags: ['Connection'], responses: { '200': ok, '401': unauthorized } },
      },
      '/connection/logout': {
        post: { summary: 'Logout and disconnect', tags: ['Connection'], responses: { '200': ok, '401': unauthorized } },
      },
      '/ws/ticket': {
        post: { summary: 'Get one-time WebSocket ticket', tags: ['WebSocket'], responses: { '200': ok, '401': unauthorized } },
      },
      '/export': {
        post: {
          summary: 'Export conversations as Markdown / txt / json / zip',
          description: 'Single richly-parameterised endpoint for exporting messages with filters (time window, chats, message types, media handling, privacy). See requestBody schema for all options.',
          tags: ['Export'],
          requestBody: jsonBody(exportRequestSchema),
          responses: {
            '200': {
              description: 'Export file (markdown by default; format determined by request body)',
              content: {
                'text/markdown': { schema: { type: 'string' } },
                'text/plain': { schema: { type: 'string' } },
                'application/json': { schema: { type: 'object' } },
                'application/zip': { schema: { type: 'string', format: 'binary' } },
              },
            },
            '400': badRequest,
            '401': unauthorized,
            '429': { description: 'Too many export requests (limit 5/min/key)' },
          },
        },
        get: {
          summary: 'Export convenience GET (trivial exports only)',
          description: 'Query-string variant for simple exports; use POST for full options.',
          tags: ['Export'],
          parameters: [
            { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365 } },
            { name: 'from', in: 'query', schema: { oneOf: [{ type: 'integer' }, { type: 'string', format: 'date-time' }] } },
            { name: 'to', in: 'query', schema: { oneOf: [{ type: 'integer' }, { type: 'string', format: 'date-time' }] } },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['md', 'txt', 'json', 'zip'], default: 'md' } },
            { name: 'preset', in: 'query', schema: { type: 'string', enum: ['concise', 'full', 'llm', 'archive'], default: 'full' } },
            { name: 'timezone', in: 'query', schema: { type: 'string', default: 'UTC' } },
            { name: 'media', in: 'query', schema: { type: 'string', enum: ['none', 'ref', 'embed', 'attach'], default: 'none' } },
            { name: 'reactions', in: 'query', schema: { type: 'string', enum: ['inline', 'separate', 'omit'], default: 'inline' } },
            { name: 'date_grouping', in: 'query', schema: { type: 'string', enum: ['none', 'day', 'hour'], default: 'day' } },
            { name: 'sort_chats_by', in: 'query', schema: { type: 'string', enum: ['recent', 'volume', 'name'], default: 'recent' } },
            { name: 'groups_only', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'dms_only', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'has_media', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'from_me', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'me_alias', in: 'query', schema: { type: 'string', default: 'Me' } },
          ],
          responses: {
            '200': {
              description: 'Export file (markdown by default)',
              content: {
                'text/markdown': { schema: { type: 'string' } },
                'text/plain': { schema: { type: 'string' } },
                'application/json': { schema: { type: 'object' } },
                'application/zip': { schema: { type: 'string', format: 'binary' } },
              },
            },
            '400': badRequest,
            '401': unauthorized,
            '429': { description: 'Too many export requests' },
          },
        },
      },
      '/mcp': {
        // MCP is mounted at the server root (POST /mcp), not under the /api base path.
        servers: [{ url: '/', description: 'Server root — MCP is mounted outside /api' }],
        post: {
          summary: 'MCP (Model Context Protocol) endpoint',
          description:
            'Absolute path: `POST /mcp` (mounted at the server root, not under `/api`). ' +
            'Speaks JSON-RPC 2.0 over stateless Streamable HTTP and exposes WhatsApp data and ' +
            'actions as MCP tools for AI clients such as Claude. Each call is a self-contained ' +
            'POST; GET and DELETE return 405. Authenticate with `x-api-key` (the same key as the ' +
            'REST API) or an OAuth 2.1 bearer token for claude.ai-style connectors (discovery at ' +
            '`/.well-known/oauth-protected-resource/mcp`).\n\n' +
            'Read tools: `whatsapp_overview`, `resolve_contact`, `list_chats`, `search_messages`, ' +
            '`recent_activity`, `get_conversation`, `get_message`, `get_thread`, `chat_summary`, ' +
            '`list_media`, `export_conversation`. Write tools: `send_message`, `react_to_message`. ' +
            'Call `tools/list` for the live input schemas and `tools/call` to invoke a tool.',
          tags: ['MCP'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description: 'JSON-RPC 2.0 request, e.g. { "jsonrpc": "2.0", "id": 1, "method": "tools/list" }',
                },
              },
            },
          },
          responses: {
            '200': ok,
            '401': unauthorized,
            '405': { description: 'Method Not Allowed (only POST is supported)' },
          },
        },
      },
      '/openapi.json': {
        get: { summary: 'OpenAPI specification', tags: ['System'], security: [], responses: { '200': ok } },
      },
      '/openapi.md': {
        get: {
          summary: 'OpenAPI specification rendered as Markdown',
          tags: ['System'],
          security: [],
          parameters: [
            { name: 'download', in: 'query', schema: { type: 'string' }, description: 'If present, sets Content-Disposition for file download' },
          ],
          responses: {
            '200': { description: 'Markdown document', content: { 'text/markdown': { schema: { type: 'string' } } } },
          },
        },
      },
    },
  };
}
