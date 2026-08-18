import type Database from 'better-sqlite3-multiple-ciphers';
import { getDb } from '../index.js';
import { config } from '../../config.js';

/** Cache whether FTS5 table exists to avoid per-query overhead. */
let ftsAvailable: boolean | null = null;
function hasFts(db: Database.Database): boolean {
  if (ftsAvailable !== null) return ftsAvailable;
  try {
    const result = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages_fts'").get();
    ftsAvailable = !!result;
  } catch {
    ftsAvailable = false;
  }
  return ftsAvailable;
}

function stripRawMessage<T extends { raw_message?: string }>(row: T): T {
  if (config.security.stripRawMessages && row) {
    delete row.raw_message;
  }
  return row;
}

export interface MessageRow {
  id: string;
  remote_jid: string;
  from_jid?: string;
  from_me: number;
  participant?: string;
  timestamp: number;
  push_name?: string;
  message_type?: string;
  body?: string;
  quoted_id?: string;
  quoted_body?: string;
  is_forwarded: number;
  forward_score: number;
  is_starred: number;
  is_broadcast: number;
  is_ephemeral: number;
  ephemeral_duration?: number;
  edit_type: number;
  edited_at?: string;
  is_deleted: number;
  deleted_at?: string;
  has_media: number;
  media_id?: string;
  media_mime_type?: string;
  media_size?: number;
  media_filename?: string;
  media_duration?: number;
  media_width?: number;
  media_height?: number;
  media_transcription?: string;
  media_transcription_status?: string;
  reaction_emoji?: string;
  reaction_target_id?: string;
  poll_name?: string;
  poll_options?: string;
  latitude?: number;
  longitude?: number;
  location_name?: string;
  location_address?: string;
  raw_message?: string;
  created_at: string;
}

export interface MessageStats {
  total: number;
  byType: Array<{ message_type: string; count: number }>;
  byChat: Array<{ remote_jid: string; count: number }>;
  byDay: Array<{ day: string; count: number }>;
  mediaCount: number;
}

export interface MessageAnalytics {
  range: { days: number | null; firstTs: number | null; lastTs: number | null };
  totals: {
    total: number;
    sent: number;
    received: number;
    media: number;
    forwarded: number;
    starred: number;
    deleted: number;
    edited: number;
    reactions: number;
    words: number;
    activeDays: number;
  };
  byDay: Array<{ day: string; total: number; sent: number; received: number }>;
  byType: Array<{ message_type: string; count: number }>;
  byHour: Array<{ hour: number; count: number; sent: number; received: number }>;
  byWeekday: Array<{ weekday: number; count: number }>;
  heatmap: Array<{ weekday: number; hour: number; count: number }>;
  byChat: Array<{ remote_jid: string; count: number; sent: number; received: number; last_ts: number }>;
  topSenders: Array<{ sender: string; count: number }>;
  media: { total: number; totalSize: number; byKind: Array<{ kind: string; count: number; size: number }> };
  topEmojis: Array<{ emoji: string; count: number }>;
}

export interface MessageQuery {
  remote_jid?: string;
  from_jid?: string;
  from_me?: boolean;
  message_type?: string;
  /**
   * Several types at once, as `message_type IN (…)`. Separate from the
   * single-value `message_type` because callers of that one pass a plain string
   * and there is no reason to make them wrap it.
   *
   * An empty array means "no type filter", which is what a caller handing us
   * its own empty list of types means; a query that matched nothing at all
   * would be a surprising reading of "I didn't narrow this".
   */
  message_types?: string[];
  search?: string;
  before?: number;
  after?: number;
  has_media?: boolean;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

export const messagesRepo = {
  upsert(msg: Partial<MessageRow>): void {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO messages (
        id, remote_jid, from_jid, from_me, participant, timestamp, push_name,
        message_type, body, quoted_id, quoted_body, is_forwarded, forward_score,
        is_starred, is_broadcast, is_ephemeral, ephemeral_duration,
        has_media, media_id, media_mime_type, media_size, media_filename,
        media_duration, media_width, media_height,
        reaction_emoji, reaction_target_id, poll_name, poll_options,
        latitude, longitude, location_name, location_address,
        raw_message
      ) VALUES (
        @id, @remote_jid, @from_jid, @from_me, @participant, @timestamp, @push_name,
        @message_type, @body, @quoted_id, @quoted_body, @is_forwarded, @forward_score,
        @is_starred, @is_broadcast, @is_ephemeral, @ephemeral_duration,
        @has_media, @media_id, @media_mime_type, @media_size, @media_filename,
        @media_duration, @media_width, @media_height,
        @reaction_emoji, @reaction_target_id, @poll_name, @poll_options,
        @latitude, @longitude, @location_name, @location_address,
        @raw_message
      ) ON CONFLICT(id) DO UPDATE SET
        is_starred = COALESCE(excluded.is_starred, messages.is_starred),
        edit_type = COALESCE(excluded.edit_type, messages.edit_type),
        edited_at = COALESCE(excluded.edited_at, messages.edited_at),
        is_deleted = COALESCE(excluded.is_deleted, messages.is_deleted),
        deleted_at = COALESCE(excluded.deleted_at, messages.deleted_at),
        media_id = COALESCE(excluded.media_id, messages.media_id)
    `);

    stmt.run({
      id: msg.id,
      remote_jid: msg.remote_jid,
      from_jid: msg.from_jid || null,
      from_me: msg.from_me ?? 0,
      participant: msg.participant || null,
      timestamp: msg.timestamp,
      push_name: msg.push_name || null,
      message_type: msg.message_type || null,
      body: msg.body || null,
      quoted_id: msg.quoted_id || null,
      quoted_body: msg.quoted_body || null,
      is_forwarded: msg.is_forwarded ?? 0,
      forward_score: msg.forward_score ?? 0,
      is_starred: msg.is_starred ?? 0,
      is_broadcast: msg.is_broadcast ?? 0,
      is_ephemeral: msg.is_ephemeral ?? 0,
      ephemeral_duration: msg.ephemeral_duration || null,
      has_media: msg.has_media ?? 0,
      media_id: msg.media_id || null,
      media_mime_type: msg.media_mime_type || null,
      media_size: msg.media_size || null,
      media_filename: msg.media_filename || null,
      media_duration: msg.media_duration || null,
      media_width: msg.media_width || null,
      media_height: msg.media_height || null,
      reaction_emoji: msg.reaction_emoji || null,
      reaction_target_id: msg.reaction_target_id || null,
      poll_name: msg.poll_name || null,
      poll_options: msg.poll_options || null,
      latitude: msg.latitude || null,
      longitude: msg.longitude || null,
      location_name: msg.location_name || null,
      location_address: msg.location_address || null,
      raw_message: msg.raw_message || null,
    });
  },

  getById(id: string): MessageRow | undefined {
    const db = getDb();
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
    return row ? stripRawMessage(row) : undefined;
  },

  /** Internal getById that always includes raw_message (for quoting use case). */
  getByIdInternal(id: string): MessageRow | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
  },

  query(q: MessageQuery): { data: MessageRow[]; total: number } {
    const db = getDb();
    const conditions: string[] = [];
    const params: any = {};
    let useFts = false;

    if (q.remote_jid) {
      conditions.push('messages.remote_jid = @remote_jid');
      params.remote_jid = q.remote_jid;
    }
    if (q.from_jid) {
      conditions.push('(messages.from_jid = @from_jid OR messages.participant = @from_jid)');
      params.from_jid = q.from_jid;
    }
    if (q.from_me !== undefined) {
      conditions.push('messages.from_me = @from_me');
      params.from_me = q.from_me ? 1 : 0;
    }
    if (q.message_type) {
      conditions.push('messages.message_type = @message_type');
      params.message_type = q.message_type;
    }
    if (q.message_types && q.message_types.length > 0) {
      // One bound parameter per type. The placeholder names come from the
      // index, never from the value — the types themselves reach SQLite as
      // parameters, the same as every other filter here.
      const placeholders = q.message_types.map((_, i) => `@message_type_${i}`);
      conditions.push(`messages.message_type IN (${placeholders.join(', ')})`);
      q.message_types.forEach((t, i) => {
        params[`message_type_${i}`] = t;
      });
    }
    if (q.search) {
      // Try FTS5 first, fall back to LIKE if table doesn't exist
      if (hasFts(db)) {
        useFts = true;
        conditions.push('messages.id IN (SELECT id FROM messages_fts WHERE messages_fts MATCH @search)');
        // Escape FTS5 special characters and wrap in quotes for exact phrase matching
        params.search = `"${q.search.replace(/"/g, '""')}"`;
      } else {
        conditions.push('messages.body LIKE @search');
        params.search = `%${q.search}%`;
      }
    }
    if (q.before) {
      conditions.push('messages.timestamp < @before');
      params.before = q.before;
    }
    if (q.after) {
      conditions.push('messages.timestamp > @after');
      params.after = q.after;
    }
    if (q.has_media !== undefined) {
      conditions.push('messages.has_media = @has_media');
      params.has_media = q.has_media ? 1 : 0;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const limit = q.limit || 50;
    const offset = q.offset || 0;

    const total = db
      .prepare(`SELECT COUNT(*) as count FROM messages ${where}`)
      .get(params) as { count: number };

    const data = db
      .prepare(
        `SELECT messages.* FROM messages ${where} ORDER BY messages.timestamp ${order} LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit, offset }) as MessageRow[];

    return { data: data.map(stripRawMessage), total: total.count };
  },

  /**
   * Oldest stored message for a chat, by timestamp. Selects discrete columns
   * (not raw_message) so it works even when raw JSON is stripped. Used to build
   * the cursor for requesting older history from WhatsApp.
   */
  getOldestForChat(jid: string): { id: string; from_me: number | boolean; timestamp: number; participant?: string } | undefined {
    const db = getDb();
    return db
      .prepare('SELECT id, from_me, timestamp, participant FROM messages WHERE remote_jid = ? ORDER BY timestamp ASC LIMIT 1')
      .get(jid) as { id: string; from_me: number | boolean; timestamp: number; participant?: string } | undefined;
  },

  /**
   * Store an AI transcription/description for a media message.
   * Kept separate from upsert so re-receiving the message never clobbers it.
   */
  setTranscription(messageId: string, text: string | null, status: string): void {
    getDb()
      .prepare('UPDATE messages SET media_transcription = ?, media_transcription_status = ? WHERE id = ?')
      .run(text, status, messageId);
  },

  /** Update only the transcription status (e.g. mark 'pending' before the API call). */
  setTranscriptionStatus(messageId: string, status: string): void {
    getDb()
      .prepare('UPDATE messages SET media_transcription_status = ? WHERE id = ?')
      .run(status, messageId);
  },

  markDeleted(id: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE messages SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?`
    ).run(id);
  },

  markEdited(id: string, newBody: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE messages SET body = ?, edit_type = 1, edited_at = datetime('now') WHERE id = ?`
    ).run(newBody, id);
  },

  getStats(): MessageStats {
    const db = getDb();
    return {
      total: (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c,
      byType: db
        .prepare(
          'SELECT message_type, COUNT(*) as count FROM messages GROUP BY message_type ORDER BY count DESC'
        )
        .all() as Array<{ message_type: string; count: number }>,
      byChat: db
        .prepare(
          `SELECT remote_jid, COUNT(*) as count FROM messages
           GROUP BY remote_jid ORDER BY count DESC LIMIT 20`
        )
        .all() as Array<{ remote_jid: string; count: number }>,
      byDay: db
        .prepare(
          `SELECT date(timestamp, 'unixepoch') as day, COUNT(*) as count
           FROM messages GROUP BY day ORDER BY day DESC LIMIT 30`
        )
        .all() as Array<{ day: string; count: number }>,
      mediaCount: (
        db.prepare('SELECT COUNT(*) as c FROM messages WHERE has_media = 1').get() as { c: number }
      ).c,
    };
  },

  /**
   * Rich analytics for the Statistics dashboard. Optionally scoped to a single
   * chat and/or a trailing time window (in days). Day/hour/weekday buckets use
   * 'localtime' so the heatmap and hourly charts reflect the user's clock rather
   * than UTC.
   */
  getAnalytics(opts: { chat?: string; days?: number } = {}): MessageAnalytics {
    const db = getDb();

    // Build a shared filter shared by every aggregate below.
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.chat) {
      conditions.push('remote_jid = @chat');
      params.chat = opts.chat;
    }
    if (opts.days && opts.days > 0) {
      conditions.push('timestamp >= @after');
      params.after = Math.floor(Date.now() / 1000) - opts.days * 86400;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // Prefix for queries that need to AND extra conditions onto the shared filter.
    const andPrefix = conditions.length ? `${conditions.join(' AND ')} AND ` : '';
    const bind = Object.keys(params).length ? [params] : [];
    const all = <T>(sql: string): T[] => db.prepare(sql).all(...bind) as T[];
    const one = <T>(sql: string): T => db.prepare(sql).get(...bind) as T;

    const totals = one<{
      total: number; sent: number; received: number; media: number; forwarded: number;
      starred: number; deleted: number; edited: number; reactions: number; words: number;
      activeDays: number; firstTs: number | null; lastTs: number | null;
    }>(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(from_me), 0) as sent,
        COALESCE(SUM(CASE WHEN from_me = 0 THEN 1 ELSE 0 END), 0) as received,
        COALESCE(SUM(has_media), 0) as media,
        COALESCE(SUM(is_forwarded), 0) as forwarded,
        COALESCE(SUM(is_starred), 0) as starred,
        COALESCE(SUM(is_deleted), 0) as deleted,
        COALESCE(SUM(CASE WHEN edit_type > 0 THEN 1 ELSE 0 END), 0) as edited,
        COALESCE(SUM(CASE WHEN message_type = 'reaction' THEN 1 ELSE 0 END), 0) as reactions,
        COALESCE(SUM(
          CASE WHEN body IS NOT NULL AND trim(body) != ''
            THEN length(trim(body)) - length(replace(trim(body), ' ', '')) + 1
            ELSE 0 END
        ), 0) as words,
        COUNT(DISTINCT date(timestamp, 'unixepoch', 'localtime')) as activeDays,
        MIN(timestamp) as firstTs,
        MAX(timestamp) as lastTs
      FROM messages ${where}
    `);

    const byDay = all<{ day: string; total: number; sent: number; received: number }>(`
      SELECT date(timestamp, 'unixepoch', 'localtime') as day,
        COUNT(*) as total,
        COALESCE(SUM(from_me), 0) as sent,
        COALESCE(SUM(CASE WHEN from_me = 0 THEN 1 ELSE 0 END), 0) as received
      FROM messages ${where}
      GROUP BY day ORDER BY day DESC LIMIT 180
    `);

    const byType = all<{ message_type: string; count: number }>(`
      SELECT COALESCE(message_type, 'unknown') as message_type, COUNT(*) as count
      FROM messages ${where} GROUP BY message_type ORDER BY count DESC
    `);

    const byHour = all<{ hour: number; count: number; sent: number; received: number }>(`
      SELECT CAST(strftime('%H', timestamp, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as count,
        COALESCE(SUM(from_me), 0) as sent,
        COALESCE(SUM(CASE WHEN from_me = 0 THEN 1 ELSE 0 END), 0) as received
      FROM messages ${where} GROUP BY hour ORDER BY hour
    `);

    const byWeekday = all<{ weekday: number; count: number }>(`
      SELECT CAST(strftime('%w', timestamp, 'unixepoch', 'localtime') AS INTEGER) as weekday,
        COUNT(*) as count
      FROM messages ${where} GROUP BY weekday ORDER BY weekday
    `);

    const heatmap = all<{ weekday: number; hour: number; count: number }>(`
      SELECT CAST(strftime('%w', timestamp, 'unixepoch', 'localtime') AS INTEGER) as weekday,
        CAST(strftime('%H', timestamp, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as count
      FROM messages ${where} GROUP BY weekday, hour
    `);

    const byChat = all<{ remote_jid: string; count: number; sent: number; received: number; last_ts: number }>(`
      SELECT remote_jid, COUNT(*) as count,
        COALESCE(SUM(from_me), 0) as sent,
        COALESCE(SUM(CASE WHEN from_me = 0 THEN 1 ELSE 0 END), 0) as received,
        MAX(timestamp) as last_ts
      FROM messages ${where}
      GROUP BY remote_jid ORDER BY count DESC LIMIT 25
    `);

    const topSenders = all<{ sender: string; count: number }>(`
      SELECT COALESCE(participant, from_jid) as sender, COUNT(*) as count
      FROM messages
      WHERE ${andPrefix}from_me = 0 AND participant IS NOT NULL
      GROUP BY sender ORDER BY count DESC LIMIT 15
    `);

    const mediaByKind = all<{ kind: string; count: number; size: number }>(`
      SELECT
        CASE
          WHEN media_mime_type IS NULL OR media_mime_type = '' THEN 'other'
          WHEN instr(media_mime_type, '/') > 0 THEN substr(media_mime_type, 1, instr(media_mime_type, '/') - 1)
          ELSE media_mime_type
        END as kind,
        COUNT(*) as count,
        COALESCE(SUM(media_size), 0) as size
      FROM messages
      WHERE ${andPrefix}has_media = 1
      GROUP BY kind ORDER BY count DESC
    `);

    const topEmojis = all<{ emoji: string; count: number }>(`
      SELECT reaction_emoji as emoji, COUNT(*) as count
      FROM messages
      WHERE ${andPrefix}reaction_emoji IS NOT NULL AND reaction_emoji != ''
      GROUP BY reaction_emoji ORDER BY count DESC LIMIT 18
    `);

    return {
      range: { days: opts.days ?? null, firstTs: totals.firstTs, lastTs: totals.lastTs },
      totals: {
        total: totals.total, sent: totals.sent, received: totals.received, media: totals.media,
        forwarded: totals.forwarded, starred: totals.starred, deleted: totals.deleted,
        edited: totals.edited, reactions: totals.reactions, words: totals.words,
        activeDays: totals.activeDays,
      },
      byDay, byType, byHour, byWeekday, heatmap, byChat, topSenders,
      media: {
        total: mediaByKind.reduce((s, m) => s + m.count, 0),
        totalSize: mediaByKind.reduce((s, m) => s + m.size, 0),
        byKind: mediaByKind,
      },
      topEmojis,
    };
  },
};
