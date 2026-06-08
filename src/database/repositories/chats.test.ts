import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb } from '../../test-utils/db.js';

let db: Database.Database;

// Mock getDb to return our test database
vi.mock('../index.js', () => ({
  getDb: () => db,
}));

// Import AFTER mocks are set up
const { chatsRepo } = await import('./chats.js');

describe('chatsRepo', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  describe('upsert last_message_* (forward-only)', () => {
    const jid = '5511999999999@s.whatsapp.net';

    it('advances last_message_ts/body when a newer message arrives', () => {
      chatsRepo.upsert({ jid, last_message_ts: 1000, last_message_body: 'old' });
      chatsRepo.upsert({ jid, last_message_ts: 2000, last_message_body: 'new' });

      const row = chatsRepo.getByJid(jid)!;
      expect(row.last_message_ts).toBe(2000);
      expect(row.last_message_body).toBe('new');
    });

    it('does NOT clobber the preview when an older (history) message is backfilled', () => {
      chatsRepo.upsert({ jid, last_message_ts: 2000, last_message_body: 'newest' });
      // Simulate history backfill upserting an older message through persistMessage.
      chatsRepo.upsert({ jid, last_message_ts: 1000, last_message_body: 'ancient' });

      const row = chatsRepo.getByJid(jid)!;
      expect(row.last_message_ts).toBe(2000);
      expect(row.last_message_body).toBe('newest');
    });

    it('sets last_message_* on first insert even with no prior value', () => {
      chatsRepo.upsert({ jid, last_message_ts: 1500, last_message_body: 'first' });

      const row = chatsRepo.getByJid(jid)!;
      expect(row.last_message_ts).toBe(1500);
      expect(row.last_message_body).toBe('first');
    });

    it('preserves existing preview when an upsert omits last_message_ts (metadata-only update)', () => {
      chatsRepo.upsert({ jid, last_message_ts: 2000, last_message_body: 'keep me' });
      chatsRepo.upsert({ jid, name: 'Renamed Chat' });

      const row = chatsRepo.getByJid(jid)!;
      expect(row.name).toBe('Renamed Chat');
      expect(row.last_message_ts).toBe(2000);
      expect(row.last_message_body).toBe('keep me');
    });
  });
});
