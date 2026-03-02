import { getDb } from '../index.js';

export interface WebhookDeliveryRow {
  id: string;
  subscription_id: string;
  event_type: string;
  payload: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

export const webhookDeliveriesRepo = {
  insert(delivery: Pick<WebhookDeliveryRow, 'id' | 'subscription_id' | 'event_type' | 'payload' | 'attempts' | 'last_error'>): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO webhook_delivery_log (id, subscription_id, event_type, payload, status, attempts, last_error, last_attempt_at, next_retry_at)
      VALUES (@id, @subscription_id, @event_type, @payload, 'failed', @attempts, @last_error, datetime('now'), datetime('now', '+' || @delay_seconds || ' seconds'))
    `).run({
      id: delivery.id,
      subscription_id: delivery.subscription_id,
      event_type: delivery.event_type,
      payload: delivery.payload,
      attempts: delivery.attempts,
      last_error: delivery.last_error,
      delay_seconds: getBackoffSeconds(delivery.attempts),
    });
  },

  updateAttempt(id: string, attempts: number, error: string | null, exhausted: boolean): void {
    const db = getDb();
    if (exhausted) {
      db.prepare(`
        UPDATE webhook_delivery_log
        SET attempts = ?, last_error = ?, last_attempt_at = datetime('now'), status = 'exhausted', next_retry_at = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(attempts, error, id);
    } else {
      db.prepare(`
        UPDATE webhook_delivery_log
        SET attempts = ?, last_error = ?, last_attempt_at = datetime('now'), next_retry_at = datetime('now', '+' || ? || ' seconds'), updated_at = datetime('now')
        WHERE id = ?
      `).run(attempts, error, getBackoffSeconds(attempts), id);
    }
  },

  markDelivered(id: string): void {
    const db = getDb();
    db.prepare(`
      UPDATE webhook_delivery_log
      SET status = 'delivered', next_retry_at = NULL, last_attempt_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
  },

  getDueForRetry(limit = 20): WebhookDeliveryRow[] {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM webhook_delivery_log
      WHERE status = 'failed' AND next_retry_at <= datetime('now')
      ORDER BY next_retry_at ASC
      LIMIT ?
    `).all(limit) as WebhookDeliveryRow[];
  },

  query(opts: { subscription_id?: string; status?: string; limit?: number; offset?: number }): { data: WebhookDeliveryRow[]; total: number } {
    const db = getDb();
    const conditions: string[] = [];
    const params: Record<string, string | number> = {};

    if (opts.subscription_id) {
      conditions.push('subscription_id = @subscription_id');
      params.subscription_id = opts.subscription_id;
    }
    if (opts.status) {
      conditions.push('status = @status');
      params.status = opts.status;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit || 50;
    const offset = opts.offset || 0;

    const total = (db.prepare(`SELECT COUNT(*) as c FROM webhook_delivery_log ${where}`).get(params) as { c: number }).c;
    const data = db.prepare(`SELECT * FROM webhook_delivery_log ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset }) as WebhookDeliveryRow[];

    return { data, total };
  },

  getById(id: string): WebhookDeliveryRow | undefined {
    return getDb().prepare('SELECT * FROM webhook_delivery_log WHERE id = ?').get(id) as WebhookDeliveryRow | undefined;
  },
};

/** Exponential backoff: 1s, 2s, 4s, 8s, 16s */
function getBackoffSeconds(attempt: number): number {
  return Math.pow(2, attempt - 1);
}
