import type { ExportContext, SelectedChat, SelectedMessage } from './types.js';

function senderLabel(msg: SelectedMessage, ctx: ExportContext): string {
  if (msg.from_me === 1) return ctx.options.me_alias;
  const jid = msg.participant || msg.from_jid;
  return ctx.resolveName(jid, ctx.options.prefer_saved_names ? undefined : msg.push_name);
}

function applyPrivacyToBody(body: string | undefined, ctx: ExportContext): string {
  if (!body) return '';
  let out = body;
  if (ctx.options.redact_phone_numbers) {
    out = out.replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, (m) => m.replace(/\d/g, '•'));
  }
  return out.replace(/\r?\n/g, ' ');
}

function bodyForMessage(msg: SelectedMessage, ctx: ExportContext): string {
  if (msg.is_deleted === 1) return '(deleted)';
  if (msg.message_type === 'reaction') return `[reaction ${msg.reaction_emoji || '?'}]`;
  if (msg.has_media === 1) {
    const mt = (msg.media_mime_type || '').split('/')[0] || 'media';
    const name = msg.media_filename ? `: ${msg.media_filename}` : '';
    const body = applyPrivacyToBody(msg.body, ctx);
    return body ? `[${mt}${name}] ${body}` : `[${mt}${name}]`;
  }
  if (msg.latitude !== undefined && msg.latitude !== null) {
    return `[location${msg.location_name ? `: ${msg.location_name}` : ''}]`;
  }
  return applyPrivacyToBody(msg.body, ctx);
}

export function renderText(
  selectedChats: SelectedChat[],
  messagesByChat: Map<string, SelectedMessage[]>,
  ctx: ExportContext
): string {
  const out: string[] = [];

  out.push('=== WhatsApp Export ===');
  out.push(`Generated: ${ctx.generatedAt.toISOString()}`);
  out.push(`Window: ${new Date(ctx.window.from * 1000).toISOString()} → ${new Date(ctx.window.to * 1000).toISOString()}`);
  out.push(`Timezone: ${ctx.options.timezone}`);
  out.push(`Chats: ${selectedChats.length}`);
  out.push('');

  for (const sc of selectedChats) {
    const msgs = messagesByChat.get(sc.chat.jid) || [];
    if (msgs.length === 0) continue;

    out.push('');
    out.push('='.repeat(80));
    out.push(`CHAT: ${ctx.resolveChatLabel(sc.chat.jid)}`);
    out.push(`JID: ${sc.chat.jid}`);
    out.push(`Type: ${sc.chat.is_group === 1 ? 'Group' : '1-on-1'}`);
    out.push(`Messages: ${msgs.length}`);
    out.push('='.repeat(80));
    out.push('');

    for (const msg of msgs) {
      if (ctx.options.reactions === 'inline' && msg.message_type === 'reaction') continue;

      const date = ctx.formatDate(msg.timestamp);
      const time = ctx.formatTime(msg.timestamp);
      const sender = senderLabel(msg, ctx);
      const body = bodyForMessage(msg, ctx);

      let line = `[${date} ${time}] ${sender}: ${body}`;
      if (msg.is_forwarded === 1) line += ' (forwarded)';
      if (msg.is_starred === 1) line += ' *';
      if (msg.edit_type && msg.edit_type !== 0 && msg.is_deleted !== 1) line += ' (edited)';
      out.push(line);

      if (msg.quoted_id && !ctx.options.strip_quoted_bodies && msg.quoted_body) {
        out.push(`    > ${msg.quoted_body.slice(0, 120).replace(/\r?\n/g, ' ')}`);
      }

      if (ctx.options.reactions === 'inline' && msg.reactions_to_self && msg.reactions_to_self.length > 0) {
        const reactionStr = msg.reactions_to_self
          .map((r) => `${r.emoji} ${r.from_jid ? ctx.resolveName(r.from_jid) : ctx.options.me_alias}`)
          .join(', ');
        out.push(`    [reactions: ${reactionStr}]`);
      }
    }
  }

  return out.join('\n') + '\n';
}
