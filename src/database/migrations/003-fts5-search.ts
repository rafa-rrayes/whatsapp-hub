import type Database from 'better-sqlite3-multiple-ciphers';
import type { Migration } from './index.js';

/**
 * Creates an FTS5 virtual table for full-text search on messages.
 * Includes triggers to keep the FTS index in sync with the messages table.
 */
export const migration: Migration = {
  id: '003-fts5-search',
  up(db: Database.Database): void {
    // Create FTS5 virtual table mirroring searchable message fields
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        id UNINDEXED,
        body,
        push_name,
        content=messages,
        content_rowid=rowid,
        tokenize='unicode61 remove_diacritics 2'
      );
    `);

    // Populate FTS index with existing data
    db.exec(`
      INSERT OR IGNORE INTO messages_fts(rowid, id, body, push_name)
      SELECT rowid, id, body, push_name FROM messages WHERE body IS NOT NULL;
    `);

    // Triggers to keep FTS in sync
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages
      WHEN NEW.body IS NOT NULL
      BEGIN
        INSERT INTO messages_fts(rowid, id, body, push_name) VALUES (NEW.rowid, NEW.id, NEW.body, NEW.push_name);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF body ON messages
      BEGIN
        DELETE FROM messages_fts WHERE rowid = OLD.rowid;
        INSERT INTO messages_fts(rowid, id, body, push_name) VALUES (NEW.rowid, NEW.id, NEW.body, NEW.push_name);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages
      BEGIN
        DELETE FROM messages_fts WHERE rowid = OLD.rowid;
      END;
    `);
  },
};
