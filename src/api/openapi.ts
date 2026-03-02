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
      '/openapi.json': {
        get: { summary: 'OpenAPI specification', tags: ['System'], security: [], responses: { '200': ok } },
      },
    },
  };
}
