import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { jsonResult, errorResult } from '../types.js';
import { isJid } from '../resolve.js';
import { connectionManager } from '../../connection/manager.js';
import { validateUrlForFetch } from '../../utils/security.js';
import { config } from '../../config.js';

/**
 * Tier 4: action tools — the only WRITE tools in the MCP module.
 *
 * Safety design:
 *   - All targeting requires a JID (no fuzzy name matching). The LLM must
 *     resolve names via `resolve_contact` first. This prevents "sent to wrong
 *     Maria" errors.
 *   - Annotations advertise `readOnlyHint: false` and `openWorldHint: true`
 *     so MCP clients can prompt the user before invoking.
 *   - `send_message` is NOT idempotent (sending twice sends twice).
 *     `react_to_message` IS idempotent (re-applying the same reaction is a no-op).
 */

/**
 * Download a buffer from a URL with SSRF protection and a configurable
 * size cap. Mirrors `resolveBuffer` in src/api/routes/actions.ts (URL-only,
 * since MCP tools don't accept raw base64 payloads).
 */
async function downloadMediaBuffer(url: string): Promise<Buffer> {
  await validateUrlForFetch(url);

  const maxBytes = config.maxMediaSizeMB * 1024 * 1024;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch media: HTTP ${response.status}`);
  }

  // Early rejection via Content-Length header
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength && contentLength > maxBytes) {
    throw new Error(
      `File too large: ${Math.round(contentLength / 1024 / 1024)}MB exceeds ${config.maxMediaSizeMB}MB limit`,
    );
  }

  // Stream with chunk-by-chunk size guard
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > maxBytes) {
      reader.cancel();
      throw new Error(`File too large: exceeds ${config.maxMediaSizeMB}MB limit`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

const sendMessageTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'send_message',
      {
        title: 'Send WhatsApp message',
        description:
          'Send a WhatsApp message (text, media, or location) to a chat. ' +
          'Requires an explicit JID — use `resolve_contact` first if you only ' +
          'have a name. Media kinds (image/video/audio/document) require a ' +
          '`media_url` to fetch from. Use `kind=location` with the `location` ' +
          'object to share coordinates. Use `quoted_message_id` to reply to ' +
          'a specific message.',
        inputSchema: {
          jid: z
            .string()
            .describe(
              'Target JID (e.g. "5511999999999@s.whatsapp.net" for DMs or ' +
              '"...@g.us" for groups). Use `resolve_contact` to look up the ' +
              'JID for a name. Fuzzy matching is NOT supported here for safety.',
            ),
          kind: z
            .enum(['text', 'image', 'video', 'audio', 'document', 'location'])
            .optional()
            .describe(
              'Message kind. If omitted, inferred: "location" when `location` ' +
              'is set, "text" when only `text` is set. For media you MUST set ' +
              'this explicitly (image/video/audio/document).',
            ),
          text: z
            .string()
            .optional()
            .describe('Text body, or caption for image/video/document media.'),
          media_url: z
            .string()
            .url()
            .optional()
            .describe(
              'HTTPS URL to download media from. Required for kind=image/video/audio/document. ' +
              `Max size: ${config.maxMediaSizeMB}MB.`,
            ),
          filename: z
            .string()
            .optional()
            .describe('Filename for documents. Required when kind=document.'),
          mime_type: z
            .string()
            .optional()
            .describe(
              'MIME type override (e.g. "image/png", "application/pdf"). ' +
              'Required for kind=document; optional for other media kinds.',
            ),
          location: z
            .object({
              lat: z.number().describe('Latitude in decimal degrees.'),
              lng: z.number().describe('Longitude in decimal degrees.'),
              name: z.string().optional().describe('Optional place name.'),
              address: z.string().optional().describe('Optional street address.'),
            })
            .optional()
            .describe('Location payload. Used when kind=location.'),
          quoted_message_id: z
            .string()
            .optional()
            .describe(
              'ID of the message to quote/reply to. The message must exist in ' +
              'the local DB. Only applies to text messages.',
            ),
        },
        annotations: {
          readOnlyHint: false,
          idempotentHint: false,
          openWorldHint: true,
          destructiveHint: false,
        },
      },
      async ({ jid, kind, text, media_url, filename, mime_type, location, quoted_message_id }) => {
        if (!isJid(jid)) {
          return errorResult(
            'Invalid JID format. Use `resolve_contact` to look up the JID for a name.',
          );
        }

        // Infer kind when omitted. Conservatively require an explicit `kind`
        // when a media URL is provided so we never guess the wrong media type.
        let resolvedKind: 'text' | 'location' | MediaKind;
        if (kind) {
          resolvedKind = kind;
        } else if (location) {
          resolvedKind = 'location';
        } else if (media_url) {
          return errorResult(
            'media_url provided without `kind`. Set kind to one of: image, video, audio, document.',
          );
        } else if (text !== undefined) {
          resolvedKind = 'text';
        } else {
          return errorResult('Nothing to send: provide `text`, `media_url`, or `location`.');
        }

        try {
          switch (resolvedKind) {
            case 'text': {
              if (!text || text.length === 0) {
                return errorResult('kind=text requires a non-empty `text`.');
              }
              const result = await connectionManager.sendTextMessage(jid, text, quoted_message_id);
              return jsonResult({
                ok: true,
                message_id: result?.key?.id ?? null,
                jid,
                kind: 'text',
                timestamp: Math.floor(Date.now() / 1000),
              });
            }
            case 'image': {
              if (!media_url) return errorResult('kind=image requires `media_url`.');
              const buffer = await downloadMediaBuffer(media_url);
              const result = await connectionManager.sendImage(jid, buffer, text, mime_type);
              return jsonResult({
                ok: true,
                message_id: result?.key?.id ?? null,
                jid,
                kind: 'image',
                timestamp: Math.floor(Date.now() / 1000),
              });
            }
            case 'video': {
              if (!media_url) return errorResult('kind=video requires `media_url`.');
              const buffer = await downloadMediaBuffer(media_url);
              const result = await connectionManager.sendVideo(jid, buffer, text);
              return jsonResult({
                ok: true,
                message_id: result?.key?.id ?? null,
                jid,
                kind: 'video',
                timestamp: Math.floor(Date.now() / 1000),
              });
            }
            case 'audio': {
              if (!media_url) return errorResult('kind=audio requires `media_url`.');
              const buffer = await downloadMediaBuffer(media_url);
              // ptt defaults to false — voice-note semantics aren't part of the MCP surface.
              const result = await connectionManager.sendAudio(jid, buffer, false);
              return jsonResult({
                ok: true,
                message_id: result?.key?.id ?? null,
                jid,
                kind: 'audio',
                timestamp: Math.floor(Date.now() / 1000),
              });
            }
            case 'document': {
              if (!media_url) return errorResult('kind=document requires `media_url`.');
              if (!filename) return errorResult('kind=document requires `filename`.');
              if (!mime_type) return errorResult('kind=document requires `mime_type`.');
              const buffer = await downloadMediaBuffer(media_url);
              const result = await connectionManager.sendDocument(jid, buffer, filename, mime_type, text);
              return jsonResult({
                ok: true,
                message_id: result?.key?.id ?? null,
                jid,
                kind: 'document',
                timestamp: Math.floor(Date.now() / 1000),
              });
            }
            case 'location': {
              if (!location) return errorResult('kind=location requires the `location` object.');
              const result = await connectionManager.sendLocation(
                jid,
                location.lat,
                location.lng,
                location.name,
                location.address,
              );
              return jsonResult({
                ok: true,
                message_id: result?.key?.id ?? null,
                jid,
                kind: 'location',
                timestamp: Math.floor(Date.now() / 1000),
              });
            }
            default: {
              // Exhaustiveness guard — the switch covers every value in the
              // union, so this branch is unreachable. The assignment forces
              // a compile error if the union ever grows without updating here.
              const _exhaustive: never = resolvedKind;
              return errorResult(`Unsupported kind: ${String(_exhaustive)}`);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`send_message failed: ${message}`);
        }
      },
    );
  },
};

const reactToMessageTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'react_to_message',
      {
        title: 'React to a WhatsApp message',
        description:
          'Add, replace, or remove a reaction emoji on a specific WhatsApp ' +
          'message. Pass an empty string for `emoji` to remove an existing ' +
          'reaction. Idempotent: re-applying the same reaction is a no-op on ' +
          "WhatsApp's side.",
        inputSchema: {
          jid: z
            .string()
            .describe(
              'JID of the chat where the message lives. Use `resolve_contact` ' +
              'to look up the JID for a name.',
            ),
          message_id: z
            .string()
            .min(1)
            .describe('ID of the message to react to (the `key.id` of the target message).'),
          emoji: z
            .string()
            .describe(
              'Reaction emoji (e.g. "👍", "❤️"). Pass an empty string to remove ' +
              'an existing reaction from this message.',
            ),
        },
        annotations: {
          readOnlyHint: false,
          idempotentHint: true,
          openWorldHint: true,
          destructiveHint: false,
        },
      },
      async ({ jid, message_id, emoji }) => {
        if (!isJid(jid)) {
          return errorResult(
            'Invalid JID format. Use `resolve_contact` to look up the JID for a name.',
          );
        }
        if (!message_id) {
          return errorResult('`message_id` is required.');
        }
        if (typeof emoji !== 'string') {
          return errorResult('`emoji` is required (use an empty string to remove a reaction).');
        }
        try {
          await connectionManager.sendReaction(jid, message_id, emoji);
          return jsonResult({
            ok: true,
            message_id,
            emoji,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`react_to_message failed: ${message}`);
        }
      },
    );
  },
};

export const actionTools: McpTool[] = [sendMessageTool, reactToMessageTool];
