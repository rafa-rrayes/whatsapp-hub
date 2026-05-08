import { getDb } from '../database/index.js';
import { chatsRepo } from '../database/repositories/chats.js';
import { mediaRepo } from '../database/repositories/media.js';
import type { MessageRow } from '../database/repositories/messages.js';
import type { ExportOptions, ResolvedTimeWindow, SelectedChat, SelectedMessage } from './types.js';

const SYSTEM_TYPES = new Set([
  'protocol', 'protocolMessage', 'senderKeyDistribution', 'senderKeyDistributionMessage',
  'history', 'historySync', 'historySyncNotification',
  'message_status', 'app_state', 'sync',
]);

function unixOf(input: number | string | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input === 'number') return input;
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

export function resolveTimeWindow(opts: ExportOptions): ResolvedTimeWindow {
  const now = Math.floor(Date.now() / 1000);
  let from = unixOf(opts.from);
  let to = unixOf(opts.to);

  if (from === undefined && to === undefined && opts.days !== undefined) {
    from = now - opts.days * 86400;
    to = now;
  } else {
    if (from === undefined) from = 0;
    if (to === undefined) to = now;
  }
  return { from, to };
}

function chatPasses(chat: { jid: string; is_group: number; is_archived: number; is_muted: number; unread_count: number }, opts: ExportOptions, exclude: Set<string>): boolean {
  if (exclude.has(chat.jid)) return false;
  if (opts.groups_only && chat.is_group !== 1) return false;
  if (opts.dms_only && chat.is_group === 1) return false;
  if (!opts.include_archived && chat.is_archived === 1) return false;
  if (!opts.include_muted && chat.is_muted === 1) return false;
  if (opts.unread_only && chat.unread_count === 0) return false;
  return true;
}

/** Count messages in the window for each chat, applying message-level filters. */
function countMessagesInWindow(jid: string, window: ResolvedTimeWindow, opts: ExportOptions): number {
  const db = getDb();
  const conditions: string[] = ['remote_jid = @jid', 'timestamp >= @from', 'timestamp <= @to'];
  const params: Record<string, unknown> = { jid, from: window.from, to: window.to };

  if (opts.from_me !== undefined) {
    conditions.push('from_me = @from_me');
    params.from_me = opts.from_me ? 1 : 0;
  }
  if (opts.has_media !== undefined) {
    conditions.push('has_media = @has_media');
    params.has_media = opts.has_media ? 1 : 0;
  }
  if (!opts.include_deleted) {
    conditions.push('is_deleted = 0');
  }
  if (opts.types && opts.types.length > 0) {
    const placeholders = opts.types.map((_, i) => `@type${i}`).join(',');
    conditions.push(`message_type IN (${placeholders})`);
    opts.types.forEach((t, i) => { params[`type${i}`] = t; });
  }
  if (opts.exclude_types && opts.exclude_types.length > 0) {
    const placeholders = opts.exclude_types.map((_, i) => `@xtype${i}`).join(',');
    conditions.push(`(message_type IS NULL OR message_type NOT IN (${placeholders}))`);
    opts.exclude_types.forEach((t, i) => { params[`xtype${i}`] = t; });
  }

  const sql = `SELECT COUNT(*) as c FROM messages WHERE ${conditions.join(' AND ')}`;
  const row = db.prepare(sql).get(params) as { c: number };
  return row.c;
}

export function selectChats(opts: ExportOptions, window: ResolvedTimeWindow): SelectedChat[] {
  const allChats = chatsRepo.getAll({ search: opts.chat_search, limit: 100_000 });
  const exclude = new Set(opts.exclude_chats || []);
  const allowlist = opts.chats && opts.chats.length > 0 ? new Set(opts.chats) : null;

  const candidates = allChats.filter((c) => {
    if (allowlist && !allowlist.has(c.jid)) return false;
    return chatPasses(c, opts, exclude);
  });

  const enriched: SelectedChat[] = [];
  for (const chat of candidates) {
    const count = countMessagesInWindow(chat.jid, window, opts);
    if (count < opts.min_messages) continue;
    if (count === 0 && opts.min_messages === 0) continue;
    enriched.push({ chat, message_count: count });
  }

  // If `chats` allowlist had jids that aren't in the chats table (rare, but possible
  // for sparsely-indexed chats), include them with whatever count they have so the
  // user gets what they asked for explicitly.
  if (allowlist) {
    const present = new Set(enriched.map((e) => e.chat.jid));
    for (const jid of allowlist) {
      if (present.has(jid) || exclude.has(jid)) continue;
      const count = countMessagesInWindow(jid, window, opts);
      if (count < opts.min_messages || count === 0) continue;
      enriched.push({
        chat: { jid, is_group: jid.endsWith('@g.us') ? 1 : 0, is_archived: 0, is_pinned: 0, is_muted: 0, unread_count: 0, updated_at: '' },
        message_count: count,
      });
    }
  }

  // Sort
  if (opts.sort_chats_by === 'volume') {
    enriched.sort((a, b) => b.message_count - a.message_count);
  } else if (opts.sort_chats_by === 'name') {
    enriched.sort((a, b) => (a.chat.name || a.chat.jid).localeCompare(b.chat.name || b.chat.jid));
  } else {
    // recent (default) — most recent activity first
    enriched.sort((a, b) => (b.chat.last_message_ts || 0) - (a.chat.last_message_ts || 0));
  }

  return enriched.slice(0, opts.max_chats);
}

export function selectMessages(jid: string, window: ResolvedTimeWindow, opts: ExportOptions, remainingBudget: number): SelectedMessage[] {
  if (remainingBudget <= 0) return [];

  // The default `exclude_types` filters out reactions, but inline/separate
  // reaction modes need them in the result set. Adjust the effective filter:
  //   inline   → include reactions, attach to targets, hide from main flow
  //   separate → include reactions as their own messages
  //   omit     → exclude reactions outright
  const effectiveExcludeTypes = new Set(opts.exclude_types || []);
  if (opts.reactions === 'inline' || opts.reactions === 'separate') {
    effectiveExcludeTypes.delete('reaction');
  } else if (opts.reactions === 'omit') {
    effectiveExcludeTypes.add('reaction');
  }

  const db = getDb();
  const conditions: string[] = ['remote_jid = @jid', 'timestamp >= @from', 'timestamp <= @to'];
  const params: Record<string, unknown> = { jid, from: window.from, to: window.to };

  if (opts.from_me !== undefined) {
    conditions.push('from_me = @from_me');
    params.from_me = opts.from_me ? 1 : 0;
  }
  if (opts.has_media !== undefined) {
    conditions.push('has_media = @has_media');
    params.has_media = opts.has_media ? 1 : 0;
  }
  if (!opts.include_deleted) {
    conditions.push('is_deleted = 0');
  }
  if (opts.types && opts.types.length > 0) {
    const placeholders = opts.types.map((_, i) => `@type${i}`).join(',');
    conditions.push(`message_type IN (${placeholders})`);
    opts.types.forEach((t, i) => { params[`type${i}`] = t; });
  }
  if (effectiveExcludeTypes.size > 0) {
    const arr = [...effectiveExcludeTypes];
    const placeholders = arr.map((_, i) => `@xtype${i}`).join(',');
    conditions.push(`(message_type IS NULL OR message_type NOT IN (${placeholders}))`);
    arr.forEach((t, i) => { params[`xtype${i}`] = t; });
  }
  if (opts.search) {
    conditions.push('body LIKE @search');
    params.search = `%${opts.search}%`;
  }
  if (opts.min_body_length > 0) {
    conditions.push("LENGTH(COALESCE(body, '')) >= @minLen");
    params.minLen = opts.min_body_length;
  }

  const sql = `
    SELECT id, remote_jid, from_jid, from_me, participant, timestamp, push_name,
           message_type, body, quoted_id, quoted_body, is_forwarded, forward_score,
           is_starred, is_broadcast, is_ephemeral, ephemeral_duration,
           edit_type, edited_at, is_deleted, deleted_at,
           has_media, media_id, media_mime_type, media_size, media_filename,
           media_duration, media_width, media_height,
           reaction_emoji, reaction_target_id, poll_name, poll_options,
           latitude, longitude, location_name, location_address,
           created_at
    FROM messages
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp ASC
    LIMIT @limit
  `;
  const rows = db.prepare(sql).all({ ...params, limit: remainingBudget }) as MessageRow[];

  // Drop system messages unless explicitly opted-in
  const filtered = opts.include_system
    ? rows
    : rows.filter((r) => !r.message_type || !SYSTEM_TYPES.has(r.message_type));

  // Attach media rows where applicable
  const enriched: SelectedMessage[] = filtered.map((row) => {
    let media_row;
    if (row.has_media === 1 && row.media_id) {
      media_row = mediaRepo.getById(row.media_id);
    }
    return { ...row, media_row };
  });

  // Attach reactions inline (pulled from messages where reaction_target_id matches another message in this batch)
  if (opts.reactions === 'inline') {
    const targetable = new Map<string, SelectedMessage>();
    for (const m of enriched) targetable.set(m.id, m);

    for (const m of enriched) {
      if (m.message_type === 'reaction' && m.reaction_target_id) {
        const target = targetable.get(m.reaction_target_id);
        if (!target) continue;
        target.reactions_to_self ??= [];
        target.reactions_to_self.push({
          emoji: m.reaction_emoji || '?',
          from_jid: m.from_me === 1 ? undefined : (m.participant || m.from_jid),
          from_label: '',  // resolved at render time
        });
      }
    }
  }

  return enriched;
}
