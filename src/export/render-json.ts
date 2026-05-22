import type { ExportContext, SelectedChat, SelectedMessage } from './types.js';

function buildMessage(msg: SelectedMessage, ctx: ExportContext) {
  const senderJid = msg.from_me === 1 ? null : (msg.participant || msg.from_jid || null);
  const senderLabel = msg.from_me === 1 ? ctx.options.me_alias : ctx.resolveName(senderJid || undefined, msg.push_name);

  let body: string | null = msg.body || null;
  if (ctx.options.redact_phone_numbers && body) {
    body = body.replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, (m) => m.replace(/\d/g, '•'));
  }

  const out: Record<string, unknown> = {
    id: msg.id,
    timestamp: msg.timestamp,
    timestamp_iso: new Date(msg.timestamp * 1000).toISOString(),
    from_me: msg.from_me === 1,
    sender_jid: senderJid,
    sender_label: senderLabel,
    type: msg.message_type || 'unknown',
    body,
  };

  if (msg.quoted_id) {
    out.reply = ctx.options.strip_quoted_bodies
      ? { quoted_id: msg.quoted_id }
      : { quoted_id: msg.quoted_id, quoted_body: msg.quoted_body || null };
  }

  if (msg.has_media === 1) {
    const mr = msg.media_row;
    out.media = {
      id: msg.media_id,
      mime_type: mr?.mime_type || msg.media_mime_type || null,
      file_size: mr?.file_size ?? msg.media_size ?? null,
      filename: mr?.original_filename || msg.media_filename || null,
      width: mr?.width || msg.media_width || null,
      height: mr?.height || msg.media_height || null,
      duration: mr?.duration || msg.media_duration || null,
      download_status: mr?.download_status || null,
      transcription: msg.media_transcription || null,
      transcription_status: msg.media_transcription_status || null,
      url: mr?.download_status === 'downloaded' && ctx.options.media === 'ref'
        ? `${ctx.baseUrl}/api/media/${msg.media_id}/download`
        : null,
    };
  }

  if (msg.message_type === 'reaction') {
    out.reaction = { emoji: msg.reaction_emoji || null, target_id: msg.reaction_target_id || null };
  }

  if (msg.reactions_to_self && msg.reactions_to_self.length > 0) {
    out.reactions = msg.reactions_to_self.map((r) => ({
      emoji: r.emoji,
      from_jid: r.from_jid || null,
      from_label: r.from_jid ? ctx.resolveName(r.from_jid) : ctx.options.me_alias,
    }));
  }

  if (msg.is_forwarded === 1) out.is_forwarded = true;
  if (msg.is_starred === 1) out.is_starred = true;
  if (msg.is_deleted === 1) out.is_deleted = true;
  if (msg.edit_type && msg.edit_type !== 0) out.is_edited = true;

  if (msg.latitude !== undefined && msg.latitude !== null) {
    out.location = {
      latitude: msg.latitude,
      longitude: msg.longitude,
      name: msg.location_name || null,
      address: msg.location_address || null,
    };
  }

  if (msg.poll_name) {
    out.poll = { name: msg.poll_name, options: msg.poll_options || null };
  }

  return out;
}

export function renderJson(
  selectedChats: SelectedChat[],
  messagesByChat: Map<string, SelectedMessage[]>,
  ctx: ExportContext
): unknown {
  const opts = ctx.options;

  const chats = selectedChats.map((sc) => {
    const msgs = messagesByChat.get(sc.chat.jid) || [];
    const visible = opts.reactions === 'inline'
      ? msgs.filter((m) => m.message_type !== 'reaction')
      : msgs;

    return {
      jid: sc.chat.jid,
      label: ctx.resolveChatLabel(sc.chat.jid),
      is_group: sc.chat.is_group === 1,
      is_archived: sc.chat.is_archived === 1,
      is_muted: sc.chat.is_muted === 1,
      message_count: visible.length,
      first_timestamp: msgs.length > 0 ? msgs[0].timestamp : null,
      last_timestamp: msgs.length > 0 ? msgs[msgs.length - 1].timestamp : null,
      messages: visible.map((m) => buildMessage(m, ctx)),
    };
  });

  const totalMessages = chats.reduce((sum, c) => sum + c.message_count, 0);

  return {
    meta: {
      generated_at: ctx.generatedAt.toISOString(),
      window: {
        from: ctx.window.from,
        to: ctx.window.to,
        from_iso: new Date(ctx.window.from * 1000).toISOString(),
        to_iso: new Date(ctx.window.to * 1000).toISOString(),
      },
      timezone: opts.timezone,
      chats_included: chats.length,
      messages_included: totalMessages,
      preset: opts.preset,
      reactions_mode: opts.reactions,
      media_mode: opts.media,
      filters: {
        types: opts.types || null,
        exclude_types: opts.exclude_types,
        from_me: opts.from_me ?? null,
        has_media: opts.has_media ?? null,
        search: opts.search || null,
        groups_only: opts.groups_only ?? false,
        dms_only: opts.dms_only ?? false,
        include_archived: opts.include_archived,
        include_muted: opts.include_muted,
        unread_only: opts.unread_only,
      },
      privacy: {
        redact_phone_numbers: opts.redact_phone_numbers,
        anonymize_jids: opts.anonymize_jids,
        strip_quoted_bodies: opts.strip_quoted_bodies,
      },
    },
    chats,
  };
}
