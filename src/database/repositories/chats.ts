import { getDb } from '../index.js';

export interface ChatRow {
  jid: string;
  name?: string;
  is_group: number;
  is_archived: number;
  is_pinned: number;
  is_muted: number;
  mute_expiry?: number;
  unread_count: number;
  last_message_ts?: number;
  last_message_body?: string;
  updated_at: string;
}

export const chatsRepo = {
  upsert(chat: Partial<ChatRow>): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO chats (jid, name, is_group, is_archived, is_pinned, is_muted, mute_expiry, unread_count, last_message_ts, last_message_body)
      VALUES (@jid, @name, @is_group, @is_archived, @is_pinned, @is_muted, @mute_expiry, @unread_count, @last_message_ts, @last_message_body)
      ON CONFLICT(jid) DO UPDATE SET
        name = COALESCE(excluded.name, chats.name),
        is_archived = COALESCE(excluded.is_archived, chats.is_archived),
        is_pinned = COALESCE(excluded.is_pinned, chats.is_pinned),
        is_muted = COALESCE(excluded.is_muted, chats.is_muted),
        mute_expiry = COALESCE(excluded.mute_expiry, chats.mute_expiry),
        unread_count = COALESCE(excluded.unread_count, chats.unread_count),
        last_message_ts = COALESCE(excluded.last_message_ts, chats.last_message_ts),
        last_message_body = COALESCE(excluded.last_message_body, chats.last_message_body),
        updated_at = datetime('now')
    `).run({
      jid: chat.jid,
      name: chat.name || null,
      is_group: chat.is_group ?? 0,
      is_archived: chat.is_archived ?? 0,
      is_pinned: chat.is_pinned ?? 0,
      is_muted: chat.is_muted ?? 0,
      mute_expiry: chat.mute_expiry || null,
      unread_count: chat.unread_count ?? 0,
      last_message_ts: chat.last_message_ts || null,
      last_message_body: chat.last_message_body || null,
    });
  },

  getAll(opts?: { search?: string; limit?: number; offset?: number }): ChatRow[] {
    const db = getDb();
    const limit = opts?.limit || 100;
    const offset = opts?.offset || 0;

    if (opts?.search) {
      return db.prepare(
        `SELECT * FROM chats WHERE name LIKE @s OR jid LIKE @s ORDER BY last_message_ts DESC LIMIT @limit OFFSET @offset`
      ).all({ s: `%${opts.search}%`, limit, offset }) as ChatRow[];
    }
    return db.prepare(
      'SELECT * FROM chats ORDER BY last_message_ts DESC LIMIT @limit OFFSET @offset'
    ).all({ limit, offset }) as ChatRow[];
  },

  getByJid(jid: string): ChatRow | undefined {
    return getDb().prepare('SELECT * FROM chats WHERE jid = ?').get(jid) as ChatRow | undefined;
  },
};
