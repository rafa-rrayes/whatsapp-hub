import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { proseResult, errorResult } from '../types.js';
import { chatsRepo, type ChatRow } from '../../database/repositories/chats.js';
import { messagesRepo, type MessageRow } from '../../database/repositories/messages.js';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { groupsRepo } from '../../database/repositories/groups.js';
import { continuation, formatStamp, maskJid, renderChatLine, PREVIEW_CHARS } from '../prose.js';

/**
 * The triage screen.
 *
 * `whatsapp_overview` answers "how much data is there" — totals, and the chats
 * that carry the most volume. Nothing here answered **"what needs me right
 * now"**, which is the first question an agent waking up has, and the one it
 * was previously forced to reconstruct out of `list_chats(unread_only=true)`
 * plus a guess about what the JIDs meant. This is that screen: the chats with
 * unread messages, who from, how many, the last line, how long ago.
 *
 * It answers in prose (see `src/mcp/prose.ts` for the dialect) with the full
 * objects retained in `structuredContent`, and it ends with the literal call
 * that opens the top chat. A model shown five unread chats and not told how to
 * read one has been handed half an answer.
 */

/** PFC's numbers, and they hold up: fifteen lines is a screen, fifty is a wall. */
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

/**
 * How many chat rows to scan for unread ones.
 *
 * `chats` has no `unread_count` index and the repository has no unread-only
 * query, so the filter happens in memory over the most-recently-active slice —
 * the same shape `list_chats` uses, at the same ceiling. The cost is one query
 * rather than one per chat; the exposure is that an unread chat whose last
 * message is older than the thousandth most recent chat would not be seen. On a
 * real account that is a chat nobody has spoken in for years, and it is the
 * trade every other listing tool here already makes.
 */
const CANDIDATE_POOL = 1000;

/** A chat row with its display name resolved once, for both halves of the reply. */
interface LabeledChat {
  row: ChatRow;
  /** The resolved name, or undefined when nothing anywhere names this chat. */
  name?: string;
  /** Who wrote the last line, when naming them adds something. */
  sender?: string;
}

/**
 * Kept honest deliberately: printing the zone the caller *asked* for next to a
 * stamp that silently fell back to UTC would be worse than printing no zone at
 * all. `formatStamp` does its own fallback; this tells us which one it took.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * The best name we have for a chat: the chat's own, then the group's, then the
 * contact's. Returns undefined rather than the JID when there is none — the
 * caller decides what to show for a nameless chat, and the answer is never the
 * JID itself.
 *
 * One indexed primary-key lookup per *rendered* chat, so at most `2 × limit` of
 * them, never one per row in the scanned pool. At inbox size that is cheaper
 * than the join it would take to avoid.
 */
function resolveChatName(chat: ChatRow): string | undefined {
  const own = chat.name?.trim();
  if (own) return own;

  if (chat.is_group === 1) {
    const group = groupsRepo.getByJid(chat.jid);
    const groupName = group?.name?.trim();
    if (groupName) return groupName;
  }

  const contact = contactsRepo.getByJid(chat.jid);
  return (
    contact?.name?.trim() ||
    contact?.notify_name?.trim() ||
    contact?.short_name?.trim() ||
    undefined
  );
}

/**
 * The message the chat's stored preview came from, or undefined if we do not
 * have it.
 *
 * One index seek per *rendered* row on `idx_messages_remote_ts(remote_jid,
 * timestamp)` — never one per row in the scanned pool. The timestamp equality is
 * the point rather than a nicety: the chat row and the message row are written
 * from the same event with the same `messageTimestamp`, so a mismatch means the
 * messages table does not hold the message this preview came from (a partial
 * sync, history that was never backfilled). Attributing the sender of some
 * *other* message to this line would be worse than not attributing it at all.
 */
function previewMessage(chat: ChatRow): MessageRow | undefined {
  if (!chat.last_message_ts) return undefined;
  const { data } = messagesRepo.query({ remote_jid: chat.jid, limit: 1, order: 'desc' });
  const newest = data[0];
  return newest && newest.timestamp === chat.last_message_ts ? newest : undefined;
}

/**
 * Who spoke, as a prefix on the preview — or undefined when the prefix would
 * carry no information.
 *
 * PFC's rule, and it holds: in a DM the sender *is* the chat, so naming them
 * again spends a word a line to say what the line already said. Two cases do
 * have to be said. In a group, "who from" is the whole question and the chat
 * name does not answer it. And an outgoing message must be marked in either
 * kind — `Ana Costa · 5h · ok, mando o arquivo amanhã` reads as Ana speaking
 * when it was the user, and a triaging agent that gets that backwards will
 * answer a message it sent itself. PFC calls that case `you`; so do we.
 *
 * A sender we cannot name is masked, never printed: the no-raw-JID rule covers
 * senders exactly as it covers chats.
 */
function senderPrefix(msg: MessageRow, isGroup: boolean): string | undefined {
  if (msg.from_me === 1) return 'you';
  if (!isGroup) return undefined;

  // `from_jid` is the LID-resolved phone JID and `participant` is whatever the
  // wire carried; the ingest path keys contacts by the resolved one
  // (`src/events/handler.ts`), so that is the one that hits the contacts table.
  const jid = msg.from_jid || msg.participant;
  if (jid) {
    const contact = contactsRepo.getByJid(jid);
    const saved =
      contact?.name?.trim() || contact?.notify_name?.trim() || contact?.short_name?.trim();
    if (saved) return saved;
  }

  // The display name WhatsApp attached to the message itself. Not a saved
  // contact, but it is what the phone shows, and it beats four digits.
  const pushName = msg.push_name?.trim();
  if (pushName) return pushName;

  // `maskJid` ends its label with the kind of *chat* a JID belongs to, which is
  // right on a chat line and wrong on a sender — a group participant is not a
  // "DM". The four digits are the part that tells two strangers apart; the
  // parenthetical is dropped rather than reprinted as a lie.
  return jid ? maskJid(jid).replace(/\s*\([^)]*\)$/, '') : undefined;
}

function label(chat: ChatRow): LabeledChat {
  // No preview body means nothing to attribute, and the message lookup can be
  // skipped entirely — a chat whose last message was a photo costs nothing here.
  const preview = chat.last_message_body ? previewMessage(chat) : undefined;
  return {
    row: chat,
    name: resolveChatName(chat),
    sender: preview ? senderPrefix(preview, chat.is_group === 1) : undefined,
  };
}

function line(chat: LabeledChat, nowSec: number): string {
  const prefix = chat.sender ? `${chat.sender}: ` : '';
  return renderChatLine(
    {
      name: chat.name,
      jid: chat.row.jid,
      is_group: chat.row.is_group === 1,
      unread_count: chat.row.unread_count ?? 0,
      last_message_ts: chat.row.last_message_ts ?? null,
      last_message_preview: chat.row.last_message_body
        ? prefix + chat.row.last_message_body
        : chat.row.last_message_body,
    },
    // The attribution rides on top of the preview budget rather than eating into
    // it, so a long name costs the sender's own characters and not the message's.
    { now_sec: nowSec, preview_chars: PREVIEW_CHARS + prefix.length },
  );
}

/** The programmatic view: everything the prose dropped, JIDs included. */
function structuredChat(chat: LabeledChat) {
  return {
    name: chat.name ?? null,
    jid: chat.row.jid,
    is_group: chat.row.is_group === 1,
    unread_count: chat.row.unread_count ?? 0,
    last_message_ts: chat.row.last_message_ts ?? null,
    last_message_preview: chat.row.last_message_body ?? null,
    // Kept as its own field rather than folded into the preview: the prose
    // half is what needs the two glued together, not a programmatic client.
    last_message_sender: chat.sender ?? null,
  };
}

const inboxTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'whatsapp_inbox',
      {
        title: 'WhatsApp inbox',
        description:
          'One screen of what needs you right now: the chats with unread messages, who ' +
          'they are from, how many, the last line and how long ago. Reach for this first ' +
          'whenever you want to know whether anything is waiting — it is the cheapest ' +
          'call here. Use it instead of `whatsapp_overview`, which counts how much data ' +
          'exists rather than what is outstanding, and instead of `list_chats`, which ' +
          'browses every chat under filters and hands back identifiers rather than a ' +
          'triage order. It shows one preview line per chat, not the messages themselves: ' +
          'for the actual text of a conversation, follow it with `get_conversation`.',
        inputSchema: {
          limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(MAX_LIMIT)
            .default(DEFAULT_LIMIT)
            .optional()
            .describe(
              `How many chats to list per section. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
            ),
          include_read: z
            .boolean()
            .default(false)
            .optional()
            .describe(
              'Also list recently active chats with nothing unread, after the unread ' +
                'ones. Off by default; when nothing at all is unread they are shown ' +
                'regardless, because "nothing unread" on its own is not an answer.',
            ),
          timezone: z
            .string()
            .default('UTC')
            .optional()
            .describe(
              'IANA timezone (e.g. "America/Sao_Paulo") for the "as of" stamp the ages ' +
                'are measured from. Defaults to UTC.',
            ),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ limit, include_read, timezone }) => {
        try {
          // `.default()` under `.optional()` never fires on an absent argument,
          // which is why every tool in this server re-applies its default here.
          const finalLimit = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
          const includeRead = include_read ?? false;
          const requestedTz = timezone ?? 'UTC';
          const tz = isValidTimezone(requestedTz) ? requestedTz : 'UTC';

          // One instant for the whole screen: the header stamp and every age on
          // it are measured from the same point, so they cannot disagree.
          const nowSec = Math.floor(Date.now() / 1000);
          const stamp = formatStamp(nowSec, tz);

          // `getAll` already orders by last_message_ts DESC (NULLs last), which
          // is the order the inbox wants — newest first.
          const pool = chatsRepo.getAll({ limit: CANDIDATE_POOL });

          const unreadRows = pool.filter((c) => (c.unread_count ?? 0) > 0);
          // Every unread chat is excluded from "recently active", not just the
          // ones that fitted — otherwise the overflow past `limit` would be
          // listed under a heading that says it has nothing unread.
          const readRows = pool.filter((c) => (c.unread_count ?? 0) <= 0 && c.last_message_ts);

          // A chat nobody has ever spoken in is not news. PFC's inbox has the
          // same rule, and without it a fresh sync shows a page of empty rows.
          const anyMessages = pool.some((c) => c.last_message_ts);

          if (!anyMessages) {
            const text =
              pool.length === 0
                ? 'No chats in the local mirror yet. If the hub has only just connected, ' +
                  'history is still syncing; `whatsapp_overview()` will say how much has landed.'
                : 'Chats exist but none of them has a message in it yet — history is still ' +
                  'syncing. `whatsapp_overview()` will say how much has landed.';
            return proseResult(text, {
              unread_chat_count: 0,
              unread: [],
              recent: [],
              include_read: includeRead,
              limit: finalLimit,
              timezone: tz,
              generated_at: nowSec,
              next_call: null,
            });
          }

          const unread = unreadRows.slice(0, finalLimit).map(label);
          // Nothing unread falls back to the recent list whether or not it was
          // asked for. "Nothing unread." alone is technically an answer and
          // practically a dead end.
          const showRecent = includeRead || unreadRows.length === 0;
          const recent = showRecent ? readRows.slice(0, finalLimit).map(label) : [];

          // A heading and the rows it heads are one block; the blank lines that
          // join the blocks are the only structure this screen needs.
          const blocks: string[] = [];
          const section = (heading: string, rows: LabeledChat[]) =>
            [heading, ...rows.map((c) => line(c, nowSec))].join('\n');

          if (unread.length > 0) {
            const noun = unreadRows.length === 1 ? 'chat' : 'chats';
            const shown =
              unreadRows.length > unread.length ? `, ${unread.length} newest shown` : '';
            blocks.push(
              section(
                `${unreadRows.length} ${noun} with unread messages${shown}. ` +
                  `Ages are measured from ${stamp} (${tz}).`,
                unread,
              ),
            );
            if (recent.length > 0) blocks.push(section('Recently active, nothing unread:', recent));
          } else {
            blocks.push(
              "Nothing unread — though that count is the phone's own and resets there the " +
                'moment a chat is opened, so a quiet inbox is not proof that nothing happened.',
            );
            blocks.push(
              section(`Most recent chats. Ages are measured from ${stamp} (${tz}).`, recent),
            );
          }

          // The next call, literally. Nameless chats are skipped when picking the
          // target: `get_conversation(chat="…4821 (DM)")` resolves to nothing, and
          // a continuation that does not run is worse than none at all.
          const unreadTarget = unread.find((c) => c.name);
          const target = unreadTarget ?? recent.find((c) => c.name);
          const nextCall = target
            ? continuation('get_conversation', { chat: target.name, last_n: 50 })
            : continuation('list_chats', {
                unread_only: unread.length > 0,
                limit: finalLimit,
              });

          if (!target) {
            blocks.push(
              `No chat here has a name to address it by — ${nextCall} returns their identifiers.`,
            );
          } else if (unreadTarget) {
            // The other half of triage. `mark_read` takes a JID and nothing else,
            // and a JID is the one thing that may not appear here, so the lookup
            // that gets one is spelled out rather than hand-waved. The warning is
            // repeated from the tool's own description on purpose: a continuation
            // line is read on its own, and this one fires a signal at a human.
            blocks.push(
              `Read one: ${nextCall}\n` +
                `Then clear it: ${continuation('resolve_contact', { query: unreadTarget.name })} ` +
                'for its JID, then `mark_read(jid=…)`. That sends real blue ticks to real ' +
                'people and cannot be undone, so only once you have actually read it.',
            );
          } else {
            blocks.push(`Read one: ${nextCall}`);
          }

          return proseResult(blocks.join('\n\n'), {
            unread_chat_count: unreadRows.length,
            unread: unread.map(structuredChat),
            recent: recent.map(structuredChat),
            include_read: includeRead,
            limit: finalLimit,
            timezone: tz,
            generated_at: nowSec,
            next_call: nextCall,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`whatsapp_inbox failed: ${message}`);
        }
      },
    );
  },
};

export const inboxTools: McpTool[] = [inboxTool];
