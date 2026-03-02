import type Database from 'better-sqlite3-multiple-ciphers';
import type { Migration } from './index.js';
import { applySchema } from '../schema.js';

/**
 * Baseline migration — applies the full initial schema.
 * For existing databases, it detects that tables already exist (CREATE IF NOT EXISTS)
 * and effectively becomes a no-op, just marking itself as applied.
 */
export const migration: Migration = {
  id: '001-baseline',
  up(db: Database.Database): void {
    applySchema(db);
  },
};
