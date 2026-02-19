import Database from 'better-sqlite3';
import { config } from '../config.js';
import { applySchema } from './schema.js';
import { log } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(): Database.Database {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  }

  db = new Database(config.dbPath);
  fs.chmodSync(config.dbPath, 0o640);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  applySchema(db);

  log.db.info({ path: config.dbPath }, 'SQLite initialized');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    log.db.info('Database closed');
  }
}
