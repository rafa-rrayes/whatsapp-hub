import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { jsonResult, textResult, errorResult } from '../types.js';
import { resolveOne } from '../resolve.js';
import { messagesRepo, type MessageRow } from '../../database/repositories/messages.js';
import { chatsRepo } from '../../database/repositories/chats.js';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { groupsRepo } from '../../database/repositories/groups.js';
import { mediaRepo } from '../../database/repositories/media.js';
import {
  resolveTimeWindow,
  selectChats,
  selectMessages,
} from '../../export/selector.js';
import { buildNameResolver } from '../../export/name-resolver.js';
import { renderMarkdown } from '../../export/render-md.js';
import { renderText } from '../../export/render-txt.js';
import { renderJson } from '../../export/render-json.js';
import {
  PRESETS,
  type ExportContext,
  type ExportOptions,
  type MessageField,
  type SelectedChat,
  type SelectedMessage,
} from '../../export/types.js';

/** Message timestamps are stored as unix seconds. */
const SECONDS_PER_DAY = 86400;

/** Hard cap for in-memory aggregation queries to bound memory usage. */
const SUMMARY_MESSAGE_CAP = 10000;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function toUnixSeconds(input: string | number | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input === 'number') return Math.floor(input);
  const trimmed = input.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function resolveSenderName(jid: string | undefined, fallback?: string): string {
  if (!jid) return fallback || 'Unknown';
  const contact = contactsRepo.getByJid(jid);
  return (
    contact?.name ||
    contact?.notify_name ||
    contact?.short_name ||
    fallback ||
    jid
  );
}

function resolveChatName(jid: string): string {
  const chat = chatsRepo.getByJid(jid);
  if (chat?.name) return chat.name;
  if (jid.endsWith('@g.us')) {
    const g = groupsRepo.getByJid(jid);
    if (g?.name) return g.name;
  }
  const contact = contactsRepo.getByJid(jid);
  return contact?.name || contact?.notify_name || contact?.short_name || jid;
}

function mediaKindFromMime(mime?: string): string {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return mime === 'image/webp' ? 'sticker' : 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

// ── chat_summary ────────────────────────────────────────────────────────────

const chatSummaryTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'chat_summary',
      {
        title: 'Chat summary',
        description:
          'Compute a high-density activity report for a single chat over the last N days: ' +
          'total messages, top participants, peak hour of day (in the requested timezone), ' +
          'message-type breakdown, media count, and top reactions. Useful before drilling ' +
          'into individual messages — gives the LLM a one-shot snapshot of what a chat is ' +
          'like without paging through history.',
        inputSchema: {
          chat: z
            .string()
            .min(1)
            .describe('Chat name or JID. Use `resolve_contact` first if you have an ambiguous name.'),
          days: z
            .number()
            .int()
            .min(1)
            .max(365)
            .default(7)
            .optional()
            .describe('Window size in days. Default 7, max 365.'),
          timezone: z
            .string()
            .default('UTC')
            .optional()
            .describe('IANA timezone (e.g. "America/Sao_Paulo") used for the peak-hour bucket. Defaults to UTC.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ chat, days, timezone }) => {
        try {
          const resolved = resolveOne(chat);
          if (!resolved.ok) {
            return errorResult(
              `${resolved.message}${
                resolved.candidates.length > 0
                  ? ` Candidates: ${resolved.candidates
                      .slice(0, 5)
                      .map((c) => `${c.name} (${c.jid})`)
                      .join('; ')}`
                  : ''
              }`,
            );
          }

          const windowDays = days ?? 7;
          const tz = isValidTimezone(timezone ?? 'UTC') ? (timezone ?? 'UTC') : 'UTC';
          const nowSec = Math.floor(Date.now() / 1000);
          const sinceSec = nowSec - windowDays * SECONDS_PER_DAY;

          // Pull messages in window (hard-cap to keep memory bounded).
          const queryResult = messagesRepo.query({
            remote_jid: resolved.jid,
            after: sinceSec,
            limit: SUMMARY_MESSAGE_CAP,
            order: 'asc',
          });
          const messages = queryResult.data;

          // Tally per-sender, per-type, per-hour, media, reactions.
          const senderCounts = new Map<string, number>();
          const typeCounts = new Map<string, number>();
          const hourCounts = new Array<number>(24).fill(0);
          const reactionCounts = new Map<string, number>();
          let mediaCount = 0;
          let firstTs: number | null = null;
          let lastTs: number | null = null;

          // 24-hour formatter in the requested timezone.
          const hourFmt = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            hour: '2-digit',
            hour12: false,
          });

          for (const m of messages) {
            if (firstTs === null || m.timestamp < firstTs) firstTs = m.timestamp;
            if (lastTs === null || m.timestamp > lastTs) lastTs = m.timestamp;

            const type = m.message_type || 'unknown';
            typeCounts.set(type, (typeCounts.get(type) || 0) + 1);

            // Per-sender (skip reactions — those count as activity but aren't "messages from" the speaker in the usual sense).
            // Actually, we DO want to count senders across all message kinds since reactions are activity.
            const senderJid = m.from_me === 1 ? '__me__' : (m.participant || m.from_jid);
            if (senderJid) {
              senderCounts.set(senderJid, (senderCounts.get(senderJid) || 0) + 1);
            }

            // Hour-of-day bucket (in the user's timezone).
            try {
              const hourStr = hourFmt.format(new Date(m.timestamp * 1000));
              const hour = parseInt(hourStr, 10);
              if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
                hourCounts[hour]++;
              }
            } catch {
              // skip malformed timestamps
            }

            if (m.has_media === 1) mediaCount++;

            if (m.message_type === 'reaction' && m.reaction_emoji) {
              reactionCounts.set(
                m.reaction_emoji,
                (reactionCounts.get(m.reaction_emoji) || 0) + 1,
              );
            }
          }

          // Top 5 participants.
          const topParticipants = [...senderCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([jid, count]) => ({
              name: jid === '__me__' ? 'Me' : resolveSenderName(jid),
              jid: jid === '__me__' ? null : jid,
              count,
            }));

          // Peak hour — argmax of hourCounts. Falls back to 0 when no messages.
          let peakHour = 0;
          let peakHourCount = -1;
          for (let h = 0; h < 24; h++) {
            if (hourCounts[h] > peakHourCount) {
              peakHourCount = hourCounts[h];
              peakHour = h;
            }
          }

          // Top 5 reactions.
          const topReactions = [...reactionCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([emoji, count]) => ({ emoji, count }));

          const messageTypeBreakdown: Record<string, number> = {};
          for (const [type, count] of typeCounts) messageTypeBreakdown[type] = count;

          return jsonResult({
            chat_name: resolved.name,
            chat_jid: resolved.jid,
            is_group: resolved.is_group,
            window: { days: windowDays, since: sinceSec, until: nowSec },
            total_messages: queryResult.total,
            sampled_messages: messages.length,
            truncated: queryResult.total > messages.length,
            participants: {
              count: senderCounts.size,
              top: topParticipants,
            },
            peak_hour_local: peakHour,
            timezone: tz,
            message_type_breakdown: messageTypeBreakdown,
            media_count: mediaCount,
            top_reactions: topReactions,
            first_message_ts: firstTs,
            last_message_ts: lastTs,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`chat_summary failed: ${message}`);
        }
      },
    );
  },
};

// ── list_media ──────────────────────────────────────────────────────────────

const listMediaTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'list_media',
      {
        title: 'List media items',
        description:
          'Browse media attachments (images, videos, audio, documents, stickers) across one ' +
          'or all chats, optionally filtered by type or time window. Returns lightweight ' +
          'metadata only — use `get_media` (if available) or the HTTP `/api/media/:id/download` ' +
          'endpoint to fetch bytes.',
        inputSchema: {
          chat: z
            .string()
            .min(1)
            .optional()
            .describe('Optional chat name or JID. Omit to search across all chats.'),
          types: z
            .array(z.string())
            .optional()
            .describe(
              'Optional list of media kinds to include. Accepts message types ' +
                '("image", "video", "audio", "document", "sticker") or mime-prefix kinds.',
            ),
          after: z
            .string()
            .optional()
            .describe('Lower bound on timestamp — ISO 8601 string or unix seconds. Inclusive of strict-greater semantics from the underlying repo.'),
          before: z
            .string()
            .optional()
            .describe('Upper bound on timestamp — ISO 8601 string or unix seconds.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(30)
            .optional()
            .describe('Maximum number of media items to return. Default 30, max 100.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ chat, types, after, before, limit }) => {
        try {
          let chatJid: string | undefined;
          if (chat) {
            const resolved = resolveOne(chat);
            if (!resolved.ok) {
              return errorResult(
                `${resolved.message}${
                  resolved.candidates.length > 0
                    ? ` Candidates: ${resolved.candidates
                        .slice(0, 5)
                        .map((c) => `${c.name} (${c.jid})`)
                        .join('; ')}`
                    : ''
                }`,
              );
            }
            chatJid = resolved.jid;
          }

          const afterSec = toUnixSeconds(after);
          const beforeSec = toUnixSeconds(before);
          if (after !== undefined && afterSec === undefined) {
            return errorResult(`Could not parse "after" as ISO date or unix seconds: ${after}`);
          }
          if (before !== undefined && beforeSec === undefined) {
            return errorResult(`Could not parse "before" as ISO date or unix seconds: ${before}`);
          }

          const finalLimit = limit ?? 30;

          // If exactly one type is requested, we can push it into the repo filter.
          // Otherwise, we filter in-memory after fetching a larger candidate pool.
          const useTypeFilter = types && types.length === 1 ? types[0] : undefined;
          const fetchLimit = types && types.length > 1
            ? Math.min(500, finalLimit * 5)
            : finalLimit;

          const queryResult = messagesRepo.query({
            remote_jid: chatJid,
            has_media: true,
            after: afterSec,
            before: beforeSec,
            message_type: useTypeFilter,
            limit: fetchLimit,
            order: 'desc',
          });

          // In-memory filter by media kind when multiple types are requested.
          let candidates: MessageRow[] = queryResult.data;
          if (types && types.length > 1) {
            const wanted = new Set(types.map((t) => t.toLowerCase()));
            candidates = candidates.filter((m) => {
              if (m.message_type && wanted.has(m.message_type.toLowerCase())) return true;
              const kind = mediaKindFromMime(m.media_mime_type);
              return wanted.has(kind);
            });
          }

          const media = candidates.slice(0, finalLimit).map((m) => {
            // Prefer the canonical media row when present; fall back to message-row fields.
            const mr = m.media_id ? mediaRepo.getById(m.media_id) : undefined;
            const mime = mr?.mime_type || m.media_mime_type;
            const kind = mediaKindFromMime(mime);
            const senderJid = m.from_me === 1 ? null : (m.participant || m.from_jid || null);
            return {
              message_id: m.id,
              media_id: m.media_id || null,
              chat_jid: m.remote_jid,
              chat_name: resolveChatName(m.remote_jid),
              sender_jid: senderJid,
              sender_name: m.from_me === 1 ? 'Me' : resolveSenderName(senderJid || undefined, m.push_name),
              timestamp: m.timestamp,
              kind,
              mime_type: mime || null,
              filename: mr?.original_filename || mr?.filename || m.media_filename || null,
              size_bytes: mr?.file_size ?? m.media_size ?? null,
              caption: m.body || null,
              download_status: mr?.download_status || null,
            };
          });

          return jsonResult({
            total: queryResult.total,
            returned: media.length,
            media,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`list_media failed: ${message}`);
        }
      },
    );
  },
};

// ── export_conversation ─────────────────────────────────────────────────────

/**
 * Build a fully-populated ExportOptions object with the same defaults the HTTP
 * schema applies. We bypass HTTP/zod here, so we need to mirror the defaults
 * explicitly to keep `selectChats`, `selectMessages`, and the renderers happy.
 */
function buildExportOptions(overrides: {
  chats: string[];
  from?: number;
  to?: number;
  days?: number;
  preset: 'concise' | 'full' | 'llm' | 'archive';
  format: 'md' | 'txt' | 'json';
  max_messages: number;
  timezone: string;
}): ExportOptions {
  return {
    from: overrides.from,
    to: overrides.to,
    days: overrides.days,

    chats: overrides.chats,
    exclude_chats: undefined,
    groups_only: undefined,
    dms_only: undefined,
    include_archived: true, // explicitly listed chats: trust the caller
    include_muted: true,
    unread_only: false,
    min_messages: 0,
    chat_search: undefined,
    sort_chats_by: 'recent',

    types: undefined,
    exclude_types: ['reaction', 'poll_update'],
    has_media: undefined,
    from_me: undefined,
    include_deleted: false,
    include_system: false,
    min_body_length: 0,
    search: undefined,

    format: overrides.format,
    preset: overrides.preset,
    fields: undefined,

    timezone: overrides.timezone,
    time_format: 'absolute',
    date_grouping: 'day',

    reactions: 'inline',

    me_alias: 'Me',
    prefer_saved_names: true,

    media: 'none',
    media_types: undefined,
    max_media_size_mb: 50,
    include_thumbnails: false,

    redact_phone_numbers: false,
    anonymize_jids: false,
    strip_quoted_bodies: false,

    max_messages: overrides.max_messages,
    max_chats: 500,
  } as ExportOptions;
}

function pickFields(opts: ExportOptions): Set<MessageField> {
  if (opts.fields && opts.fields.length > 0) return new Set(opts.fields);
  return new Set(PRESETS[opts.preset]);
}

function makeFormatters(timezone: string) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const dateGroup = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return {
    formatTime: (unix: number) => time.format(new Date(unix * 1000)),
    formatDate: (unix: number) => date.format(new Date(unix * 1000)),
    formatDateGroup: (unix: number) => dateGroup.format(new Date(unix * 1000)),
  };
}

const exportConversationTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'export_conversation',
      {
        title: 'Export conversation',
        description:
          'Render one or more chats into a portable format (markdown, text, or JSON) using ' +
          'the same export pipeline as the HTTP `/api/export` endpoint. Returns the rendered ' +
          'content inline. Use `preset=concise` for a tight transcript, `preset=llm` for a ' +
          'balanced view, `preset=archive` for everything. Respect `max_messages` — the ' +
          'pipeline truncates oldest-first within the time window when the cap is hit.',
        inputSchema: {
          chat: z
            .string()
            .min(1)
            .optional()
            .describe('Single chat name or JID. Either `chat` or `chats` must be provided.'),
          chats: z
            .array(z.string().min(1))
            .min(1)
            .max(50)
            .optional()
            .describe('Multiple chats to export (names or JIDs). Mutually exclusive with `chat`.'),
          days: z
            .number()
            .int()
            .min(1)
            .max(365)
            .optional()
            .describe('Window size in days, ending now. Overridden by `from`/`to` if both are set.'),
          from: z
            .string()
            .optional()
            .describe('Window start — ISO 8601 string or unix seconds.'),
          to: z
            .string()
            .optional()
            .describe('Window end — ISO 8601 string or unix seconds.'),
          preset: z
            .enum(['concise', 'full', 'llm', 'archive'])
            .default('llm')
            .optional()
            .describe('Field bundle for each message. concise=time+sender+body, llm=adds media/reply/id/edits, archive=everything.'),
          format: z
            .enum(['md', 'txt', 'json'])
            .default('md')
            .optional()
            .describe('Output format. md=markdown, txt=plain text, json=structured. (No zip — binary is not returnable via MCP.)'),
          max_messages: z
            .number()
            .int()
            .min(1)
            .max(10000)
            .default(5000)
            .optional()
            .describe('Hard ceiling on total messages across all chats. Default 5000, max 10000.'),
          timezone: z
            .string()
            .default('UTC')
            .optional()
            .describe('IANA timezone for date/time labels (e.g. "America/Sao_Paulo"). Defaults to UTC.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ chat, chats, days, from, to, preset, format, max_messages, timezone }) => {
        try {
          // Validate that one of chat/chats is supplied and they aren't both set.
          if (!chat && (!chats || chats.length === 0)) {
            return errorResult('Either `chat` or `chats` is required.');
          }
          if (chat && chats && chats.length > 0) {
            return errorResult('`chat` and `chats` are mutually exclusive — pick one.');
          }

          // Validate time window — at least one of days/from/to required by the schema.
          if (days === undefined && from === undefined && to === undefined) {
            return errorResult('Specify a time window: provide `days`, or `from`/`to`.');
          }

          const inputs = chat ? [chat] : chats!;
          const jids: string[] = [];
          for (const q of inputs) {
            const r = resolveOne(q);
            if (!r.ok) {
              return errorResult(`Could not resolve "${q}": ${r.message}`);
            }
            jids.push(r.jid);
          }

          const fromSec = toUnixSeconds(from);
          const toSec = toUnixSeconds(to);
          if (from !== undefined && fromSec === undefined) {
            return errorResult(`Could not parse "from" as ISO date or unix seconds: ${from}`);
          }
          if (to !== undefined && toSec === undefined) {
            return errorResult(`Could not parse "to" as ISO date or unix seconds: ${to}`);
          }

          const tz = isValidTimezone(timezone ?? 'UTC') ? (timezone ?? 'UTC') : 'UTC';

          const opts = buildExportOptions({
            chats: jids,
            from: fromSec,
            to: toSec,
            days,
            preset: preset ?? 'llm',
            format: format ?? 'md',
            max_messages: max_messages ?? 5000,
            timezone: tz,
          });

          const window = resolveTimeWindow(opts);

          // Run the selection pipeline (same shape as runner.ts but without HTTP plumbing).
          const selectedChats = selectChats(opts, window);
          const messagesByChat = new Map<string, SelectedMessage[]>();
          let budget = opts.max_messages;
          for (const sc of selectedChats) {
            const msgs = selectMessages(sc.chat.jid, window, opts, budget);
            messagesByChat.set(sc.chat.jid, msgs);
            const consumed = opts.reactions === 'inline'
              ? msgs.filter((m) => m.message_type !== 'reaction').length
              : msgs.length;
            budget -= consumed;
            if (budget <= 0) break;
          }

          // Keep only chats with messages (or that were explicitly requested).
          const allowlist = new Set(opts.chats || []);
          const finalChats: SelectedChat[] = selectedChats.filter((sc) => {
            if (allowlist.has(sc.chat.jid)) return true;
            return (messagesByChat.get(sc.chat.jid) || []).length > 0;
          });

          // Build the render context.
          const resolver = buildNameResolver(opts);
          const fmt = makeFormatters(tz);
          const ctx: ExportContext = {
            options: opts,
            window,
            baseUrl: '', // No HTTP context — media refs would be invalid, but we use media: 'none'.
            generatedAt: new Date(),
            resolveName: (jid, fallbackPushName) => resolver.resolveName(jid, fallbackPushName),
            resolveChatLabel: (jid) => resolver.resolveChatLabel(jid),
            formatTime: fmt.formatTime,
            formatDate: fmt.formatDate,
            formatDateGroup: fmt.formatDateGroup,
            fields: pickFields(opts),
          };

          if (opts.format === 'md') {
            const md = renderMarkdown(finalChats, messagesByChat, ctx);
            return textResult(md);
          }
          if (opts.format === 'txt') {
            const txt = renderText(finalChats, messagesByChat, ctx);
            return textResult(txt);
          }
          // json
          const obj = renderJson(finalChats, messagesByChat, ctx);
          return jsonResult(obj);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`export_conversation failed: ${message}`);
        }
      },
    );
  },
};

export const aggregationTools: McpTool[] = [
  chatSummaryTool,
  listMediaTool,
  exportConversationTool,
];
