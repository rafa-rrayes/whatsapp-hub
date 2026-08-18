import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { jsonResult, errorResult } from '../types.js';
import { isJid } from '../resolve.js';
import { maskJid } from '../prose.js';
import { connectionManager } from '../../connection/manager.js';
import { messagesRepo } from '../../database/repositories/messages.js';
import { chatsRepo } from '../../database/repositories/chats.js';
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
 *     `mark_read` IS idempotent but destructive: it drops the unread marker and
 *     shows the other side blue ticks, neither of which can be taken back.
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

/**
 * Ceiling on how many read receipts one `mark_read` call will send.
 *
 * `unread_count` is WhatsApp's number, mirrored into our DB — it can be stale,
 * or four digits after a history sync, and nothing validates it. Receipts also
 * only need the newest messages to be meaningful (the blue tick the other side
 * sees is driven by the tail of the conversation), so acknowledging the whole
 * backlog buys nothing while letting one tool call fan out unboundedly.
 * 50 matches the default page size used elsewhere in the MCP read paths.
 */
const MAX_READ_RECEIPTS = 50;

const markReadTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'mark_read',
      {
        title: 'Mark a WhatsApp chat as read',
        description:
          'Clear a chat\'s unread state by sending WhatsApp read receipts. ' +
          'THE OTHER PEOPLE IN THE CHAT WILL SEE BLUE TICKS: this is visible to ' +
          'real humans, it tells them their message was read just now, and it ' +
          'cannot be undone. Only call it once the messages have actually been ' +
          'read. Omit `message_ids` to acknowledge the chat\'s unread received ' +
          `messages (newest first, at most ${MAX_READ_RECEIPTS}) and reset the ` +
          "chat's local unread counter to 0 once WhatsApp accepts the receipts, " +
          'or pass specific IDs to acknowledge only those and leave the counter ' +
          'alone. A chat with nothing unread sends nothing and says so. ' +
          'Works for groups: the receipt carries the original sender, taken ' +
          'from the locally stored copy of the message.',
        inputSchema: {
          jid: z
            .string()
            .describe(
              'JID of the chat to mark read (e.g. "5511999999999@s.whatsapp.net" ' +
              'or "...@g.us"). Use `resolve_contact` to look up the JID for a name.',
            ),
          message_ids: z
            .array(z.string().min(1))
            .min(1)
            .max(MAX_READ_RECEIPTS)
            .optional()
            .describe(
              'Specific message IDs to acknowledge. Omit this to acknowledge ' +
              "the chat's unread received messages automatically (newest first), " +
              'which is what you want for ordinary inbox triage.',
            ),
        },
        annotations: {
          readOnlyHint: false,
          // Re-running the same call leaves the same state: the chat is read,
          // and WhatsApp shows one blue tick per message however many receipts
          // arrive for it.
          idempotentHint: true,
          openWorldHint: true,
          // Not additive: it removes the unread marker — the whole triage
          // signal — and neither that nor the receipt the other side saw can be
          // taken back. Clients should treat it as needing confirmation.
          destructiveHint: true,
        },
      },
      async ({ jid, message_ids }) => {
        if (!isJid(jid)) {
          return errorResult(
            'Invalid JID format. Use `resolve_contact` to look up the JID for a name.',
          );
        }

        try {
          const chat = chatsRepo.getByJid(jid);

          // Targets carry `participant` so group receipts are attributed to the
          // message's original sender; a group receipt without it is dropped.
          let targets: Array<{ id: string; participant?: string }>;
          let capped = false;

          if (message_ids && message_ids.length > 0) {
            targets = [];
            for (const id of message_ids) {
              const row = messagesRepo.getById(id);
              // Unknown IDs still go out (we may simply not have stored them),
              // but anything we DO know about gets checked — sending a receipt
              // into the wrong chat is the same class of mistake as sending a
              // message to the wrong Maria.
              if (row && row.remote_jid !== jid) {
                // Named, never JID'd. The caller asked about *this* chat; an
                // error message is no place to hand it the raw identifier of a
                // different one it never had.
                const other = chatsRepo.getByJid(row.remote_jid);
                return errorResult(
                  `Message ${id} belongs to a different chat ` +
                  `(${other?.name?.trim() || maskJid(row.remote_jid)}). ` +
                  'Send read receipts to the chat the message is in.',
                );
              }
              if (row?.from_me) {
                return errorResult(
                  `Message ${id} was sent by you — read receipts only apply to ` +
                  'messages you received.',
                );
              }
              targets.push({ id, participant: row?.participant });
            }
          } else {
            if (!chat) {
              return errorResult(
                'No chat with that JID in the local mirror. Use `list_chats` or ' +
                '`resolve_contact` to find the right JID, or pass `message_ids` ' +
                'explicitly.',
              );
            }
            const unread = chat.unread_count ?? 0;
            if (unread <= 0) {
              // Nothing to do is not a failure — and it must not cost a
              // pointless network round trip or a bogus blue tick.
              return jsonResult({
                ok: true,
                jid,
                marked: 0,
                unread_before: 0,
                message_ids: [],
                note: 'Chat had nothing unread; no read receipts were sent.',
              });
            }
            capped = unread > MAX_READ_RECEIPTS;
            const { data } = messagesRepo.query({
              remote_jid: jid,
              from_me: false,
              order: 'desc',
              limit: Math.min(unread, MAX_READ_RECEIPTS),
            });
            if (data.length === 0) {
              return errorResult(
                `Chat reports ${unread} unread but no received messages are stored ` +
                'locally, so there is nothing to acknowledge. Run `sync_history` ' +
                'for this chat first.',
              );
            }
            targets = data.map((m) => ({ id: m.id, participant: m.participant }));
          }

          await connectionManager.markRead(jid, targets);

          // The counter is only cleared on the automatic path, which is the one
          // that just acknowledged the chat's unread tail. A caller naming
          // specific IDs may well have acknowledged one old message out of
          // twelve, and zeroing the chat there would leave the inbox claiming
          // nothing is waiting when eleven messages are. The asymmetry is
          // deliberate: a stale unread count gets the chat triaged twice, a
          // false zero drops it silently. Only after WhatsApp accepted the
          // receipts — clearing first would claim a chat is read when the other
          // side never saw a blue tick.
          const cleared = !message_ids || message_ids.length === 0;
          if (cleared) chatsRepo.clearUnread(jid);

          const notes: string[] = [];
          if (capped) {
            notes.push(
              `Chat reported ${chat?.unread_count} unread; receipts were sent for ` +
              `the newest ${targets.length}.`,
            );
          }
          notes.push(
            cleared
              ? 'The local unread counter for this chat is now 0.'
              : 'The local unread counter was left alone: you named specific ' +
                'messages, so the chat may still hold unread ones. Call without ' +
                '`message_ids` to clear it.',
          );

          return jsonResult({
            ok: true,
            jid,
            marked: targets.length,
            message_ids: targets.map((t) => t.id),
            unread_before: chat?.unread_count ?? null,
            unread_cleared: cleared,
            capped,
            note: notes.join(' '),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`mark_read failed: ${message}`);
        }
      },
    );
  },
};

/**
 * Request older chat history from WhatsApp, anchored on the oldest message we
 * already have stored (Baileys walks backwards from that cursor). Mirrors the
 * REST `syncOneChat` helper in src/api/routes/chats.ts so the two surfaces stay
 * in lockstep. Returns null when there's no stored message to anchor on.
 */
async function syncOneChatHistory(jid: string, count: number) {
  const oldest = messagesRepo.getOldestForChat(jid);
  if (!oldest) return null;
  const key = {
    remoteJid: jid,
    id: oldest.id,
    fromMe: !!oldest.from_me,
    participant: oldest.participant || undefined,
  };
  const requestId = await connectionManager.requestHistorySync(key, oldest.timestamp, count);
  return { requestId, cursor: { id: oldest.id, timestamp: oldest.timestamp } };
}

const syncHistoryTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'sync_history',
      {
        title: 'Sync older WhatsApp history',
        description:
          'Request older message history from WhatsApp, anchored on the oldest ' +
          'message already stored locally (WhatsApp walks backwards from there). ' +
          'Pass a `jid` to sync one chat; omit it to bulk-sync every chat (with ' +
          'throttling). Older messages arrive ASYNCHRONOUSLY in the background — ' +
          'they will not be in the response, but show up in subsequent searches/' +
          'queries once WhatsApp delivers them. A chat with no stored messages ' +
          'cannot be anchored and is skipped.',
        inputSchema: {
          jid: z
            .string()
            .optional()
            .describe(
              'Target chat JID to sync (e.g. "5511999999999@s.whatsapp.net" or ' +
              '"...@g.us"). Omit to bulk-sync ALL chats. Use `resolve_contact` ' +
              'to look up the JID for a name.',
            ),
          count: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('How many older messages to request per chat (1–500, default 50).'),
        },
        annotations: {
          readOnlyHint: false,
          idempotentHint: false,
          openWorldHint: true,
          destructiveHint: false,
        },
      },
      async ({ jid, count }) => {
        const resolvedCount = count ?? 50;
        try {
          // Single-chat sync.
          if (jid !== undefined) {
            if (!isJid(jid)) {
              return errorResult(
                'Invalid JID format. Use `resolve_contact` to look up the JID for a name.',
              );
            }
            const result = await syncOneChatHistory(jid, resolvedCount);
            if (!result) {
              return errorResult(
                'No stored messages to anchor history sync for this chat. ' +
                'WhatsApp can only fetch history older than a message we already have.',
              );
            }
            return jsonResult({
              ok: true,
              jid,
              request_id: result.requestId,
              cursor: result.cursor,
              count: resolvedCount,
              note:
                'Older messages arrive asynchronously and will appear in ' +
                'subsequent searches/queries once WhatsApp delivers them.',
            });
          }

          // Bulk sync across every chat. Mirrors POST /api/chats/sync-history.
          const allChats = chatsRepo.getAll({ limit: 10000 });
          let requested = 0;
          let skipped = 0;
          for (const chat of allChats) {
            const result = await syncOneChatHistory(chat.jid, resolvedCount);
            if (result) requested++;
            else skipped++;
            // Throttle so we don't flood WhatsApp with history requests.
            await new Promise((r) => setTimeout(r, 600));
          }
          return jsonResult({
            ok: true,
            requested,
            skipped,
            total: allChats.length,
            count: resolvedCount,
            note:
              'Older messages arrive asynchronously and will appear in ' +
              'subsequent searches/queries once WhatsApp delivers them.',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`sync_history failed: ${message}`);
        }
      },
    );
  },
};

export const actionTools: McpTool[] = [
  sendMessageTool,
  reactToMessageTool,
  markReadTool,
  syncHistoryTool,
];
