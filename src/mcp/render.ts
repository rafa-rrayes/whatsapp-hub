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

  const lines: string[] = [];
  if (opts.chat_label) {
    lines.push(`# ${opts.chat_label}`);
    if (opts.subtitle) lines.push(`_${opts.subtitle}_`);
    lines.push('');
  }

  let lastDate = '';
  for (const msg of messages) {
    // Reactions are attached inline — skip the raw reaction rows.
    if (o.include_reactions && msg.message_type === 'reaction') continue;

    const date = dateFmt.format(new Date(msg.timestamp * 1000));
    if (date !== lastDate) {
      lines.push(`## ${date}`);
      lines.push('');
      lastDate = date;
    }

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
  }

  return lines.join('\n');
}
