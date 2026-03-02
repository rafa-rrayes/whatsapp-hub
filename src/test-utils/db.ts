import Database from 'better-sqlite3-multiple-ciphers';
import { applySchema } from '../database/schema.js';

/**
 * Create a fresh in-memory SQLite database with the full schema applied.
 * Each call returns an independent DB — safe for parallel tests.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}
