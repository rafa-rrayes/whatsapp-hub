import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { jsonResult, textResult, errorResult, proseResult } from '../types.js';
import { resolveOne, isJid } from '../resolve.js';
import { renderConversation } from '../render.js';
import { formatStamp, truncateBody, maskJid, continuation } from '../prose.js';
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
  const transcript = (row.media_transcription || '').replace(/\s+/g, ' ').trim();
  if (transcript) {
    return transcript.length <= max ? transcript : transcript.slice(0, max - 1) + '…';
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
// Rendering search hits as prose (see src/mcp/prose.ts for the dialect)
// ---------------------------------------------------------------------------

/**
 * How much of a hit's body reaches the model. Deliberately the same cap
 * `buildSnippet` applies, so the prose and the `structuredContent` snippet are
 * the same text rather than two different truncations of it. A hit is the
 * answer to the question, not a preview of one, which is why it gets twice the
 * `PREVIEW_CHARS` an inbox line is allowed.
 */
const HIT_CHARS = 160;

/**
 * Default character ceiling on a rendered transcript.
 *
 * `get_conversation` defaulted to `last_n: 50` and no cap at all, so fifty
 * messages in a chat where people paste logs could return a wall that pushes
 * everything else out of a model's context — and the caller had no way to know
 * it was coming. PFC's number, and it holds up: roughly a screenful of real
 * conversation, raisable per call when a caller genuinely wants more.
 */
const TRANSCRIPT_BUDGET = 6000;

/** A JID anywhere inside text, as opposed to one we were handed as a field. */
const JID_IN_TEXT = /[\w.-]+@(?:s\.whatsapp\.net|g\.us|lid|c\.us|broadcast)/g;

/** The same shape, anchored — "is this whole string a JID?" */
const JID_SHAPE = /^[\w.-]+@(?:s\.whatsapp\.net|g\.us|lid|c\.us|broadcast)$/;

/**
 * The dialect's first rule, applied to text that came out of the database.
 *
 * The rule exists to stop *the archive* handing a model identifiers it never
 * had, so the boundary it guards is the one every stored string crosses: a
 * message body quoting a number, a chat named after one. Field-level masking
 * cannot see those — a JID inside a body is not a field, it is prose.
 *
 * What deliberately does *not* pass through here is the caller's own `query`.
 * It typed that string; echoing it back leaks nothing it did not already have,
 * and masking it would break the very thing the continuation rule exists to
 * guarantee — a model handed `search_messages(query="…9999 (DM)")` runs it and
 * gets nothing back. Scrub what we fetched; echo what we were told.
 */
function scrubJids(text: string): string {
  return text.replace(JID_IN_TEXT, (jid) => maskJid(jid));
}

/**
 * A name we can show, or a masked stand-in when the "name" we were handed is
 * really a JID.
 *
 * `chatNameFor` and `senderNameFor` both fall back to returning the JID when
 * nothing resolves, and that fallback is exactly the string that must not reach
 * the model. Callers of this function get four digits and a kind instead —
 * enough to tell two unnamed chats apart, not enough to dial. A name that
 * merely *contains* a JID is scrubbed rather than replaced: the rest of it is
 * still the best label we have.
 */
function safeLabel(name: string | undefined, jid: string | undefined): string {
  if (name && !JID_SHAPE.test(name)) return scrubJids(name);
  const fallback = jid ?? name;
  return fallback ? maskJid(fallback) : 'unknown';
}

/** One row of `search_messages`'s `results` — the shape the tool already builds. */
interface SearchHit {
  message_id: string;
  chat_name: string;
  chat_jid: string;
  sender_name: string;
  sender_jid: string | null;
  timestamp: number;
  is_from_me: boolean;
  snippet: string;
  has_media: boolean;
  message_type: string;
}

interface HitGroup {
  label: string;
  is_group: boolean;
  /** False when `label` is a masked JID — such a chat cannot be named back to us. */
  named: boolean;
  hits: SearchHit[];
}

interface RenderHitsOptions {
  /** Echoed verbatim so the model can see what it actually asked for. */
  query: string;
  /** `result.total` — every row matching the filters, not just the returned page. */
  total: number;
  /** IANA zone for the stamps. Invalid zones fall back to UTC inside `formatStamp`. */
  timezone: string;
  /** Resolved name of the `chat` filter, when one was given. */
  chat_label?: string;
  /** The other narrowing clauses, already worded: `from Ana`, `after 06-01 09:00`. */
  filters: string[];
  /** The literal call that returns the matches this page left behind. */
  more_call?: string;
}

/** `[06-15 12:00] Ana: o boleto chegou hoje  `3EB0C767`` */
function renderHitLine(hit: SearchHit, timezone: string, indent: boolean): string {
  const sender = hit.is_from_me ? 'Me' : safeLabel(hit.sender_name, hit.sender_jid ?? undefined);
  const body = scrubJids(truncateBody(hit.snippet, HIT_CHARS));
  // The id is the only thing on the line a model can pass back to us, and
  // `get_conversation(around_message_id=…)` is this tool's documented next
  // step — a hit without one is a dead end. It trails the line, in backticks,
  // the way `renderConversation(include_id: true)` already writes ids.
  return `${indent ? '  ' : ''}[${formatStamp(hit.timestamp, timezone)}] ${sender}: ${body}  \`${hit.message_id}\``;
}

/**
 * Matches as a chat log, grouped by chat, newest first.
 *
 * Twenty hits scattered over four chats read as four short transcripts far
 * better than as a flat list that renames its chat every other line, so hits
 * are collected per chat and each chat appears once. Order is still recency:
 * the groups come in the order their newest hit did, and hits inside a group
 * stay newest-first. When every hit is in one chat the chat is named in the
 * header instead and the group heading is dropped — one line saved on the
 * single most common search there is.
 *
 * Nothing here queries the database: `hits` is what the tool already loaded.
 */
function renderSearchHits(hits: SearchHit[], o: RenderHitsOptions): string {
  const groups = new Map<string, HitGroup>();
  for (const hit of hits) {
    let group = groups.get(hit.chat_jid);
    if (!group) {
      const named = Boolean(hit.chat_name) && !JID_SHAPE.test(hit.chat_name);
      group = {
        label: safeLabel(hit.chat_name, hit.chat_jid),
        is_group: hit.chat_jid.endsWith('@g.us'),
        named,
        hits: [],
      };
      groups.set(hit.chat_jid, group);
    }
    group.hits.push(hit);
  }
  const list = [...groups.values()];

  // A chat filter names the chat even when it matched nothing; a single group
  // names itself. Both end up in the same "in X" clause.
  const only = o.chat_label ?? (list.length === 1 ? list[0].label : undefined);
  const scope = [...(only ? [`in ${only}`] : []), ...o.filters].join(' ');
  const where = scope ? ` ${scope}` : '';

  if (hits.length === 0) {
    return [
      `Nothing${where} matches "${o.query}".`,
      'Try fewer words or a different spelling, or list_chats() to see what has history.',
    ].join('\n');
  }

  const count = hits.length === 1 ? '1 match' : `${hits.length} matches`;
  const spread = list.length > 1 ? ` across ${list.length} chats` : '';
  const order = hits.length === 1 ? '' : ', newest first';
  const lines: string[] = [`${count} for "${o.query}"${where}${spread}${order}:`, ''];

  const grouped = list.length > 1;
  for (const group of list) {
    if (grouped) lines.push(group.is_group ? `${group.label} · group` : group.label);
    for (const hit of group.hits) lines.push(renderHitLine(hit, o.timezone, grouped));
    lines.push('');
  }

  const more = Math.max(o.total - hits.length, 0);
  if (more > 0) {
    const matches = more === 1 ? 'match' : 'matches';
    lines.push(
      o.more_call
        ? `… ${more} more ${matches} · ${o.more_call}`
        : `… ${more} more ${matches} — narrow by chat, sender or time range to reach them.`,
    );
  }

  // A masked chat cannot be passed back as a `chat` argument, so the example
  // borrows the first chat we do have a name for and falls back to a placeholder.
  const readable = list.find((g) => g.named)?.label ?? '…';
  lines.push(
    `Read any of these in context with ` +
      `${continuation('get_conversation', { chat: readable, around_message_id: '…' })}` +
      ` — the id is the last thing on each hit line.`,
  );

  // No blanket pass over the finished text: every label and body above is
  // already scrubbed at the point it came out of the database, and the header
  // and the continuation echo the caller's query as it typed it.
  return lines.join('\n');
}

/**
 * Splices a `types` filter into a rendered continuation call.
 *
 * `continuation()` has no vocabulary for array arguments, and silently dropping
 * a filter from a call we are *telling* a model to make would hand it back a
 * different search than the one it ran.
 */
function withTypes(call: string, types?: string[]): string {
  if (!types || types.length === 0 || call.endsWith('()')) return call;
  return `${call.slice(0, -1)}, types=[${types.map((t) => JSON.stringify(t)).join(', ')}])`;
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
          'Full-text search across the message archive. Answers with the matching lines ' +
          'grouped by chat, newest first — snippets rather than full bodies, so you can scan ' +
          'many hits cheaply. Each hit ends with its message id. Optionally narrow by chat, ' +
          'sender, time range, or message type. Use this when you need to find specific ' +
          'content; use `get_conversation` with that id to pull the surrounding context.',
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
          timezone: z
            .string()
            .default('UTC')
            .optional()
            .describe('IANA timezone (e.g. "America/Sao_Paulo") used for the timestamps on each hit. Defaults to UTC.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ query, chat, from, after, before, types, limit, timezone }) => {
        try {
          let remoteJid: string | undefined;
          let chatLabel: string | undefined;
          if (chat) {
            const r = resolveOrError(chat, 'chat');
            if (!r.ok) return errorResult(r.message);
            remoteJid = r.jid;
            chatLabel = safeLabel(r.name, r.jid);
          }

          let fromJid: string | undefined;
          let fromLabel: string | undefined;
          if (from) {
            if (isJid(from)) {
              fromJid = from;
              fromLabel = safeLabel(senderNameFor(from, undefined), from);
            } else {
              const r = resolveOrError(from, 'from', true);
              if (!r.ok) return errorResult(r.message);
              fromJid = r.jid;
              fromLabel = safeLabel(r.name, r.jid);
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

          // The type filter goes down to SQLite whether there is one of them or
          // five. It used to be applied in memory over a wider fetch, which cost
          // two things worth naming: `total` was the *unfiltered* count, and
          // anything past the 500-row pool was silently dropped. The count is
          // load-bearing now — it is rendered as "… N more matches" followed by
          // the call that fetches them — so it has to be the count of what the
          // caller actually asked for.
          const result = messagesRepo.query({
            search: query,
            remote_jid: remoteJid,
            from_jid: fromJid,
            message_types: types,
            after: afterSec ?? undefined,
            before: beforeSec ?? undefined,
            limit: finalLimit,
            offset: 0,
            order: 'desc',
          });

          const rows = result.data;

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

          // Unchanged, field for field, from what this tool has always returned:
          // programmatic clients read `structuredContent` and must see no
          // difference. Only the model-facing half below becomes prose.
          const structured = {
            total: result.total,
            returned: results.length,
            results,
          };

          const tz = timezone ?? 'UTC';

          // What the caller could not fit on this page, and the call that
          // fetches it. A bigger `limit` is the cheapest way there while there
          // is headroom; once the page is already 100 rows wide there is no
          // pagination left to offer and narrowing is the only honest advice.
          const more = Math.max(result.total - results.length, 0);
          const nextLimit = Math.min(100, result.total);
          const moreCall =
            more > 0 && nextLimit > finalLimit
              ? withTypes(
                  continuation('search_messages', {
                    query, chat, from, after, before, limit: nextLimit, timezone,
                  }),
                  types,
                )
              : undefined;

          const filters: string[] = [];
          if (fromLabel) filters.push(`from ${fromLabel}`);
          if (afterSec !== null) filters.push(`after ${formatStamp(afterSec, tz)}`);
          if (beforeSec !== null) filters.push(`before ${formatStamp(beforeSec, tz)}`);
          if (types && types.length > 0) filters.push(`of type ${types.join('/')}`);

          const prose = renderSearchHits(results, {
            query,
            total: result.total,
            timezone: tz,
            chat_label: chatLabel,
            filters,
            more_call: moreCall,
          });

          return proseResult(prose, structured);
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
          max_chars: z.coerce
            .number()
            .int()
            .min(500)
            .max(200_000)
            .optional()
            .describe(
              `Character ceiling on the transcript. Default ${TRANSCRIPT_BUDGET}. The oldest ` +
                'messages are dropped first and a note says how many; the newest message is ' +
                'always kept whole. Raise it to read further back in one call.',
            ),
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
        max_chars,
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
          const budget = max_chars ?? TRANSCRIPT_BUDGET;

          // The way out of a truncated transcript is a bigger ceiling, so the
          // hint asks for one — doubled, because a caller told "raise it" and
          // left to guess by how much will guess too small and come back twice.
          // A chat we have no name for is skipped rather than quoted back as a
          // masked label: `get_conversation(chat="…4821 (group)")` resolves to
          // nothing, and an instruction that does not run is worse than the
          // renderer's generic advice.
          const named = chatName && !JID_SHAPE.test(chatName) ? chatName : undefined;
          const truncationHint = named
            ? continuation('get_conversation', {
                chat: named,
                last_n,
                max_chars: Math.min(budget * 2, 200_000),
              })
            : undefined;

          const renderOpts = {
            timezone: tz,
            include_id: include_id ?? false,
            include_reactions: include_reactions ?? true,
            include_quoted: include_quoted ?? true,
            chat_label: chatName,
            budget,
            truncation_hint: truncationHint,
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
                transcription: row.media_transcription ?? null,
                transcription_status: row.media_transcription_status ?? null,
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
