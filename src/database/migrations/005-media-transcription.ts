import type Database from 'better-sqlite3-multiple-ciphers';
import type { Migration } from './index.js';

/**
 * Adds AI media transcription columns to the messages table and rebuilds the
 * FTS5 index to include the transcription text, so transcribed audio and image
 * descriptions become full-text searchable alongside message bodies.
 */
export const migration: Migration = {
  id: '005-media-transcription',
  up(db: Database.Database): void {
    // 1. Add transcription columns. Fresh DBs already have them from the
    //    baseline schema (migration 001), so guard against duplicates.
    const cols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    const hasCol = (c: string) => cols.some((x) => x.name === c);
    if (!hasCol('media_transcription')) {
      db.exec('ALTER TABLE messages ADD COLUMN media_transcription TEXT');
    }
    if (!hasCol('media_transcription_status')) {
      db.exec('ALTER TABLE messages ADD COLUMN media_transcription_status TEXT');
    }

    // 2. Rebuild the FTS5 index to include transcription text. Skip if the FTS
    //    table doesn't exist (migration 003 may have been skipped on this DB).
    const ftsExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages_fts'")
      .get();
    if (!ftsExists) return;

    db.exec(`
      DROP TRIGGER IF EXISTS messages_fts_insert;
      DROP TRIGGER IF EXISTS messages_fts_update;
      DROP TRIGGER IF EXISTS messages_fts_update_delete;
      DROP TRIGGER IF EXISTS messages_fts_update_insert;
      DROP TRIGGER IF EXISTS messages_fts_delete;
      DROP TABLE IF EXISTS messages_fts;
    `);

    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        id UNINDEXED,
        body,
        push_name,
        media_transcription,
        content=messages,
        content_rowid=rowid,
        tokenize='unicode61 remove_diacritics 2'
      );
    `);

    db.exec(`
      INSERT OR IGNORE INTO messages_fts(rowid, id, body, push_name, media_transcription)
      SELECT rowid, id, body, push_name, media_transcription FROM messages
      WHERE body IS NOT NULL OR media_transcription IS NOT NULL;
    `);

    // Sync triggers for a *sparse* external-content FTS5 index: only rows that
    // carry searchable text (body and/or transcription) are indexed. Two rules
    // must hold or the index corrupts:
    //   1. External-content tables must be cleaned up with the special 'delete'
    //      command carrying the OLD column values — a plain `DELETE FROM fts`
    //      reads the (already-changed) content row and corrupts the index. This
    //      replaces the buggy pattern shipped in migration 003.
    //   2. A 'delete' may only be issued for a row that was actually indexed.
    //      Because inserts are conditional, the delete/update paths must carry
    //      the *same* condition — otherwise issuing 'delete' for a never-indexed
    //      row (e.g. a media-only message that later gains a transcription)
    //      corrupts the index. The UPDATE case is split so the OLD-side delete
    //      and the NEW-side insert are each guarded independently.
    db.exec(`
      CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages
      WHEN NEW.body IS NOT NULL OR NEW.media_transcription IS NOT NULL
      BEGIN
        INSERT INTO messages_fts(rowid, id, body, push_name, media_transcription)
        VALUES (NEW.rowid, NEW.id, NEW.body, NEW.push_name, NEW.media_transcription);
      END;
    `);

    db.exec(`
      CREATE TRIGGER messages_fts_update_delete AFTER UPDATE OF body, media_transcription ON messages
      WHEN OLD.body IS NOT NULL OR OLD.media_transcription IS NOT NULL
      BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, id, body, push_name, media_transcription)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.body, OLD.push_name, OLD.media_transcription);
      END;
    `);

    db.exec(`
      CREATE TRIGGER messages_fts_update_insert AFTER UPDATE OF body, media_transcription ON messages
      WHEN NEW.body IS NOT NULL OR NEW.media_transcription IS NOT NULL
      BEGIN
        INSERT INTO messages_fts(rowid, id, body, push_name, media_transcription)
        VALUES (NEW.rowid, NEW.id, NEW.body, NEW.push_name, NEW.media_transcription);
      END;
    `);

    db.exec(`
      CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages
      WHEN OLD.body IS NOT NULL OR OLD.media_transcription IS NOT NULL
      BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, id, body, push_name, media_transcription)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.body, OLD.push_name, OLD.media_transcription);
      END;
    `);
  },
};
