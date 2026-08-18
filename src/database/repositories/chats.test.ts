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

  describe('clearUnread', () => {
    const jid = '5511999999999@s.whatsapp.net';
    const other = '5511888888888@s.whatsapp.net';

    const countRows = () =>
      (db.prepare('SELECT COUNT(*) as c FROM chats').get() as { c: number }).c;

    it('resets a non-zero unread count to 0', () => {
      chatsRepo.upsert({ jid, unread_count: 7, last_message_ts: 1000 });

      chatsRepo.clearUnread(jid);

      expect(chatsRepo.getByJid(jid)!.unread_count).toBe(0);
    });

    it('bumps updated_at', () => {
      chatsRepo.upsert({ jid, unread_count: 3 });
      // datetime('now') only has second resolution, so pin a stale value rather
      // than racing the clock.
      db.prepare(`UPDATE chats SET updated_at = '2000-01-01 00:00:00' WHERE jid = ?`).run(jid);

      chatsRepo.clearUnread(jid);

      expect(chatsRepo.getByJid(jid)!.updated_at).not.toBe('2000-01-01 00:00:00');
    });

    it('is a no-op for an unknown JID and does NOT insert a row', () => {
      chatsRepo.upsert({ jid, unread_count: 4 });

      chatsRepo.clearUnread('5511777777777@s.whatsapp.net');

      expect(chatsRepo.getByJid('5511777777777@s.whatsapp.net')).toBeUndefined();
      expect(countRows()).toBe(1);
      expect(chatsRepo.getByJid(jid)!.unread_count).toBe(4);
    });

    it('leaves other chats untouched', () => {
      chatsRepo.upsert({ jid, unread_count: 5 });
      chatsRepo.upsert({ jid: other, unread_count: 9 });

      chatsRepo.clearUnread(jid);

      expect(chatsRepo.getByJid(jid)!.unread_count).toBe(0);
      expect(chatsRepo.getByJid(other)!.unread_count).toBe(9);
    });

    it('is idempotent on an already-read chat', () => {
      chatsRepo.upsert({ jid, unread_count: 0 });

      chatsRepo.clearUnread(jid);
      chatsRepo.clearUnread(jid);

      expect(chatsRepo.getByJid(jid)!.unread_count).toBe(0);
      expect(countRows()).toBe(1);
    });

    it('survives a later metadata upsert (upsert COALESCE cannot resurrect the count)', () => {
      chatsRepo.upsert({ jid, unread_count: 6 });
      chatsRepo.clearUnread(jid);

      // A metadata-only upsert passes unread_count: 0 by default; the point is
      // that clearing is not silently undone by ordinary chat updates.
      chatsRepo.upsert({ jid, name: 'Renamed' });

      expect(chatsRepo.getByJid(jid)!.unread_count).toBe(0);
    });
  });
});
