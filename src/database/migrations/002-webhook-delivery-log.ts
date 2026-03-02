import type Database from 'better-sqlite3-multiple-ciphers';
import type { Migration } from './index.js';

/**
 * Creates the webhook_delivery_log table for tracking failed webhook deliveries
 * (dead letter queue) and enabling retry.
 */
export const migration: Migration = {
  id: '002-webhook-delivery-log',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_delivery_log (
        id              TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        event_type      TEXT NOT NULL,
        payload         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'failed',  -- failed, retried, delivered
        attempts        INTEGER NOT NULL DEFAULT 0,
        max_attempts    INTEGER NOT NULL DEFAULT 5,
        last_error      TEXT,
        last_attempt_at TEXT,
        next_retry_at   TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_wdl_subscription ON webhook_delivery_log(subscription_id);
      CREATE INDEX IF NOT EXISTS idx_wdl_status ON webhook_delivery_log(status);
      CREATE INDEX IF NOT EXISTS idx_wdl_next_retry ON webhook_delivery_log(next_retry_at) WHERE status = 'failed';
    `);
  },
};
