import { getDb } from '../index.js';

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

export interface MessageQuery {
  remote_jid?: string;
  from_jid?: string;
  from_me?: boolean;
  message_type?: string;
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
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
  },

  query(q: MessageQuery): { data: MessageRow[]; total: number } {
    const db = getDb();
    const conditions: string[] = [];
    const params: any = {};

    if (q.remote_jid) {
      conditions.push('remote_jid = @remote_jid');
      params.remote_jid = q.remote_jid;
    }
    if (q.from_jid) {
      conditions.push('(from_jid = @from_jid OR participant = @from_jid)');
      params.from_jid = q.from_jid;
    }
    if (q.from_me !== undefined) {
      conditions.push('from_me = @from_me');
      params.from_me = q.from_me ? 1 : 0;
    }
    if (q.message_type) {
      conditions.push('message_type = @message_type');
      params.message_type = q.message_type;
    }
    if (q.search) {
      conditions.push('body LIKE @search');
      params.search = `%${q.search}%`;
    }
    if (q.before) {
      conditions.push('timestamp < @before');
      params.before = q.before;
    }
    if (q.after) {
      conditions.push('timestamp > @after');
      params.after = q.after;
    }
    if (q.has_media !== undefined) {
      conditions.push('has_media = @has_media');
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
        `SELECT * FROM messages ${where} ORDER BY timestamp ${order} LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit, offset }) as MessageRow[];

    return { data, total: total.count };
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
};
