import type Database from 'better-sqlite3-multiple-ciphers';
import { log } from '../../utils/logger.js';

export interface Migration {
  id: string;           // e.g. "001-baseline"
  up(db: Database.Database): void;
}

// Import migrations in order
import { migration as baseline } from './001-baseline.js';
import { migration as webhookDeliveryLog } from './002-webhook-delivery-log.js';
import { migration as fts5Search } from './003-fts5-search.js';

const migrations: Migration[] = [
  baseline,
  webhookDeliveryLog,
  fts5Search,
];

/**
 * Run all pending migrations in order.
 * Each migration runs inside a transaction. The `schema_migrations` table
 * tracks which migrations have already been applied.
 */
export function runMigrations(db: Database.Database): void {
  // Create the migrations tracking table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>)
      .map((row) => row.id)
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    const run = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
    });

    run();
    log.db.info({ migration: migration.id }, 'Applied migration');
  }
}
