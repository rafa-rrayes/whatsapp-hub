import { buildNameResolver } from '../export/name-resolver.js';
import type { MessageRow } from '../database/repositories/messages.js';
import type { ExportOptions } from '../export/types.js';

export interface RenderOptions {
  timezone?: string;
  include_id?: boolean;
  include_reactions?: boolean;
  include_quoted?: boolean;
  me_alias?: string;
  chat_label?: string;
  /** Optional prefix line — e.g., the chat JID — placed under the title. */
  subtitle?: string;
  /**
   * Maximum characters of rendered output. Omitted, `undefined` or `<= 0` means
   * unlimited, and the output is then byte-identical to the pre-budget renderer.
   *
   * The budget bounds how much *history* comes back, never whether the newest
   * message arrives intact: messages are dropped oldest-first, and a single
   * message larger than the whole budget still renders in full. The transcript
   * is never emptied to satisfy the budget.
   */
  budget?: number;
  /**
   * A literal follow-up call supplied by the caller — e.g.
   * `get_conversation(chat="Família", last_n=100)`. Quoted verbatim in the
   * truncation note so the model knows how to reach the dropped history. The
   * tool layer knows its own name and arguments; the renderer does not, and
   * must never invent one.
   */
  truncation_hint?: string;
}

const DEFAULTS = {
  timezone: 'UTC',
  include_id: false,
  include_reactions: true,
  include_quoted: true,
  me_alias: 'Me',
};

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function mediaTag(msg: MessageRow): string | null {
  if (msg.has_media !== 1) return null;
  const mime = msg.media_mime_type || '';
  const filename = msg.media_filename;
  let kind = 'media';
  if (mime.startsWith('image/')) kind = mime === 'image/webp' ? 'sticker' : 'image';
  else if (mime.startsWith('video/')) kind = 'video';
  else if (mime.startsWith('audio/')) kind = 'audio';
  else if (mime) kind = 'document';
  return filename ? `[${kind}: ${filename}]` : `[${kind}]`;
}

/** Inline AI transcription (audio) / description (image), if present. */
function transcriptionTag(msg: MessageRow): string | null {
  const t = msg.media_transcription?.replace(/\r?\n/g, ' ').trim();
  if (!t) return null;
  const label = (msg.media_mime_type || '').startsWith('audio/') ? 'transcript' : 'description';
  return `_(${label}: ${t})_`;
}

interface AttachedReaction {
  emoji: string;
  from_jid?: string;
  from_me: boolean;
}

function collectReactions(messages: MessageRow[]): Map<string, AttachedReaction[]> {
  const map = new Map<string, AttachedReaction[]>();
  for (const m of messages) {
    if (m.message_type !== 'reaction' || !m.reaction_target_id || !m.reaction_emoji) continue;
    const arr = map.get(m.reaction_target_id) ?? [];
    arr.push({
      emoji: m.reaction_emoji,
      from_jid: m.participant || m.from_jid,
      from_me: m.from_me === 1,
    });
    map.set(m.reaction_target_id, arr);
  }
  return map;
}

/**
 * One rendered message: the quoted-reply line, the message line, the reactions
 * line and the trailing blank line all belong to the same message and are kept
 * together. The `## date` header is *not* part of the block — it is emitted at
 * assembly time so that trimming from the front can drop a now-orphaned header
 * and give the first surviving message a header of its own.
 */
interface MessageBlock {
  /** `YYYY-MM-DD` group key. */
  date: string;
  lines: string[];
}

/**
 * Cost of a group of lines once joined with `\n`. Counts one newline per line,
 * which over-counts the final join by exactly one character — budget checks are
 * therefore conservative by a character, never optimistic.
 */
function linesCost(lines: string[]): number {
  let n = 0;
  for (const l of lines) n += l.length + 1;
  return n;
}

function dateHeaderLines(date: string): string[] {
  return [`## ${date}`, ''];
}

/** Assembles the final markdown, inserting a `## date` header on every change. */
function assemble(prefix: string[], blocks: MessageBlock[]): string {
  const lines = [...prefix];
  let lastDate = '';
  for (const b of blocks) {
    if (b.date !== lastDate) {
      lines.push(...dateHeaderLines(b.date));
      lastDate = b.date;
    }
    lines.push(...b.lines);
  }
  return lines.join('\n');
}

/**
 * The note shown when history was dropped. A bare "truncated: true" tells a
 * model something is missing but not how to reach it, so the caller-supplied
 * continuation call is quoted verbatim when there is one.
 */
function truncationNote(dropped: number, hint?: string): string {
  const what = dropped === 1 ? '1 earlier message' : `${dropped} earlier messages`;
  const how = hint
    ? `To read them: ${hint}`
    : 'Request a larger budget or a narrower range to read them.';
  return `_[${what} omitted to fit the character budget. ${how}]_`;
}

/**
 * Renders a chronological message slice as compact markdown optimized for
 * LLM consumption. Uses the export pipeline's NameResolver so contact names
 * resolve the same way as `/api/export`.
 */
export function renderConversation(messages: MessageRow[], opts: RenderOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const timezone = isValidTz(o.timezone) ? o.timezone : 'UTC';

  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });

  const resolver = buildNameResolver({
    me_alias: o.me_alias,
    prefer_saved_names: true,
    anonymize_jids: false,
  } as ExportOptions);

  const reactionsByTarget = o.include_reactions ? collectReactions(messages) : new Map<string, AttachedReaction[]>();

  const prefix: string[] = [];
  if (opts.chat_label) {
    prefix.push(`# ${opts.chat_label}`);
    if (opts.subtitle) prefix.push(`_${opts.subtitle}_`);
    prefix.push('');
  }

  const blocks: MessageBlock[] = [];
  for (const msg of messages) {
    // Reactions are attached inline — skip the raw reaction rows. They are not
    // messages for trimming purposes either: they ride along with their target.
    if (o.include_reactions && msg.message_type === 'reaction') continue;

    const date = dateFmt.format(new Date(msg.timestamp * 1000));
    const lines: string[] = [];

    const time = timeFmt.format(new Date(msg.timestamp * 1000));
    const senderJid = msg.from_me === 1 ? undefined : (msg.participant || msg.from_jid);
    const sender = msg.from_me === 1 ? o.me_alias : resolver.resolveName(senderJid, msg.push_name);

    let body = '';
    if (msg.is_deleted === 1) {
      body = '_(message deleted)_';
    } else if (msg.body) {
      body = msg.body.replace(/\r?\n/g, ' ');
    } else if (msg.message_type === 'location') {
      body = msg.location_name ? `[location: ${msg.location_name}]` : '[location]';
    } else if (msg.message_type === 'poll' || msg.poll_name) {
      body = `[poll: ${msg.poll_name || 'untitled'}]`;
    }

    const media = mediaTag(msg);
    if (media) body = body ? `${body} ${media}` : media;

    const transcript = transcriptionTag(msg);
    if (transcript) body = body ? `${body} ${transcript}` : transcript;

    const tags: string[] = [];
    if (msg.edit_type && msg.edit_type !== 0) tags.push('_(edited)_');
    if (msg.is_forwarded === 1) tags.push('_(forwarded)_');
    if (msg.is_starred === 1) tags.push('⭐');

    if (o.include_quoted && msg.quoted_id) {
      const q = msg.quoted_body ? truncate(msg.quoted_body, 100) : '(no preview)';
      lines.push(`> ↩ ${q}`);
    }

    let line = `**${time}** ${sender}: ${body}`;
    if (tags.length > 0) line += ' ' + tags.join(' ');
    if (o.include_id) line += `  \`#${msg.id}\``;
    lines.push(line);

    const rxs = reactionsByTarget.get(msg.id);
    if (rxs && rxs.length > 0) {
      const byEmoji = new Map<string, string[]>();
      for (const r of rxs) {
        const label = r.from_me ? o.me_alias : resolver.resolveName(r.from_jid);
        const arr = byEmoji.get(r.emoji) ?? [];
        arr.push(label);
        byEmoji.set(r.emoji, arr);
      }
      const parts: string[] = [];
      for (const [emoji, names] of byEmoji) parts.push(`${emoji} ${names.join(', ')}`);
      lines.push(`> ${parts.join(' · ')}`);
    }

    lines.push('');
    blocks.push({ date, lines });
  }

  const full = assemble(prefix, blocks);

  // No budget (or a nonsensical one) → unlimited, byte-identical to before.
  const budget = typeof o.budget === 'number' && o.budget > 0 ? o.budget : 0;
  if (budget === 0 || full.length <= budget) return full;

  // Budget accounting includes *everything* returned — the chat title header
  // and the truncation note count against it too, so a caller that asks for
  // N characters gets at most N back (the sole exception being a single
  // message that alone exceeds the budget; it is the newest thing and the
  // caller asked for it, so it is never trimmed or dropped).
  const reserve = linesCost(prefix)
    + linesCost([truncationNote(Math.max(blocks.length - 1, 0), o.truncation_hint), '']);
  const available = Math.max(0, budget - reserve);

  // Walk newest → oldest, keeping the longest suffix that fits. Adding a block
  // to the front costs its own lines plus a date header, and refunds the header
  // of the block that used to be first when they share a date.
  let cost = 0;
  let first = Math.max(blocks.length - 1, 0);
  for (let i = blocks.length - 1; i >= 0; i--) {
    let next = cost + linesCost(blocks[i].lines) + linesCost(dateHeaderLines(blocks[i].date));
    const prev = blocks[i + 1];
    if (prev && prev.date === blocks[i].date) next -= linesCost(dateHeaderLines(prev.date));
    // The newest block is unconditional: never return an empty transcript.
    if (i < blocks.length - 1 && next > available) break;
    cost = next;
    first = i;
  }

  // Nothing actually dropped (a single oversized message, or none at all):
  // there is no missing history to point at, so no note is emitted.
  if (first <= 0) return full;

  const note = truncationNote(first, o.truncation_hint);
  return assemble([...prefix, note, ''], blocks.slice(first));
}
