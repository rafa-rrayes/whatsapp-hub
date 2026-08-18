import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { proseResult, errorResult } from '../types.js';
import { resolveCandidates, type ResolveCandidate } from '../resolve.js';
import { renderChatLine, relativeAge, formatStamp, maskJid, continuation } from '../prose.js';
import { messagesRepo } from '../../database/repositories/messages.js';
import { chatsRepo, type ChatRow } from '../../database/repositories/chats.js';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { groupsRepo } from '../../database/repositories/groups.js';

/**
 * The three navigation tools — the ones a model calls before it knows anything.
 *
 * All three answer in prose (see `src/mcp/prose.ts` for the dialect) with the
 * object they have always returned carried through untouched in
 * `structuredContent`. Two different readers, two different halves: a model gets
 * a written list it can skim, a programmatic client gets every field it ever
 * had, JIDs included. Nothing below may put a JID in the prose half — it is a
 * privacy leak and a token spent on noise, and {@link maskJid} exists for the
 * chats that have no name to print instead.
 *
 * These are also the tools with the most say over what a model does next, so
 * every one of them ends by naming the call that continues the thread: a
 * listing that stops at 30 of 72 chats says how to ask for the other 42, and a
 * screen that reports three unread chats says what to call to read them.
 */

/** Message timestamps are stored as unix seconds (see schema usage of unixepoch). */
const SECONDS_PER_DAY = 86400;

/** What `get_conversation` reads by default; quoted in the follow-up calls below. */
const READ_LAST_N = 50;

/**
 * The `structuredContent` preview, byte for byte as it has always been.
 *
 * Nearly `prose.ts`'s `truncateBody`, and deliberately not replaced by it: the
 * two differ by a trailing space before the ellipsis, and that difference would
 * show up in the field programmatic clients already read. Prose truncates with
 * `truncateBody`, structure truncates with this.
 */
function truncatePreview(body: string | undefined, max = 80): string {
  if (!body) return '';
  const trimmed = body.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + '…';
}

/** `1 chat` / `12 chats`, for prose that has to agree with its own numbers. */
function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The JID domains this hub ever sees. A "name" carrying one is not a name. */
const JID_DOMAIN = /@(?:s\.whatsapp\.net|g\.us|lid|broadcast)/i;

/**
 * The name to print for a chat, or `undefined` when there genuinely isn't one.
 *
 * Every layer under this file falls back to the JID when a chat has no name —
 * `chatsRepo` rows arrive with `name` empty and both `resolveCandidates` and the
 * overview's own scoring write `name: row.name || row.jid`. That fallback is
 * right for `structuredContent` and fatal for prose, where it is precisely the
 * leak we are here to stop. Handing `undefined` back instead lets
 * {@link renderChatLine} mask the JID, which is the only spelling of an
 * unnamed chat a model should ever see.
 */
function displayName(name: string | undefined, jid: string): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === jid || JID_DOMAIN.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * A caller's own search term, quoted back into the prose.
 *
 * Both of these tools open by repeating what was asked — `"maria" is one chat:`
 * — and a JID is a perfectly legal thing to ask with, so the echo is a way for
 * one to walk straight back into the model's context. Masking it keeps the head
 * honest about which chat was meant while keeping the rule intact, and the mask
 * needs no quotes: `…4821 (DM) is one chat:` already reads as an identity.
 */
function echoTerm(value: string): string {
  return JID_DOMAIN.test(value) ? maskJid(value) : `"${value}"`;
}

/** How many entries on a listing share each name. The basis of every two-Marias call below. */
function nameFrequencies(names: Array<string | undefined>): Map<string, number> {
  const freq = new Map<string, number>();
  for (const name of names) {
    if (!name) continue;
    const key = name.toLowerCase();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return freq;
}

/**
 * The first name on a listing that means exactly one chat.
 *
 * Every one of these tools ends by showing a worked call —
 * `get_conversation(chat="Ana", last_n=50)` — and the name in it has to be one
 * the resolver will accept. Quoting a name two chats answer to produces an
 * ambiguity error, which is a poor thing to hand a model that trusted the
 * example, and an actively misleading one on a screen listing both Marias.
 */
function firstUnambiguous(
  names: Array<string | undefined>,
  freq: Map<string, number>,
): string | undefined {
  return names.find((name) => name !== undefined && freq.get(name.toLowerCase()) === 1);
}

const overviewTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'whatsapp_overview',
      {
        title: 'WhatsApp overview',
        description:
          'High-level dashboard of the WhatsApp data: totals across chats, contacts, ' +
          'groups, and messages, plus recent activity within a configurable window and ' +
          'the most active chats. Call this first to orient yourself before drilling in.',
        inputSchema: {
          days: z
            .number()
            .int()
            .min(1)
            .max(90)
            .default(7)
            .optional()
            .describe('Window size in days for "recent" stats. Default 7, max 90.'),
          timezone: z
            .string()
            .default('UTC')
            .optional()
            .describe('IANA timezone (e.g. "America/Sao_Paulo") used for the last-activity timestamp. Defaults to UTC.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ days, timezone }) => {
        try {
          const windowDays = days ?? 7;
          const nowSec = Math.floor(Date.now() / 1000);
          const afterSec = nowSec - windowDays * SECONDS_PER_DAY;

          const stats = messagesRepo.getStats();
          const totalContacts = contactsRepo.getCount();
          const totalGroups = groupsRepo.getCount();

          // Pull a generous slice of recent chats — getAll sorts by last_message_ts DESC.
          const recentChats = chatsRepo.getAll({ limit: 200 });
          const totalChats = recentChats.length === 200
            ? // Total chat count isn't directly exposed; if we hit our cap, fall back to the
              // distinct remote_jid count from the stats byChat list — best-effort.
              Math.max(recentChats.length, stats.byChat.length)
            : recentChats.length;

          const unreadChatCount = recentChats.filter((c) => (c.unread_count ?? 0) > 0).length;

          // messages_in_window: a single aggregate query via repo.query with limit:1 so we
          // get the `total` without hauling rows around.
          const windowQuery = messagesRepo.query({ after: afterSec, limit: 1 });
          const messagesInWindow = windowQuery.total;

          // top_active_chats: walk the most recently active chats and count their messages
          // within the window. Cap the candidate pool so we don't fan out N+1 across every
          // chat in the DB.
          const candidateChats = recentChats.slice(0, 50);
          const scored: Array<{
            name: string;
            jid: string;
            is_group: boolean;
            message_count_in_window: number;
            last_message_ts: number | null;
          }> = [];
          // The rows behind the scored entries, kept aside for the prose half:
          // an entry carries no unread count and its `name` has already been
          // collapsed onto the JID, neither of which a rendered line wants.
          const rowByJid = new Map<string, ChatRow>();
          for (const c of candidateChats) {
            const q = messagesRepo.query({
              remote_jid: c.jid,
              after: afterSec,
              limit: 1,
            });
            if (q.total === 0) continue;
            rowByJid.set(c.jid, c);
            scored.push({
              name: c.name || c.jid,
              jid: c.jid,
              is_group: c.is_group === 1,
              message_count_in_window: q.total,
              last_message_ts: c.last_message_ts ?? null,
            });
          }
          scored.sort((a, b) => b.message_count_in_window - a.message_count_in_window);
          const topActiveChats = scored.slice(0, 5);

          const lastActivityTs = recentChats.length > 0
            ? (recentChats[0].last_message_ts ?? null)
            : null;

          const structured = {
            total_chats: totalChats,
            total_messages: stats.total,
            total_contacts: totalContacts,
            total_groups: totalGroups,
            messages_in_window: messagesInWindow,
            window_days: windowDays,
            unread_chat_count: unreadChatCount,
            top_active_chats: topActiveChats,
            last_activity_ts: lastActivityTs,
          };

          const tz = timezone ?? 'UTC';
          const blocks: string[] = [];

          if (totalChats === 0 && stats.total === 0) {
            // Nothing to orient by, and no read call would change that: an empty
            // mirror is a connection or a sync problem, not a navigation one.
            blocks.push(
              'No WhatsApp data has been mirrored yet — no chats and no messages. ' +
              'The hub may still be connecting, or no history has been synced.',
            );
            return proseResult(blocks.join('\n'), structured);
          }

          // The paragraph: what exists, then what has happened lately. The
          // totals are the whole reason a model calls this before anything else.
          const sentences = [
            [
              count(totalChats, 'chat'),
              count(stats.total, 'message'),
              count(totalContacts, 'contact'),
              count(totalGroups, 'group'),
            ].join(' · ') + '.',
            `Last ${windowDays === 1 ? 'day' : `${windowDays} days`}: ` +
            `${count(messagesInWindow, 'message')}, ` +
            (unreadChatCount > 0
              ? `${count(unreadChatCount, 'chat')} with something unread.`
              : 'nothing unread.'),
          ];
          if (lastActivityTs) {
            sentences.push(
              `Last activity ${formatStamp(lastActivityTs, tz)} (${relativeAge(lastActivityTs, nowSec)}).`,
            );
          }
          blocks.push(sentences.join(' '));

          if (topActiveChats.length > 0) {
            const lines = topActiveChats.map((t) => {
              const row = rowByJid.get(t.jid);
              // renderChatLine's slots are name/kind/unread/age; the window count
              // is this screen's own column and is appended with the dialect's
              // separator rather than smuggled into one of them.
              const line = renderChatLine(
                {
                  name: displayName(t.name, t.jid),
                  jid: t.jid,
                  is_group: t.is_group,
                  unread_count: row?.unread_count,
                  last_message_ts: t.last_message_ts,
                },
                { now_sec: nowSec },
              );
              return `  ${line} · ${count(t.message_count_in_window, 'message')}`;
            });
            blocks.push(
              [`Busiest in the last ${windowDays === 1 ? 'day' : `${windowDays} days`}:`, ...lines].join('\n'),
            );
          } else {
            blocks.push(`Nothing arrived in the last ${windowDays === 1 ? 'day' : `${windowDays} days`}.`);
          }

          // Where to go next. Unread first when there is any, because that is the
          // question a model usually opened this screen to answer.
          const next: string[] = [];
          if (unreadChatCount > 0) {
            next.push(
              `Triage what is unread: ${continuation('list_chats', { unread_only: true, limit: 30 })}`,
            );
          } else {
            next.push(`Browse the chats: ${continuation('list_chats', { limit: 30 })}`);
          }
          // Only offer a named chat to read: `get_conversation` resolves a name,
          // and a masked stand-in like `…4821 (DM)` would resolve to nothing.
          // Uniqueness is judged across the lines above, which is what the model
          // can see; a clash with some chat further down is the resolver's to
          // report, not this line's to pre-empt.
          const busiestNames = topActiveChats.map((t) => displayName(t.name, t.jid));
          const busiestName = firstUnambiguous(busiestNames, nameFrequencies(busiestNames));
          if (busiestName) {
            next.push(
              `Read one: ${continuation('get_conversation', { chat: busiestName, last_n: READ_LAST_N })}`,
            );
          }
          blocks.push(next.join('\n'));

          return proseResult(blocks.join('\n\n'), structured);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`whatsapp_overview failed: ${message}`);
        }
      },
    );
  },
};

/**
 * The candidate list, which is the whole product of `resolve_contact`.
 *
 * Disambiguation is the job, so each line has to carry enough for a model to
 * pick correctly without a second call: who it is, whether other people are
 * watching, how recently it moved, and the last thing said in it. What decides
 * between two chats called "Maria" is none of those, though — it is the
 * identity behind the name, which is exactly the thing prose may not print. The
 * masked form is the answer, and it is only spent on the lines that need it:
 * a name shared with another candidate gets `…4821 (DM)` beside it, and since
 * `resolve_contact` already matches on a phone-number substring, those four
 * digits are not just a label but a query that resolves.
 */
function renderCandidates(query: string, candidates: ResolveCandidate[], nowSec: number): string {
  const asked = echoTerm(query);
  if (candidates.length === 0) {
    return (
      `Nothing matched ${asked}. Try fewer words or part of a phone number, ` +
      `or ${continuation('list_chats', { limit: 30 })} to see what exists.`
    );
  }

  const names = candidates.map((c) => displayName(c.name, c.jid));
  const freq = nameFrequencies(names);
  const isShared = (i: number): boolean => {
    const name = names[i];
    return name !== undefined && (freq.get(name.toLowerCase()) ?? 0) > 1;
  };
  let collided = false;
  const lines = candidates.map((c, i) => {
    const shared = isShared(i);
    const name = names[i];
    if (shared) collided = true;
    return renderChatLine(
      {
        // The masked id is joined with the dialect's own separator so it reads
        // as another field of the line rather than as part of the name.
        name: shared ? `${name} · ${maskJid(c.jid)}` : name,
        jid: c.jid,
        is_group: c.is_group,
        unread_count: c.unread_count,
        last_message_ts: c.last_message_ts ?? null,
        last_message_preview: c.last_message_preview,
      },
      { now_sec: nowSec },
    );
  });

  const head = candidates.length === 1
    ? `${asked} is one chat:`
    : `${count(candidates.length, 'match', 'matches')} for ${asked}, best first:`;

  const tail: string[] = [];
  const example = firstUnambiguous(names, freq);
  if (example) {
    tail.push(
      (candidates.length === 1
        ? 'Read it: '
        : 'Any tool that takes a chat takes one of these names, e.g. ') +
      continuation('get_conversation', { chat: example, last_n: READ_LAST_N }),
    );
  } else if (!collided) {
    // Nothing here has a name, so the masked digits are the only handle — and
    // they are a working one: a digit query matches the phone number and the
    // JID alike, which is what resolved these candidates in the first place.
    tail.push(
      'No name is on record for these — the four digits shown address them: ' +
      continuation('get_conversation', { chat: '…', last_n: READ_LAST_N }),
    );
  }
  if (collided) {
    tail.push(
      'Where two lines share a name, pass the four digits shown instead — they ' +
      `resolve on their own: ${continuation('get_conversation', { chat: '…', last_n: READ_LAST_N })}`,
    );
  }

  return [head, ...lines, ...tail].join('\n');
}

const resolveContactTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'resolve_contact',
      {
        title: 'Resolve contact or chat',
        description:
          'Fuzzy lookup that maps a free-text query (name, partial name, phone number, ' +
          'or JID) to a ranked list of contacts, groups, and chats. Use this to translate ' +
          'a human-friendly reference like "Mom" or "dev group" into a JID before calling ' +
          'tools that require one.',
        inputSchema: {
          query: z
            .string()
            .min(1)
            .describe('Name, partial name, phone number, or JID to look up.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(30)
            .default(10)
            .optional()
            .describe('Maximum number of candidates to return. Default 10, max 30.'),
          groups_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only group chats are considered.'),
          dms_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only 1:1 (DM) chats are considered.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ query, limit, groups_only, dms_only }) => {
        if (groups_only && dms_only) {
          return errorResult('groups_only and dms_only are mutually exclusive');
        }
        try {
          const candidates = resolveCandidates(query, {
            groupsOnly: groups_only ?? false,
            dmsOnly: dms_only ?? false,
            limit: limit ?? 10,
          });
          const nowSec = Math.floor(Date.now() / 1000);
          return proseResult(renderCandidates(query, candidates, nowSec), { query, candidates });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`resolve_contact failed: ${message}`);
        }
      },
    );
  },
};

/** The `limit` input's ceiling (mirrors `.max(200)` on the schema below). */
const LIST_LIMIT_MAX = 200;

/**
 * How many rows `list_chats` pulls before filtering. The filters run in memory,
 * so the pool has to be wider than `limit` for them to have anything to cut;
 * 5x is a reasonable balance, floored at 200 and capped at 1000 to avoid
 * pathological scans. Raising `limit` widens the pool too, which is why a
 * bigger-limit call is a deeper scan and not just a longer listing.
 */
function poolSize(limit: number): number {
  return Math.min(1000, Math.max(limit * 5, 200));
}

const listChatsTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'list_chats',
      {
        title: 'List chats',
        description:
          'Browse chats with optional filters: unread-only, groups/DMs, name substring, ' +
          'active within N days. Results are sorted by most recent activity. Useful when ' +
          'you want to see which conversations exist without searching messages.',
        inputSchema: {
          unread_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only return chats with unread_count > 0.'),
          groups_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only return group chats.'),
          dms_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only return 1:1 (DM) chats.'),
          name_contains: z
            .string()
            .min(1)
            .optional()
            .describe('Case-insensitive substring filter on the chat name or JID.'),
          active_since_days: z
            .number()
            .int()
            .min(1)
            .max(365)
            .optional()
            .describe('Only return chats whose last message is within the last N days.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .default(30)
            .optional()
            .describe('Maximum number of chats to return. Default 30, max 200.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({
        unread_only,
        groups_only,
        dms_only,
        name_contains,
        active_since_days,
        limit,
      }) => {
        if (groups_only && dms_only) {
          return errorResult('groups_only and dms_only are mutually exclusive');
        }
        try {
          const finalLimit = limit ?? 30;

          // Pull a larger pool than `limit` so in-memory filters still surface enough hits.
          const fetchLimit = poolSize(finalLimit);
          const rows: ChatRow[] = chatsRepo.getAll({
            search: name_contains,
            limit: fetchLimit,
          });

          const nowSec = Math.floor(Date.now() / 1000);
          const activeSinceSec = active_since_days
            ? nowSec - active_since_days * SECONDS_PER_DAY
            : null;

          const filtered = rows.filter((r) => {
            if (unread_only && (r.unread_count ?? 0) <= 0) return false;
            if (groups_only && r.is_group !== 1) return false;
            if (dms_only && r.is_group === 1) return false;
            if (activeSinceSec !== null && (r.last_message_ts ?? 0) < activeSinceSec) return false;
            return true;
          });

          filtered.sort((a, b) => (b.last_message_ts ?? 0) - (a.last_message_ts ?? 0));

          const shown = filtered.slice(0, finalLimit);
          const chats = shown.map((r) => ({
            name: r.name || r.jid,
            jid: r.jid,
            is_group: r.is_group === 1,
            unread_count: r.unread_count ?? 0,
            last_message_ts: r.last_message_ts ?? null,
            last_message_preview: truncatePreview(r.last_message_body),
          }));

          // The filters, spelled the way they were passed, so a follow-up call
          // carries them forward instead of silently widening the listing. The
          // `|| undefined` drops the falsey ones: `continuation` skips undefined,
          // and `unread_only=false` is a word a model has to read for nothing.
          const filterArgs = {
            unread_only: unread_only || undefined,
            groups_only: groups_only || undefined,
            dms_only: dms_only || undefined,
            name_contains,
            active_since_days,
          };

          // A noun phrase for the head that says what was actually asked for —
          // "3 unread group chats" tells a model why the other 40 are missing,
          // where a bare "3 chats" invites it to conclude there are only three.
          const prefix = unread_only ? 'unread ' : '';
          const suffix = [
            // `name_contains` matches the JID as well as the name, so a model may
            // well have passed one; the head has to mask what it repeats back.
            // The continuation calls below do *not* mask it — a sanitised filter
            // would be a call that returns something else.
            name_contains ? ` matching ${echoTerm(name_contains)}` : '',
            active_since_days
              ? ` active in the last ${active_since_days === 1 ? 'day' : `${active_since_days} days`}`
              : '',
          ].join('');
          const phrase = (n: number): string =>
            prefix +
            (groups_only
              ? n === 1 ? 'group chat' : 'group chats'
              : dms_only
                ? n === 1 ? 'DM' : 'DMs'
                : n === 1 ? 'chat' : 'chats') +
            suffix;

          const filtersApplied =
            Boolean(unread_only || groups_only || dms_only || name_contains || active_since_days);

          // The filters ran over `fetchLimit` rows, not over every chat. When the
          // pool came back full, chats past it were never looked at, so every
          // count below is a floor — say so. A cap that reads as completeness is
          // worse than an obvious truncation: it stops the model from asking again.
          const poolSaturated = rows.length >= fetchLimit;
          // Raising `limit` widens the pool as well, so it is a real next step —
          // until the pool is already at its own ceiling, where the only way
          // forward is a narrower question.
          const canScanDeeper = poolSize(LIST_LIMIT_MAX) > fetchLimit;
          const narrower = `narrow it: ${continuation('list_chats', { ...filterArgs, name_contains: '…' })}`;
          const deeper = `${continuation('list_chats', { ...filterArgs, limit: LIST_LIMIT_MAX })}`;

          if (filtered.length === 0) {
            if (!filtersApplied) {
              return proseResult('No chats have been mirrored yet.', {
                total: filtered.length,
                chats,
              });
            }
            const text = poolSaturated
              ? `No ${phrase(0)} among the ${fetchLimit} most recently active chats, which is as far as this looked. ` +
                (canScanDeeper ? `Look further: ${deeper}` : `Or ${narrower}`)
              : `No ${phrase(0)}. Widen it: ${continuation('list_chats', { limit: finalLimit })}`;
            return proseResult(text, { total: filtered.length, chats });
          }

          const lines = shown.map((r) =>
            renderChatLine(
              {
                name: displayName(r.name, r.jid),
                jid: r.jid,
                is_group: r.is_group === 1,
                unread_count: r.unread_count,
                last_message_ts: r.last_message_ts ?? null,
                // The raw body, not `truncatePreview`'s copy: the prose half
                // does its own truncating, to its own budget.
                last_message_preview: r.last_message_body,
              },
              { now_sec: nowSec },
            ),
          );

          // "At least 200 chats" and "200 chats" have to be different sentences,
          // or a model cannot tell "these are all of them" from "these are the
          // first N of an unknown number".
          const head = poolSaturated
            ? `At least ${filtered.length} ${phrase(filtered.length)}, newest first:`
            : `${filtered.length} ${phrase(filtered.length)}, newest first:`;
          const parts = [head, ...lines];

          if (poolSaturated) {
            parts.push(
              `Only the ${fetchLimit} most recently active chats were scanned, ` +
              `so ${filtered.length} is a floor, not a total.`,
            );
          }

          const more = filtered.length - shown.length;
          if (more > 0) {
            // `list_chats` has no cursor, so the call that continues it is the
            // same call with a bigger limit — until the limit is the ceiling,
            // at which point the only way forward is a narrower question.
            // A saturated pool asks for the ceiling rather than for `filtered.length`:
            // that call both shows the rest and looks further than this one could.
            const nextLimit = poolSaturated
              ? LIST_LIMIT_MAX
              : Math.min(LIST_LIMIT_MAX, filtered.length);
            const atLeast = poolSaturated ? 'at least ' : '';
            parts.push(
              nextLimit > finalLimit
                ? `… ${atLeast}${count(more, 'more chat')} · ${continuation('list_chats', { ...filterArgs, limit: nextLimit })}`
                : `… ${atLeast}${count(more, 'more chat')} — ${narrower}`,
            );
          } else if (poolSaturated) {
            // Nothing was truncated, so nothing above hints that anything is
            // missing — but the pool still cut the search short.
            parts.push(canScanDeeper ? `Look further: ${deeper}` : `To see past it, ${narrower}`);
          }

          const shownNames = shown.map((r) => displayName(r.name, r.jid));
          const example = firstUnambiguous(shownNames, nameFrequencies(shownNames));
          if (example) {
            parts.push(
              `Read one: ${continuation('get_conversation', { chat: example, last_n: READ_LAST_N })} ` +
              '— the name is the first field on each line.',
            );
          }

          return proseResult(parts.join('\n'), { total: filtered.length, chats });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`list_chats failed: ${message}`);
        }
      },
    );
  },
};

export const orientationTools: McpTool[] = [overviewTool, resolveContactTool, listChatsTool];
