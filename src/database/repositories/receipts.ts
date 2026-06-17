import { getDb } from '../index.js';

export type ReceiptStatus = 'sent' | 'delivered' | 'read' | 'played';

/** Per-message rollup of receipt rows, used to compute a tick state. */
export interface ReceiptAggregate {
  message_id: string;
  n: number;
  n_delivered: number;
  n_read: number;
  /** Highest precedence seen across recipients: 1 sent, 2 delivered, 3 read, 4 played. */
  max_prec: number;
}

const PREC_CASE = `CASE status WHEN 'played' THEN 4 WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END`;

export const receiptsRepo = {
  /**
   * Record a receipt with monotonic precedence: ack events can arrive out of
   * order (delivered after read), so a stored status is only ever upgraded.
   */
  upsert(messageId: string, recipientJid: string, status: ReceiptStatus, timestamp?: number): void {
    getDb().prepare(`
      INSERT INTO message_receipts (message_id, recipient_jid, status, timestamp)
      VALUES (@id, @jid, @status, @ts)
      ON CONFLICT(message_id, recipient_jid) DO UPDATE SET
        status = CASE WHEN
          (CASE excluded.status WHEN 'played' THEN 4 WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END) >
          (CASE message_receipts.status WHEN 'played' THEN 4 WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END)
        THEN excluded.status ELSE message_receipts.status END,
        timestamp = COALESCE(excluded.timestamp, message_receipts.timestamp),
        updated_at = datetime('now')
    `).run({ id: messageId, jid: recipientJid, status, ts: timestamp ?? null });
  },

  /** Latest stored status for one message/recipient pair (mostly for tests). */
  get(messageId: string, recipientJid: string): { status: ReceiptStatus; timestamp?: number } | undefined {
    return getDb()
      .prepare('SELECT status, timestamp FROM message_receipts WHERE message_id = ? AND recipient_jid = ?')
      .get(messageId, recipientJid) as { status: ReceiptStatus; timestamp?: number } | undefined;
  },

  /** Batch rollup for a set of message ids (single query per ≤500-id chunk). */
  getAggregates(messageIds: string[]): Map<string, ReceiptAggregate> {
    const map = new Map<string, ReceiptAggregate>();
    if (messageIds.length === 0) return map;
    const db = getDb();
    for (let i = 0; i < messageIds.length; i += 500) {
      const chunk = messageIds.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT message_id,
          COUNT(*) AS n,
          SUM(CASE WHEN status IN ('delivered','read','played') THEN 1 ELSE 0 END) AS n_delivered,
          SUM(CASE WHEN status IN ('read','played') THEN 1 ELSE 0 END) AS n_read,
          MAX(${PREC_CASE}) AS max_prec
        FROM message_receipts
        WHERE message_id IN (${placeholders})
        GROUP BY message_id
      `).all(...chunk) as ReceiptAggregate[];
      for (const row of rows) map.set(row.message_id, row);
    }
    return map;
  },
};

/**
 * Collapse a receipt rollup into the tick state shown for an outgoing message.
 * 1:1 chats: the single recipient's highest ack wins. Groups follow WhatsApp
 * semantics — ✓✓/blue only once ALL recipients (participants minus self) have
 * acked; with unknown participant counts we fall back to the 1:1 rule.
 */
export function computeReceiptStatus(
  agg: ReceiptAggregate | undefined,
  isGroup: boolean,
  recipientCount: number
): ReceiptStatus {
  if (!agg || agg.n === 0) return 'sent';
  const byPrec: ReceiptStatus[] = ['sent', 'sent', 'delivered', 'read', 'played'];
  if (!isGroup || recipientCount <= 0) return byPrec[Math.min(agg.max_prec, 4)] ?? 'sent';
  if (agg.n_read >= recipientCount) return 'read';
  if (agg.n_delivered >= recipientCount) return 'delivered';
  return 'sent';
}
