import { getDb } from '../index.js';

export interface LabelRow {
  id: string;
  name: string;
  color?: string;
  created_at: string;
}

export interface LabelAssociationInput {
  labelId: string;
  chatJid?: string;
  messageId?: string;
  /** 'chat' or 'message' */
  type: 'chat' | 'message';
}

export const labelsRepo = {
  /** Insert or update a label definition (from labels.edit). */
  upsertLabel(label: { id: string; name: string; color?: number | string | null }): void {
    getDb().prepare(`
      INSERT INTO labels (id, name, color)
      VALUES (@id, @name, @color)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        color = excluded.color
    `).run({
      id: label.id,
      name: label.name,
      color: label.color == null ? null : String(label.color),
    });
  },

  /** Remove a label and all of its associations (from labels.edit with deleted=true). */
  deleteLabel(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM label_associations WHERE label_id = ?').run(id);
    db.prepare('DELETE FROM labels WHERE id = ?').run(id);
  },

  /** Add a chat/message → label association (idempotent via the unique index). */
  addAssociation(a: LabelAssociationInput): void {
    getDb().prepare(`
      INSERT OR IGNORE INTO label_associations (label_id, chat_jid, message_id, type)
      VALUES (@labelId, @chatJid, @messageId, @type)
    `).run({
      labelId: a.labelId,
      chatJid: a.chatJid ?? null,
      messageId: a.messageId ?? null,
      type: a.type,
    });
  },

  /** Remove a chat/message → label association. */
  removeAssociation(a: LabelAssociationInput): void {
    getDb().prepare(`
      DELETE FROM label_associations
      WHERE label_id = @labelId AND type = @type
        AND COALESCE(chat_jid, '') = COALESCE(@chatJid, '')
        AND COALESCE(message_id, '') = COALESCE(@messageId, '')
    `).run({
      labelId: a.labelId,
      chatJid: a.chatJid ?? null,
      messageId: a.messageId ?? null,
      type: a.type,
    });
  },

  /** All labels (tags) attached to a contact's/chat's JID. */
  getLabelsForChat(chatJid: string): LabelRow[] {
    return this.getLabelsForChats([chatJid]);
  },

  /**
   * All labels attached to any of the given chat JIDs (deduped by label id).
   * Accepts multiple JID forms (phone + LID) for the same contact.
   */
  getLabelsForChats(chatJids: string[]): LabelRow[] {
    const jids = [...new Set(chatJids.filter(Boolean))];
    if (jids.length === 0) return [];
    const placeholders = jids.map(() => '?').join(', ');
    return getDb().prepare(`
      SELECT DISTINCT l.* FROM label_associations a
      JOIN labels l ON l.id = a.label_id
      WHERE a.type = 'chat' AND a.chat_jid IN (${placeholders})
      ORDER BY l.name
    `).all(...jids) as LabelRow[];
  },
};
