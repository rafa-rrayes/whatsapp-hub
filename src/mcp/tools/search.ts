import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { jsonResult, textResult, errorResult } from '../types.js';
import { resolveOne, isJid } from '../resolve.js';
import { renderConversation } from '../render.js';
import { messagesRepo, type MessageRow } from '../../database/repositories/messages.js';
import { chatsRepo, type ChatRow } from '../../database/repositories/chats.js';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { groupsRepo } from '../../database/repositories/groups.js';

/** Project-wide convention: message timestamps are unix seconds. */
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/** Default message types excluded from "recent activity" — noise that hides real content. */
const DEFAULT_EXCLUDE_TYPES = ['reaction', 'poll_update'];

/**
 * Accepts either an ISO 8601 string or a unix number (as number or string).
 * Returns unix seconds. Heuristic: any numeric value >= 1e12 is treated as ms.
 * Returns null on parse failure so callers can decide how to react.
 */
function parseTimeToSeconds(input: unknown): number | null {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input >= 1e12 ? Math.floor(input / 1000) : Math.floor(input);
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  // Numeric string → same heuristic.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return n >= 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the unix seconds at midnight of the given date in the given IANA tz.
 * Uses `Intl.DateTimeFormat` to read parts in the target zone, then reconstructs
 * the moment via the offset implied by formatting that local wall-clock back to UTC.
 */
function startOfDayInTz(nowSec: number, timezone: string, offsetDays = 0): number {
  const now = new Date((nowSec + offsetDays * SECONDS_PER_DAY) * 1000);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // 'YYYY-MM-DD' in target tz.
  const ymd = fmt.format(now);
  // Build the moment "ymd 00:00:00" in the target tz by interpreting it as UTC
  // first and correcting via the tz offset for that instant.
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(utcMidnight)) return nowSec;
  // Difference between what that instant formats to in tz vs UTC = tz offset.
  const offsetMs = computeTzOffsetMs(utcMidnight, timezone);
  return Math.floor((utcMidnight - offsetMs) / 1000);
}

/** Offset in milliseconds: how far the named tz is ahead of UTC at `instantMs`. */
function computeTzOffsetMs(instantMs: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(instantMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const asUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second'))
  );
  return asUtc - instantMs;
}

/** Build a snippet of length `max` from a body, falling back to a type tag for media-only. */
function buildSnippet(row: MessageRow, max = 160): string {
  if (row.is_deleted === 1) return '(deleted)';
  const body = (row.body || '').replace(/\s+/g, ' ').trim();
  if (body) {
    return body.length <= max ? body : body.slice(0, max - 1) + '…';
  }
  if (row.has_media === 1) {
    const mime = row.media_mime_type || '';
    if (mime.startsWith('image/')) return mime === 'image/webp' ? '[sticker]' : '[image]';
    if (mime.startsWith('video/')) return '[video]';
    if (mime.startsWith('audio/')) return '[audio]';
    return '[media]';
  }
  if (row.message_type === 'location') {
    return row.location_name ? `[location: ${row.location_name}]` : '[location]';
  }
  if (row.message_type === 'poll' || row.poll_name) {
    return `[poll: ${row.poll_name || 'untitled'}]`;
  }
  return `[${row.message_type || 'message'}]`;
}

/**
 * Returns a friendly chat name for a JID. Falls back to the JID itself.
 * Order: chats.name → group.name → contact (name/notify_name/short_name) → jid.
 */
function chatNameFor(jid: string, chatCache: Map<string, ChatRow | undefined>): string {
  const cached = chatCache.get(jid);
  let chat: ChatRow | undefined;
  if (cached === undefined && !chatCache.has(jid)) {
    chat = chatsRepo.getByJid(jid);
    chatCache.set(jid, chat);
  } else {
    chat = cached;
  }
  if (chat?.name) return chat.name;
  if (jid.endsWith('@g.us')) {
    const g = groupsRepo.getByJid(jid);
    if (g?.name) return g.name;
    return jid;
  }
  const c = contactsRepo.getByJid(jid);
  if (c?.name) return c.name;
  if (c?.notify_name) return c.notify_name;
  if (c?.short_name) return c.short_name;
  return jid;
}

/** Returns a display name for a sender JID. push_name is used as a fallback. */
function senderNameFor(jid: string | undefined, pushName: string | undefined): string {
  if (!jid) return pushName || 'Unknown';
  const c = contactsRepo.getByJid(jid);
  if (c?.name) return c.name;
  if (c?.notify_name) return c.notify_name;
  if (c?.short_name) return c.short_name;
  if (pushName) return pushName;
  return jid;
}

/** Wraps resolveOne and turns failure into an errorResult-friendly summary. */
function resolveOrError(query: string, what: string, dmsOnly = false):
  | { ok: true; jid: string; name: string; is_group: boolean }
  | { ok: false; message: string } {
  const r = resolveOne(query, dmsOnly ? { dmsOnly: true } : {});
  if (r.ok) return r;
  const top = r.candidates.slice(0, 5).map((c) => `${c.name} <${c.jid}>`).join('; ');
  return {
    ok: false,
    message: top
      ? `${what} "${query}" — ${r.message} Top candidates: ${top}`
      : `${what} "${query}" — ${r.message}`,
  };
}

// ---------------------------------------------------------------------------
// 1. search_messages
// ---------------------------------------------------------------------------

const searchMessagesTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'search_messages',
      {
        title: 'Search messages',
        description:
          'Full-text search across the message archive. Returns snippets (not full bodies) ' +
          'so you can scan many hits cheaply. Optionally narrow by chat, sender, time range, ' +
          'or message type. Use this when you need to find specific content; use ' +
          '`get_conversation` to pull the surrounding context once you have a target message.',
        inputSchema: {
          query: z
            .string()
            .min(1)
            .describe('Free-text search term. Matched against message bodies.'),
          chat: z
            .string()
            .min(1)
            .optional()
            .describe('Name or JID to restrict the search to a single chat.'),
          from: z
            .string()
            .min(1)
            .optional()
            .describe('Sender name or JID to restrict to a single sender (DM-style match).'),
          after: z
            .string()
            .optional()
            .describe('ISO 8601 timestamp or unix (seconds or ms). Lower bound, exclusive.'),
          before: z
            .string()
            .optional()
            .describe('ISO 8601 timestamp or unix (seconds or ms). Upper bound, exclusive.'),
          types: z
            .array(z.string())
            .optional()
            .describe('Message types to include (e.g. ["text","image"]). Omit for all types.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(20)
            .optional()
            .describe('Maximum number of results. Default 20, max 100.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ query, chat, from, after, before, types, limit }) => {
        try {
          let remoteJid: string | undefined;
          if (chat) {
            const r = resolveOrError(chat, 'chat');
            if (!r.ok) return errorResult(r.message);
            remoteJid = r.jid;
          }

          let fromJid: string | undefined;
          if (from) {
            if (isJid(from)) {
              fromJid = from;
            } else {
              const r = resolveOrError(from, 'from', true);
              if (!r.ok) return errorResult(r.message);
              fromJid = r.jid;
            }
          }

          const afterSec = after !== undefined ? parseTimeToSeconds(after) : null;
          if (after !== undefined && afterSec === null) {
            return errorResult(`Could not parse "after" timestamp: ${after}`);
          }
          const beforeSec = before !== undefined ? parseTimeToSeconds(before) : null;
          if (before !== undefined && beforeSec === null) {
            return errorResult(`Could not parse "before" timestamp: ${before}`);
          }

          const finalLimit = limit ?? 20;
          // If we have exactly one type filter, push it down to the SQL; otherwise we
          // fetch a wider pool and filter in memory below.
          const singleType = types && types.length === 1 ? types[0] : undefined;
          const fetchLimit =
            types && types.length > 1 ? Math.min(500, finalLimit * 5) : finalLimit;

          const result = messagesRepo.query({
            search: query,
            remote_jid: remoteJid,
            from_jid: fromJid,
            message_type: singleType,
            after: afterSec ?? undefined,
            before: beforeSec ?? undefined,
            limit: fetchLimit,
            offset: 0,
            order: 'desc',
          });

          let rows = result.data;
          if (types && types.length > 1) {
            const set = new Set(types);
            rows = rows.filter((m) => m.message_type && set.has(m.message_type));
            rows = rows.slice(0, finalLimit);
          }

          const chatCache = new Map<string, ChatRow | undefined>();
          const results = rows.map((m) => {
            const senderJid = m.from_me === 1 ? undefined : (m.participant || m.from_jid);
            return {
              message_id: m.id,
              chat_name: chatNameFor(m.remote_jid, chatCache),
              chat_jid: m.remote_jid,
              sender_name: m.from_me === 1 ? 'Me' : senderNameFor(senderJid, m.push_name),
              sender_jid: senderJid ?? null,
              timestamp: m.timestamp,
              is_from_me: m.from_me === 1,
              snippet: buildSnippet(m),
              has_media: m.has_media === 1,
              message_type: m.message_type ?? 'unknown',
            };
          });

          return jsonResult({
            total: result.total,
            returned: results.length,
            results,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`search_messages failed: ${message}`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// 2. recent_activity
// ---------------------------------------------------------------------------

const recentActivityTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'recent_activity',
      {
        title: 'Recent activity',
        description:
          'Summarize what happened in WhatsApp over a flexible time window. Three modes: ' +
          '"summary" returns per-chat aggregates (counts, top senders, first/last gist); ' +
          '"firehose" returns a chronological message list capped at `limit`; "rendered" ' +
          'returns markdown for each chat via the conversation renderer. Filter by chats, ' +
          'group/DM, unread, and message type.',
        inputSchema: {
          window: z
            .enum(['today', 'yesterday', 'past_hour', 'past_24h', 'past_week'])
            .default('past_24h')
            .optional()
            .describe('Named time window. Overridden by `since`/`until` if provided.'),
          since: z
            .string()
            .optional()
            .describe('ISO 8601 or unix timestamp; overrides `window` if set.'),
          until: z
            .string()
            .optional()
            .describe('ISO 8601 or unix timestamp; defaults to now.'),
          chats: z
            .array(z.string())
            .optional()
            .describe('Names or JIDs to include. If set, only these chats are considered.'),
          exclude_chats: z
            .array(z.string())
            .optional()
            .describe('Names or JIDs to exclude from results.'),
          groups_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only group chats.'),
          dms_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only 1:1 (DM) chats.'),
          unread_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only chats with unread_count > 0.'),
          exclude_types: z
            .array(z.string())
            .optional()
            .describe('Message types to exclude. Defaults to ["reaction","poll_update"].'),
          min_messages: z
            .number()
            .int()
            .min(1)
            .default(1)
            .optional()
            .describe('Drop chats with fewer than this many messages in the window.'),
          mode: z
            .enum(['summary', 'firehose', 'rendered'])
            .default('summary')
            .optional()
            .describe('Output shape: per-chat summary, chronological firehose, or rendered markdown.'),
          timezone: z
            .string()
            .default('UTC')
            .optional()
            .describe('IANA timezone for today/yesterday boundaries and rendered output.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .default(50)
            .optional()
            .describe('Caps firehose results and rendered chat count. Default 50, max 500.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({
        window,
        since,
        until,
        chats,
        exclude_chats,
        groups_only,
        dms_only,
        unread_only,
        exclude_types,
        min_messages,
        mode,
        timezone,
        limit,
      }) => {
        if (groups_only && dms_only) {
          return errorResult('groups_only and dms_only are mutually exclusive');
        }
        try {
          const tz = (timezone && isValidTz(timezone)) ? timezone : 'UTC';
          const nowSec = Math.floor(Date.now() / 1000);

          let sinceSec: number;
          let untilSec: number = nowSec;

          if (until !== undefined) {
            const u = parseTimeToSeconds(until);
            if (u === null) return errorResult(`Could not parse "until": ${until}`);
            untilSec = u;
          }

          if (since !== undefined) {
            const s = parseTimeToSeconds(since);
            if (s === null) return errorResult(`Could not parse "since": ${since}`);
            sinceSec = s;
          } else {
            const w = window ?? 'past_24h';
            switch (w) {
              case 'past_hour':
                sinceSec = nowSec - SECONDS_PER_HOUR;
                break;
              case 'past_24h':
                sinceSec = nowSec - SECONDS_PER_DAY;
                break;
              case 'past_week':
                sinceSec = nowSec - 7 * SECONDS_PER_DAY;
                break;
              case 'today':
                sinceSec = startOfDayInTz(nowSec, tz, 0);
                break;
              case 'yesterday': {
                sinceSec = startOfDayInTz(nowSec, tz, -1);
                untilSec = startOfDayInTz(nowSec, tz, 0);
                break;
              }
              default:
                sinceSec = nowSec - SECONDS_PER_DAY;
            }
          }

          if (sinceSec >= untilSec) {
            return errorResult(`Empty time window: since (${sinceSec}) >= until (${untilSec})`);
          }

          // Resolve include/exclude chat lists.
          const includeJids = new Set<string>();
          if (chats && chats.length > 0) {
            for (const c of chats) {
              const r = resolveOrError(c, 'chats');
              if (!r.ok) return errorResult(r.message);
              includeJids.add(r.jid);
            }
          }
          const excludeJids = new Set<string>();
          if (exclude_chats && exclude_chats.length > 0) {
            for (const c of exclude_chats) {
              const r = resolveOrError(c, 'exclude_chats');
              if (!r.ok) return errorResult(r.message);
              excludeJids.add(r.jid);
            }
          }

          const excludeTypeSet = new Set(exclude_types ?? DEFAULT_EXCLUDE_TYPES);

          // Cap repo fetch to keep memory bounded.
          const FETCH_CAP = 5000;
          const result = messagesRepo.query({
            after: sinceSec,
            before: untilSec,
            limit: FETCH_CAP,
            order: 'desc',
          });
          const hasMore = result.total > FETCH_CAP;

          // First pass: drop excluded types and JID-include/exclude filters.
          const filtered = result.data.filter((m) => {
            if (m.message_type && excludeTypeSet.has(m.message_type)) return false;
            if (includeJids.size > 0 && !includeJids.has(m.remote_jid)) return false;
            if (excludeJids.has(m.remote_jid)) return false;
            return true;
          });

          // Group by chat.
          const byChat = new Map<string, MessageRow[]>();
          for (const m of filtered) {
            const arr = byChat.get(m.remote_jid) ?? [];
            arr.push(m);
            byChat.set(m.remote_jid, arr);
          }

          // Look up chat metadata once per JID.
          const chatRows = new Map<string, ChatRow | undefined>();
          for (const jid of byChat.keys()) {
            chatRows.set(jid, chatsRepo.getByJid(jid));
          }

          // Apply chat-level filters.
          const minMsgs = min_messages ?? 1;
          for (const [jid, msgs] of byChat) {
            const chat = chatRows.get(jid);
            const isGroup = chat?.is_group === 1 || jid.endsWith('@g.us');
            if (groups_only && !isGroup) {
              byChat.delete(jid);
              continue;
            }
            if (dms_only && isGroup) {
              byChat.delete(jid);
              continue;
            }
            if (unread_only && (chat?.unread_count ?? 0) <= 0) {
              byChat.delete(jid);
              continue;
            }
            if (msgs.length < minMsgs) {
              byChat.delete(jid);
              continue;
            }
          }

          const finalLimit = limit ?? 50;
          const windowMeta = { since: sinceSec, until: untilSec, mode: mode ?? 'summary' };

          // ----- summary mode -----
          if ((mode ?? 'summary') === 'summary') {
            const chatCache = new Map<string, ChatRow | undefined>(chatRows);
            const chatsOut = [...byChat.entries()].map(([jid, msgs]) => {
              const chat = chatRows.get(jid);
              const isGroup = chat?.is_group === 1 || jid.endsWith('@g.us');
              // Messages came in desc order; first message = oldest, last = newest.
              const sorted = [...msgs].sort((a, b) => a.timestamp - b.timestamp);
              const first = sorted[0];
              const last = sorted[sorted.length - 1];

              const senders = new Map<string, { name: string; jid: string; count: number }>();
              for (const m of sorted) {
                const sJid = m.from_me === 1 ? 'me' : (m.participant || m.from_jid || 'unknown');
                const entry = senders.get(sJid);
                if (entry) {
                  entry.count += 1;
                } else {
                  const name = m.from_me === 1
                    ? 'Me'
                    : senderNameFor(m.participant || m.from_jid, m.push_name);
                  senders.set(sJid, { name, jid: sJid, count: 1 });
                }
              }
              const topSenders = [...senders.values()]
                .sort((a, b) => b.count - a.count)
                .slice(0, 3);

              return {
                chat_name: chatNameFor(jid, chatCache),
                chat_jid: jid,
                is_group: isGroup,
                message_count: sorted.length,
                participants_count: senders.size,
                top_senders: topSenders,
                first_message_ts: first.timestamp,
                last_message_ts: last.timestamp,
                first_gist: buildSnippet(first, 80),
                last_gist: buildSnippet(last, 80),
              };
            });
            chatsOut.sort((a, b) => b.last_message_ts - a.last_message_ts);

            return jsonResult({
              window: windowMeta,
              chat_count: chatsOut.length,
              chats: chatsOut,
            });
          }

          // ----- firehose mode -----
          if (mode === 'firehose') {
            // Flatten all remaining messages, sort chronologically, cap.
            const all: MessageRow[] = [];
            for (const arr of byChat.values()) all.push(...arr);
            all.sort((a, b) => b.timestamp - a.timestamp);
            const capped = all.slice(0, finalLimit);

            const chatCache = new Map<string, ChatRow | undefined>(chatRows);
            const messages = capped.map((m) => {
              const senderJid = m.from_me === 1 ? undefined : (m.participant || m.from_jid);
              return {
                message_id: m.id,
                chat_name: chatNameFor(m.remote_jid, chatCache),
                chat_jid: m.remote_jid,
                timestamp: m.timestamp,
                sender_name: m.from_me === 1 ? 'Me' : senderNameFor(senderJid, m.push_name),
                snippet: buildSnippet(m),
                message_type: m.message_type ?? 'unknown',
                has_media: m.has_media === 1,
              };
            });

            return jsonResult({
              window: windowMeta,
              returned: messages.length,
              has_more: hasMore || all.length > finalLimit,
              messages,
            });
          }

          // ----- rendered mode -----
          const chatCache = new Map<string, ChatRow | undefined>(chatRows);
          const ordered = [...byChat.entries()]
            .map(([jid, msgs]) => ({
              jid,
              name: chatNameFor(jid, chatCache),
              msgs: [...msgs].sort((a, b) => a.timestamp - b.timestamp),
            }))
            .sort((a, b) => {
              const ta = a.msgs[a.msgs.length - 1]?.timestamp ?? 0;
              const tb = b.msgs[b.msgs.length - 1]?.timestamp ?? 0;
              return tb - ta;
            })
            .slice(0, finalLimit);

          const sections: string[] = [];
          for (const { name, msgs } of ordered) {
            const md = renderConversation(msgs, {
              timezone: tz,
              include_id: false,
              chat_label: name,
            });
            sections.push(md);
          }
          // renderConversation already produces a top-level heading for each chat
          // via `chat_label`; join with a blank line so consecutive sections breathe.
          return textResult(sections.join('\n\n---\n\n'));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`recent_activity failed: ${message}`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// 3. get_conversation
// ---------------------------------------------------------------------------

const getConversationTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'get_conversation',
      {
        title: 'Get conversation',
        description:
          'Fetch messages from a chat and render them as markdown. Either pull the last N ' +
          'messages or a time window centered on an anchor (a message ID or a timestamp). ' +
          'Output is the same compact, LLM-friendly format used by `/api/export`.',
        inputSchema: {
          chat: z
            .string()
            .min(1)
            .describe('Chat name or JID. Required.'),
          around_message_id: z
            .string()
            .optional()
            .describe('Center the window on this message; pair with `window_minutes`.'),
          around_timestamp: z
            .string()
            .optional()
            .describe('Center the window on this timestamp (ISO or unix); pair with `window_minutes`.'),
          last_n: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('Fetch the last N messages. Mutually exclusive with `around_*` anchors.'),
          window_minutes: z
            .number()
            .int()
            .min(1)
            .max(1440)
            .default(60)
            .optional()
            .describe('Span (in minutes) on either side of the anchor. Default 60, max 1440.'),
          timezone: z
            .string()
            .default('UTC')
            .optional()
            .describe('IANA timezone for date/time formatting.'),
          include_id: z
            .boolean()
            .default(false)
            .optional()
            .describe('Append `#message_id` to each line.'),
          include_reactions: z
            .boolean()
            .default(true)
            .optional()
            .describe('Attach reactions inline under each target message.'),
          include_quoted: z
            .boolean()
            .default(true)
            .optional()
            .describe('Show a preview of quoted messages above replies.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({
        chat,
        around_message_id,
        around_timestamp,
        last_n,
        window_minutes,
        timezone,
        include_id,
        include_reactions,
        include_quoted,
      }) => {
        try {
          const r = resolveOrError(chat, 'chat');
          if (!r.ok) return errorResult(r.message);
          const { jid: remoteJid, name: chatName } = r;

          const anchorProvided = around_message_id !== undefined || around_timestamp !== undefined;
          if (anchorProvided && last_n !== undefined) {
            return errorResult('Specify either last_n or an around_* anchor, not both.');
          }

          const tz = (timezone && isValidTz(timezone)) ? timezone : 'UTC';
          const renderOpts = {
            timezone: tz,
            include_id: include_id ?? false,
            include_reactions: include_reactions ?? true,
            include_quoted: include_quoted ?? true,
            chat_label: chatName,
          };

          let messages: MessageRow[];

          if (anchorProvided) {
            let anchorSec: number | null = null;
            if (around_message_id) {
              const anchor = messagesRepo.getById(around_message_id);
              if (!anchor) {
                return errorResult(`around_message_id not found: ${around_message_id}`);
              }
              anchorSec = anchor.timestamp;
            } else if (around_timestamp) {
              anchorSec = parseTimeToSeconds(around_timestamp);
              if (anchorSec === null) {
                return errorResult(`Could not parse around_timestamp: ${around_timestamp}`);
              }
            }
            if (anchorSec === null) {
              return errorResult('No usable anchor.');
            }
            const span = (window_minutes ?? 60) * 60;
            const q = messagesRepo.query({
              remote_jid: remoteJid,
              after: anchorSec - span - 1, // inclusive on lower bound
              before: anchorSec + span + 1, // inclusive on upper bound
              limit: 500,
              order: 'asc',
            });
            messages = q.data;
          } else {
            const n = last_n ?? 50;
            const q = messagesRepo.query({
              remote_jid: remoteJid,
              limit: n,
              order: 'desc',
            });
            // Repo returned newest first; render expects chronological.
            messages = q.data.slice().reverse();
          }

          if (messages.length === 0) {
            return textResult(`# ${chatName}\n\n_No messages found in the requested window._`);
          }

          const md = renderConversation(messages, renderOpts);
          return textResult(md);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`get_conversation failed: ${message}`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// 4. get_message
// ---------------------------------------------------------------------------

const getMessageTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'get_message',
      {
        title: 'Get message',
        description:
          'Fetch a single message by ID with full context: chat, sender, body, media, ' +
          'reactions, and the quoted message preview if any. Use this after `search_messages` ' +
          'or `get_thread` to inspect a specific row.',
        inputSchema: {
          message_id: z
            .string()
            .min(1)
            .describe('Message ID (the `id` column / `#xxxx` reference returned by other tools).'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ message_id }) => {
        try {
          const row = messagesRepo.getById(message_id);
          if (!row) {
            return errorResult(`Message not found: ${message_id}`);
          }

          const chatCache = new Map<string, ChatRow | undefined>();
          const chat = chatsRepo.getByJid(row.remote_jid);
          chatCache.set(row.remote_jid, chat);
          const isGroup = chat?.is_group === 1 || row.remote_jid.endsWith('@g.us');

          const senderJid = row.from_me === 1 ? undefined : (row.participant || row.from_jid);
          const senderName = row.from_me === 1
            ? 'Me'
            : senderNameFor(senderJid, row.push_name);

          // Quoted preview.
          let quoted: { message_id: string; sender_name: string; snippet: string } | null = null;
          if (row.quoted_id) {
            const q = messagesRepo.getById(row.quoted_id);
            if (q) {
              const qSenderJid = q.from_me === 1 ? undefined : (q.participant || q.from_jid);
              quoted = {
                message_id: q.id,
                sender_name: q.from_me === 1 ? 'Me' : senderNameFor(qSenderJid, q.push_name),
                snippet: buildSnippet(q, 100),
              };
            } else if (row.quoted_body) {
              // Fall back to the cached preview the quoting message captured.
              quoted = {
                message_id: row.quoted_id,
                sender_name: 'Unknown',
                snippet: row.quoted_body.length > 100
                  ? row.quoted_body.slice(0, 99) + '…'
                  : row.quoted_body,
              };
            }
          }

          // Reactions: fetch reaction rows targeting this id within a generous time window
          // (reactions arrive after the target). Filter in memory by reaction_target_id.
          // Bound by a ±30 day search so we don't scan everything.
          const reactionWindow = 30 * SECONDS_PER_DAY;
          const reactionsQ = messagesRepo.query({
            remote_jid: row.remote_jid,
            message_type: 'reaction',
            after: row.timestamp - 1,
            before: row.timestamp + reactionWindow,
            limit: 500,
            order: 'asc',
          });
          const matching = reactionsQ.data.filter((r) => r.reaction_target_id === row.id);
          const byEmoji = new Map<string, { from: { name: string; jid: string }[] }>();
          for (const r of matching) {
            if (!r.reaction_emoji) continue;
            const fromJid = r.from_me === 1 ? 'me' : (r.participant || r.from_jid || 'unknown');
            const name = r.from_me === 1 ? 'Me' : senderNameFor(r.participant || r.from_jid, r.push_name);
            const entry = byEmoji.get(r.reaction_emoji) ?? { from: [] };
            // De-dupe by jid in case multiple reaction rows survived for the same reactor.
            if (!entry.from.find((f) => f.jid === fromJid)) {
              entry.from.push({ name, jid: fromJid });
            }
            byEmoji.set(r.reaction_emoji, entry);
          }
          const reactions = [...byEmoji.entries()].map(([emoji, v]) => ({
            emoji,
            count: v.from.length,
            from: v.from,
          }));

          const media = row.has_media === 1
            ? {
                media_id: row.media_id ?? null,
                kind: row.message_type ?? null,
                mime_type: row.media_mime_type ?? null,
                filename: row.media_filename ?? null,
                size_bytes: row.media_size ?? null,
              }
            : null;

          return jsonResult({
            message_id: row.id,
            chat_name: chatNameFor(row.remote_jid, chatCache),
            chat_jid: row.remote_jid,
            is_group: isGroup,
            sender_name: senderName,
            sender_jid: senderJid ?? null,
            timestamp: row.timestamp,
            is_from_me: row.from_me === 1,
            message_type: row.message_type ?? 'unknown',
            body: row.body ?? null,
            has_media: row.has_media === 1,
            media,
            quoted,
            reactions,
            is_edited: (row.edit_type ?? 0) !== 0,
            is_forwarded: row.is_forwarded === 1,
            is_starred: row.is_starred === 1,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`get_message failed: ${message}`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// 5. get_thread
// ---------------------------------------------------------------------------

const getThreadTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'get_thread',
      {
        title: 'Get thread',
        description:
          'Walk the quote chain backward from a message, following `quoted_id` up to `depth` ' +
          'levels. Returns the chain rendered as markdown with message IDs included. ' +
          'NOTE: forward-walking (finding replies to a message) is not currently supported ' +
          'by the repo layer, so the chain is root-only.',
        inputSchema: {
          message_id: z
            .string()
            .min(1)
            .describe('Starting message ID. The walk follows `quoted_id` pointers.'),
          depth: z
            .number()
            .int()
            .min(1)
            .max(20)
            .default(5)
            .optional()
            .describe('Maximum number of hops to follow. Default 5, max 20.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ message_id, depth }) => {
        try {
          const start = messagesRepo.getById(message_id);
          if (!start) {
            return errorResult(`Message not found: ${message_id}`);
          }

          const maxDepth = depth ?? 5;
          const chain: MessageRow[] = [start];
          const seen = new Set<string>([start.id]);

          // Walk backward through quoted_id pointers. The messages repo does not
          // expose a `quoted_id` filter, so forward-walking (replies-to) would
          // require a direct DB query; we skip it here to keep the tool clean.
          let cursor: MessageRow | undefined = start;
          for (let i = 0; i < maxDepth; i++) {
            if (!cursor || !cursor.quoted_id) break;
            if (seen.has(cursor.quoted_id)) break;
            const parent = messagesRepo.getById(cursor.quoted_id);
            if (!parent) break;
            chain.push(parent);
            seen.add(parent.id);
            cursor = parent;
          }

          // Render in chronological order (root → leaf).
          chain.sort((a, b) => a.timestamp - b.timestamp);

          const chatCache = new Map<string, ChatRow | undefined>();
          const chatLabel = chatNameFor(start.remote_jid, chatCache);

          const md = renderConversation(chain, {
            include_id: true,
            include_reactions: true,
            include_quoted: true,
            chat_label: chatLabel,
          });
          return textResult(md);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`get_thread failed: ${message}`);
        }
      },
    );
  },
};

export const searchTools: McpTool[] = [
  searchMessagesTool,
  recentActivityTool,
  getConversationTool,
  getMessageTool,
  getThreadTool,
];
