import type { ExportContext, MessageField, SelectedChat, SelectedMessage } from './types.js';

/** Escape only the characters that would break the wrapping construct. */
function escapeForBlockquote(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/[\[\]]/g, (m) => `\\${m}`);
}

function escapeForBoldLabel(s: string): string {
  return s.replace(/[*_`]/g, (m) => `\\${m}`);
}

function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function slugify(s: string): string {
  const base = s.toLowerCase()
    .replace(/[^a-z0-9à-ſ-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'chat';
}

function uniqueSlug(s: string, used: Set<string>): string {
  let slug = slugify(s);
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  let i = 2;
  while (used.has(`${slug}-${i}`)) i++;
  const final = `${slug}-${i}`;
  used.add(final);
  return final;
}

function mediaCategory(mime?: string): 'image' | 'video' | 'audio' | 'sticker' | 'document' {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return mime === 'image/webp' ? 'sticker' : 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function dayKey(unix: number, timezone: string): string {
  const d = new Date(unix * 1000);
  // YYYY-MM-DD using user's timezone
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function hourKey(unix: number, timezone: string): string {
  const d = new Date(unix * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).format(d);
}

function renderFrontmatter(
  selectedChats: SelectedChat[],
  messagesByChat: Map<string, SelectedMessage[]>,
  ctx: ExportContext,
  totalMessages: number,
  mediaStats: { count: number; totalBytes: number }
): string {
  const opts = ctx.options;
  const lines: string[] = ['---'];
  lines.push(`generated_at: ${ctx.generatedAt.toISOString()}`);
  lines.push(`window:`);
  lines.push(`  from: ${new Date(ctx.window.from * 1000).toISOString()}`);
  lines.push(`  to:   ${new Date(ctx.window.to * 1000).toISOString()}`);
  lines.push(`chats_included: ${selectedChats.length}`);
  lines.push(`messages_included: ${totalMessages}`);
  lines.push(`preset: ${opts.preset}`);
  lines.push(`timezone: ${opts.timezone}`);
  lines.push(`reactions: ${opts.reactions}`);
  if (opts.types && opts.types.length > 0) lines.push(`types: [${opts.types.join(', ')}]`);
  if (opts.exclude_types && opts.exclude_types.length > 0) lines.push(`exclude_types: [${opts.exclude_types.join(', ')}]`);
  if (opts.from_me !== undefined) lines.push(`from_me: ${opts.from_me}`);
  if (opts.has_media !== undefined) lines.push(`has_media: ${opts.has_media}`);
  if (opts.search) lines.push(`search: ${JSON.stringify(opts.search)}`);
  lines.push(`media:`);
  lines.push(`  mode: ${opts.media}`);
  if (opts.media !== 'none') {
    lines.push(`  files: ${mediaStats.count}`);
    lines.push(`  total_size_mb: ${(mediaStats.totalBytes / 1024 / 1024).toFixed(2)}`);
  }
  if (opts.anonymize_jids) lines.push(`anonymized: true`);
  if (opts.redact_phone_numbers) lines.push(`phone_numbers_redacted: true`);
  lines.push('---');
  return lines.join('\n');
}

function renderHeader(
  selectedChats: SelectedChat[],
  totalMessages: number,
  ctx: ExportContext
): string {
  const fromLabel = ctx.formatDate(ctx.window.from);
  const toLabel = ctx.formatDate(ctx.window.to);
  const lines: string[] = [];
  lines.push(`# WhatsApp Export`);
  lines.push('');
  lines.push(`**${totalMessages.toLocaleString()} messages across ${selectedChats.length} chats** — ${fromLabel} → ${toLabel}`);
  return lines.join('\n');
}

function renderToc(
  selectedChats: Array<SelectedChat & { _slug: string }>,
  messagesByChat: Map<string, SelectedMessage[]>,
  ctx: ExportContext
): string {
  const lines: string[] = ['## Table of contents', ''];
  for (const sc of selectedChats) {
    const label = ctx.resolveChatLabel(sc.chat.jid);
    const msgs = messagesByChat.get(sc.chat.jid) || [];
    const lastTs = msgs.length > 0 ? msgs[msgs.length - 1].timestamp : sc.chat.last_message_ts;
    const lastLabel = lastTs ? ctx.formatDate(lastTs) : '—';
    const count = msgs.length;
    lines.push(`- [${escapeForBoldLabel(label)}](#${sc._slug}) · ${count} msg${count === 1 ? '' : 's'} · last ${lastLabel}`);
  }
  return lines.join('\n');
}

function renderChatHeader(
  sc: SelectedChat & { _slug: string },
  msgs: SelectedMessage[],
  ctx: ExportContext
): string {
  const label = ctx.resolveChatLabel(sc.chat.jid);
  const isGroup = sc.chat.is_group === 1;
  const lines: string[] = [];
  lines.push(`## ${escapeForBoldLabel(label)}`);
  lines.push('');
  lines.push(`> **Type:** ${isGroup ? 'Group' : '1-on-1'}`);
  lines.push(`> **JID:** \`${sc.chat.jid}\``);
  if (msgs.length > 0) {
    lines.push(`> **Messages:** ${msgs.length}  ·  ${ctx.formatDate(msgs[0].timestamp)} ${ctx.formatTime(msgs[0].timestamp)} → ${ctx.formatDate(msgs[msgs.length - 1].timestamp)} ${ctx.formatTime(msgs[msgs.length - 1].timestamp)}`);
  } else {
    lines.push(`> **Messages:** 0`);
  }
  if (isGroup) {
    const senders = new Set<string>();
    for (const m of msgs) {
      const id = m.from_me === 1 ? '__me__' : (m.participant || m.from_jid || '');
      if (id) senders.add(id);
    }
    if (senders.size > 0) {
      const labels = [...senders].slice(0, 12).map((id) => id === '__me__' ? ctx.options.me_alias : ctx.resolveName(id));
      lines.push(`> **Active senders:** ${labels.join(', ')}${senders.size > 12 ? ` (+${senders.size - 12} more)` : ''}`);
    }
  }
  return lines.join('\n');
}

function renderMediaPlaceholder(msg: SelectedMessage, ctx: ExportContext): string | null {
  if (!msg.media_row && msg.has_media !== 1) return null;
  const mr = msg.media_row;
  const cat = mediaCategory(mr?.mime_type || msg.media_mime_type);
  const size = mr?.file_size || msg.media_size;
  const sizeLabel = size ? ` *(${formatBytes(size)})*` : '';
  const original = mr?.original_filename || msg.media_filename;
  const opts = ctx.options;

  // Skip per filters
  if (opts.media_types && !opts.media_types.includes(cat)) return null;
  const maxBytes = opts.max_media_size_mb * 1024 * 1024;
  const oversized = maxBytes > 0 && size && size > maxBytes;

  if (opts.media === 'none' || !mr || mr.download_status !== 'downloaded' || !mr.file_path || oversized) {
    const tag = original ? `${cat}: ${original}` : cat;
    return `*[${tag}]*${sizeLabel}`;
  }

  if (opts.media === 'ref') {
    const url = `${ctx.baseUrl}/api/media/${mr.id}/download`;
    const altLabel = original || cat;
    if (cat === 'image' || cat === 'sticker') {
      return `![${escapeForBoldLabel(altLabel)}](${url})${sizeLabel}`;
    }
    return `[${cat}: ${escapeForBoldLabel(altLabel)}](${url})${sizeLabel}`;
  }

  if (opts.media === 'embed') {
    if (cat === 'image' && size && size <= 256 * 1024) {
      // Caller will inline base64 — for now mark with a placeholder the bundler resolves.
      // (Embedding happens at render time in a sync context; we read sync here.)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('path');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { mediaManager } = require('../media/manager.js');
        const fullPath = mediaManager.getMediaPath(mr.file_path);
        if (fs.existsSync(fullPath)) {
          const buf = fs.readFileSync(fullPath);
          const b64 = buf.toString('base64');
          const dataUrl = `data:${mr.mime_type || 'image/jpeg'};base64,${b64}`;
          return `![${escapeForBoldLabel(original || 'image')}](${dataUrl})${sizeLabel}`;
        }
      } catch {
        // fall through to ref
      }
    }
    // Fall back to ref for non-images or oversized
    const url = `${ctx.baseUrl}/api/media/${mr.id}/download`;
    return `[${cat}: ${escapeForBoldLabel(original || cat)}](${url})${sizeLabel}`;
  }

  if (opts.media === 'attach') {
    const ext = original ? original.split('.').pop() : (mr.file_path.split('.').pop() || 'bin');
    const safeBase = original
      ? original.replace(/[^a-zA-Z0-9._-]+/g, '_')
      : `${cat}.${ext}`;
    const relPath = `media/${mr.id}-${safeBase}`;
    const altLabel = original || cat;
    if (cat === 'image' || cat === 'sticker') {
      return `![${escapeForBoldLabel(altLabel)}](${relPath})${sizeLabel}`;
    }
    return `[${cat}: ${escapeForBoldLabel(altLabel)}](${relPath})${sizeLabel}`;
  }

  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function senderLabel(msg: SelectedMessage, ctx: ExportContext): string {
  if (msg.from_me === 1) return ctx.options.me_alias;
  const jid = msg.participant || msg.from_jid;
  return ctx.resolveName(jid, ctx.options.prefer_saved_names ? undefined : msg.push_name);
}

function applyPrivacyToBody(body: string | undefined, ctx: ExportContext): string | undefined {
  if (!body) return body;
  let out = body;
  if (ctx.options.redact_phone_numbers) {
    out = out.replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, (m) => m.replace(/\d/g, '•'));
  }
  return out;
}

function renderMessageBody(msg: SelectedMessage, ctx: ExportContext): string {
  const fields = ctx.fields;
  const time = fields.has('timestamp') ? `**${ctx.formatTime(msg.timestamp)}** ` : '';
  const sender = fields.has('sender') ? `**${escapeForBoldLabel(senderLabel(msg, ctx))}:** ` : '';

  // Body content
  let bodyText: string | undefined;
  if (msg.is_deleted === 1) {
    bodyText = '~~_(message deleted)_~~';
  } else {
    bodyText = applyPrivacyToBody(msg.body || undefined, ctx);
  }

  // Special non-text types when body is empty
  if (!bodyText) {
    if (msg.message_type === 'location' || (msg.latitude !== undefined && msg.latitude !== null)) {
      const name = msg.location_name ? `: ${msg.location_name}` : '';
      bodyText = `*[location${name}]*`;
    } else if (msg.message_type === 'poll' || msg.poll_name) {
      bodyText = `*[poll: ${msg.poll_name || 'untitled'}]*`;
    } else if (msg.has_media !== 1) {
      bodyText = '';
    }
  }

  // Annotations on body
  const annotations: string[] = [];
  if (fields.has('edits') && msg.edit_type && msg.edit_type !== 0 && msg.is_deleted !== 1) {
    annotations.push('*(edited)*');
  }
  if (fields.has('starred') && msg.is_starred === 1) {
    annotations.push('⭐');
  }
  if (fields.has('forwarded') && msg.is_forwarded === 1) {
    annotations.push((msg.forward_score || 0) >= 4 ? '*(forwarded many times)*' : '*(forwarded)*');
  }

  const lines: string[] = [];

  // Reply context
  if (fields.has('reply') && msg.quoted_id && !ctx.options.strip_quoted_bodies) {
    const quoted = msg.quoted_body ? truncate(msg.quoted_body, 120) : '(no preview available)';
    lines.push(`> ↩ replying to: ${escapeForBlockquote(quoted)}`);
  } else if (fields.has('reply') && msg.quoted_id && ctx.options.strip_quoted_bodies) {
    lines.push(`> ↩ replying to message \`${msg.quoted_id}\``);
  }

  // Main line
  let mainLine = `${time}${sender}${bodyText || ''}`;
  if (annotations.length > 0) {
    mainLine = `${mainLine.trimEnd()} ${annotations.join(' ')}`;
  }
  if (fields.has('id')) {
    mainLine = `${mainLine.trimEnd()}  \`#${msg.id}\``;
  }
  lines.push(mainLine);

  // Media (if any)
  if (fields.has('media')) {
    const mediaBlock = renderMediaPlaceholder(msg, ctx);
    if (mediaBlock) lines.push(mediaBlock);
  }

  // Inline reactions
  if (fields.has('reactions') && ctx.options.reactions === 'inline' && msg.reactions_to_self && msg.reactions_to_self.length > 0) {
    const groups = new Map<string, string[]>();
    for (const r of msg.reactions_to_self) {
      const reactor = r.from_jid ? ctx.resolveName(r.from_jid) : ctx.options.me_alias;
      const list = groups.get(r.emoji) || [];
      list.push(reactor);
      groups.set(r.emoji, list);
    }
    const parts: string[] = [];
    for (const [emoji, names] of groups) {
      parts.push(`${emoji} ${names.join(', ')}`);
    }
    lines.push(`> ${parts.join(' · ')}`);
  }

  return lines.join('\n');
}

function renderMessage(msg: SelectedMessage, ctx: ExportContext): string | null {
  // In inline mode, raw reaction messages are skipped (their content is on the target)
  if (ctx.options.reactions === 'inline' && msg.message_type === 'reaction') return null;
  // In separate mode, render reactions as their own messages with a marker
  if (ctx.options.reactions === 'separate' && msg.message_type === 'reaction') {
    const fields = ctx.fields;
    const time = fields.has('timestamp') ? `**${ctx.formatTime(msg.timestamp)}** ` : '';
    const sender = fields.has('sender') ? `**${escapeForBoldLabel(senderLabel(msg, ctx))}** ` : '';
    return `${time}${sender}reacted ${msg.reaction_emoji || '?'} ${msg.reaction_target_id ? `to \`#${msg.reaction_target_id}\`` : ''}`;
  }
  return renderMessageBody(msg, ctx);
}

function renderChatMessages(
  msgs: SelectedMessage[],
  ctx: ExportContext
): string {
  const lines: string[] = [];
  let lastKey = '';
  const grouping = ctx.options.date_grouping;
  for (const msg of msgs) {
    if (grouping !== 'none') {
      const key = grouping === 'hour' ? hourKey(msg.timestamp, ctx.options.timezone) : dayKey(msg.timestamp, ctx.options.timezone);
      if (key !== lastKey) {
        lastKey = key;
        lines.push('');
        lines.push(`### ${ctx.formatDateGroup(msg.timestamp)}`);
        lines.push('');
      }
    }
    const rendered = renderMessage(msg, ctx);
    if (rendered === null) continue;
    lines.push(rendered);
    lines.push('');
  }
  return lines.join('\n');
}

export function renderMarkdown(
  selectedChats: SelectedChat[],
  messagesByChat: Map<string, SelectedMessage[]>,
  ctx: ExportContext
): string {
  // Compute totals + media stats for frontmatter
  let totalMessages = 0;
  let mediaCount = 0;
  let mediaBytes = 0;
  for (const sc of selectedChats) {
    const msgs = messagesByChat.get(sc.chat.jid) || [];
    totalMessages += msgs.filter((m) => !(ctx.options.reactions === 'inline' && m.message_type === 'reaction')).length;
    for (const m of msgs) {
      if (m.media_row?.download_status === 'downloaded' && m.media_row.file_size) {
        mediaCount++;
        mediaBytes += m.media_row.file_size;
      }
    }
  }

  // Compute slugs once
  const used = new Set<string>();
  const sluggedChats: Array<SelectedChat & { _slug: string }> = selectedChats.map((sc) => ({
    ...sc,
    _slug: uniqueSlug(ctx.resolveChatLabel(sc.chat.jid), used),
  }));

  const parts: string[] = [];
  parts.push(renderFrontmatter(selectedChats, messagesByChat, ctx, totalMessages, { count: mediaCount, totalBytes: mediaBytes }));
  parts.push('');
  parts.push(renderHeader(selectedChats, totalMessages, ctx));
  parts.push('');
  parts.push(renderToc(sluggedChats, messagesByChat, ctx));

  for (const sc of sluggedChats) {
    parts.push('');
    parts.push('---');
    parts.push('');
    parts.push(`<a id="${sc._slug}"></a>`);
    parts.push('');
    parts.push(renderChatHeader(sc, messagesByChat.get(sc.chat.jid) || [], ctx));
    parts.push('');
    parts.push(renderChatMessages(messagesByChat.get(sc.chat.jid) || [], ctx));
  }

  return parts.join('\n') + '\n';
}
