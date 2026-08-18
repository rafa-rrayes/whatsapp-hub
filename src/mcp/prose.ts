/**
 * The prose dialect — how WhatsApp is written down for a model to read.
 *
 * Most of this server's tools answer with `jsonResult(...)`: raw JIDs, unix
 * timestamps, nested objects. A model reads a chat log far better than it reads
 * a list of objects, and the punctuation costs a fraction of the tokens the
 * braces would. This module is the shared vocabulary for the tools that answer
 * in prose instead, so the format is one thing that can be tuned in one place
 * rather than each tool inventing its own.
 *
 * Three rules carry it:
 *
 * 1. **Identity is always resolved.** `5511999999999@s.whatsapp.net` never
 *    reaches model-visible text — it is both a privacy leak and a token spent
 *    on noise. When no name exists at all, {@link maskJid} is the escape hatch:
 *    enough of the identifier to tell two chats apart, not enough to dial.
 *    JIDs stay in `structuredContent`, where programmatic clients need them.
 *
 * 2. **Timestamps are local time and always carry their date**, as
 *    `MM-DD HH:MM`. Local because the model is reasoning about the user's day,
 *    not the server's; always-dated because a message line gets quoted out of
 *    its transcript constantly — into a search hit, into the inbox, into the
 *    model's own notes — and a bare `09:14` is worthless the moment it leaves
 *    the block it was rendered in. Eleven characters is a cheap price for a stamp
 *    that survives being copied. The year is added only when the timestamp is
 *    not from the current year, which for live conversation is never.
 *
 * 3. **Every truncation states the exact call that continues it**, arguments
 *    filled in, so a model never has to work out our pagination for itself.
 *    That is {@link continuation}; `truncated: true` tells a model something is
 *    missing but not how to get it, which is the worse half of the answer.
 *
 * Nothing here touches the database or the repositories — these are pure
 * functions over values the caller has already loaded. Timestamps arrive as
 * **unix seconds**, which is how this codebase stores them (`MessageRow.timestamp`,
 * `ChatRow.last_message_ts`).
 */

/** Preview length on an inbox/candidate line. Long enough to recognise a thread. */
export const PREVIEW_CHARS = 80;

/** Separator between the bits of a one-line chat summary. */
const SEP = ' · ';

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

interface StampParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function stampParts(date: Date, timezone: string): StampParts {
  // formatToParts rather than a format string: it is the only way to get the
  // fields out without depending on how a locale happens to order them.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const out: StampParts = { year: '', month: '', day: '', hour: '', minute: '' };
  for (const p of parts) {
    if (p.type === 'year') out.year = p.value;
    else if (p.type === 'month') out.month = p.value;
    else if (p.type === 'day') out.day = p.value;
    else if (p.type === 'hour') out.hour = p.value;
    else if (p.type === 'minute') out.minute = p.value;
  }
  return out;
}

/**
 * A unix-seconds timestamp as `MM-DD HH:MM` in `timezone`, 24-hour.
 *
 * Gains a `YYYY-` prefix when the timestamp falls in a different year than
 * *now* does in the same zone — the reader of a dated line should never have to
 * assume which year it means. An unknown zone falls back to UTC rather than
 * throwing: a rendering detail must not be able to fail a tool call.
 */
export function formatStamp(tsSec: number, timezone = 'UTC'): string {
  const tz = isValidTz(timezone) ? timezone : 'UTC';
  const t = stampParts(new Date(tsSec * 1000), tz);
  const currentYear = stampParts(new Date(), tz).year;
  const stamp = `${t.month}-${t.day} ${t.hour}:${t.minute}`;
  return t.year === currentYear ? stamp : `${t.year}-${stamp}`;
}

/**
 * Compact age for an inbox line: `just now`, `5m`, `3h`, `4d`, `2w`.
 *
 * Coarse on purpose — the reader wants recency, not precision, and this appears
 * once per line where every character is paid for fifteen times over. Days run
 * to a fortnight before switching to weeks because `9d` says more than `1w`
 * does; past two weeks the exact day stopped mattering. A timestamp in the
 * future (clock skew between the phone and the hub is routine) reads as
 * `just now` rather than as a negative age.
 */
export function relativeAge(tsSec: number, nowSec = Date.now() / 1000): string {
  const seconds = nowSec - tsSec;
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/**
 * A message body as a single line, ellipsized at `max`.
 *
 * Every whitespace run — newlines included — collapses to one space, so the
 * line count of a rendered block equals the message count and a model can
 * reason about "the third message" safely. A body that wrapped would make that
 * arithmetic silently wrong. The result is never longer than `max`: the `…`
 * takes the last character rather than being added past the limit.
 */
export function truncateBody(body: string | undefined, max = PREVIEW_CHARS): string {
  const flat = (body ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Last-resort label for a chat with no name anywhere: `…9999 (DM)`.
 *
 * Four digits distinguish the chats in front of the model without handing it a
 * dialable number, and the kind tells it what it is looking at. This is the
 * escape hatch for the identity rule, not a way around it — a caller that has a
 * resolved name must use the name.
 */
export function maskJid(jid: string): string {
  const at = jid.indexOf('@');
  const user = at === -1 ? jid : jid.slice(0, at);
  const domain = at === -1 ? '' : jid.slice(at + 1);

  let kind = 'chat';
  if (domain === 'g.us') kind = 'group';
  else if (domain === 's.whatsapp.net' || domain === 'lid') kind = 'DM';
  else if (domain === 'broadcast') kind = 'broadcast';

  const digits = user.replace(/\D/g, '');
  // A user part with no digits in it (`status@broadcast`) is a well-known label,
  // not an identity; there is nothing there to protect by hiding half of it.
  if (!digits) return user ? `${user} (${kind})` : `unknown (${kind})`;
  return `…${digits.slice(-4)} (${kind})`;
}

/**
 * Is this "name" actually a JID wearing a name's clothes?
 *
 * Several layers below this one fall back to `name: row.name || row.jid` when
 * nothing resolves, and the sync path writes whatever Baileys hands it into
 * `chats.name`. So a caller can hold a perfectly well-formed `name` that is a
 * raw identifier, and rule 1 would be defeated by a function that trusted it.
 * Cheaper to check here, once, than to rely on every call site remembering.
 */
const JID_SHAPE = /^[\w.-]+@(?:s\.whatsapp\.net|g\.us|lid|c\.us|broadcast)$/;

export function looksLikeJid(value: string): boolean {
  return JID_SHAPE.test(value.trim());
}

/** The shape a chat line needs. Structural on purpose: this module imports nothing. */
export interface ChatLineInput {
  name?: string;
  jid: string;
  is_group?: boolean;
  unread_count?: number;
  last_message_ts?: number | null;
  last_message_preview?: string;
}

export interface ChatLineOptions {
  /** Reference point for the age bit, unix seconds. Defaults to now. */
  now_sec?: number;
  /** Preview budget in characters. */
  preview_chars?: number;
}

/**
 * One chat on one line, for an inbox screen or a candidate list.
 *
 * `Família · group · 3 unread · 2h · vc vem jantar hoje?`
 *
 * The bits are ordered by how a reader skimming fifteen of these uses them:
 * who it is, then whether it wants something, then how stale, then what it
 * actually said. Bits that carry no information are dropped rather than
 * rendered empty — `0 unread` is a line of noise fifteen times over, and `dm`
 * is redundant next to a chat named after one person. A chat we have no name
 * for gets a masked JID, never the raw one.
 */
export function renderChatLine(chat: ChatLineInput, opts: ChatLineOptions = {}): string {
  const supplied = chat.name?.trim();
  // A supplied name that is really a JID is treated as no name at all —
  // otherwise rule 1 holds only as long as every caller upstream remembers it.
  const name = supplied && !looksLikeJid(supplied) ? supplied : undefined;
  const label = name || maskJid(chat.jid || supplied || '');

  const bits: string[] = [label];

  // The masked label already ends in `(group)`; saying it twice reads as
  // '…4821 (group) · group'.
  if (chat.is_group && name && !label.toLowerCase().includes('group')) bits.push('group');

  if (chat.unread_count && chat.unread_count > 0) bits.push(`${chat.unread_count} unread`);

  if (chat.last_message_ts) bits.push(relativeAge(chat.last_message_ts, opts.now_sec));
  else bits.push('no messages');

  const preview = truncateBody(chat.last_message_preview, opts.preview_chars ?? PREVIEW_CHARS);
  if (preview) bits.push(preview);

  return bits.join(SEP);
}

export type ContinuationArgs = Record<string, string | number | boolean | undefined>;

/**
 * The literal next call to make, arguments filled in:
 * `get_conversation(chat="Família", last_n=50)`.
 *
 * Copy-pasteable is the whole point — a model that is told 40 messages were
 * dropped still has to guess the tool, the argument names and the cursor value
 * unless we write them down. `undefined` arguments are skipped so a caller can
 * pass its optional parameters through without composing the string itself.
 */
export function continuation(tool: string, args: ContinuationArgs = {}): string {
  const rendered: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    if (typeof value === 'string') {
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      rendered.push(`${key}="${escaped}"`);
    } else {
      rendered.push(`${key}=${value}`);
    }
  }
  return `${tool}(${rendered.join(', ')})`;
}
