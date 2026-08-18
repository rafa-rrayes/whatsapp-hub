import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb } from '../../test-utils/db.js';
import { makeMessage, resetFixtures } from '../../test-utils/fixtures.js';

let db: Database.Database;

// Mock getDb to return our test database
vi.mock('../index.js', () => ({
  getDb: () => db,
}));

// Mock config to disable stripRawMessages
vi.mock('../../config.js', () => ({
  config: {
    security: { stripRawMessages: false },
  },
}));

// Import AFTER mocks are set up
const { messagesRepo } = await import('./messages.js');

describe('messagesRepo', () => {
  beforeEach(() => {
    db = createTestDb();
    resetFixtures();
  });

  describe('upsert', () => {
    it('inserts a new message', () => {
      const msg = makeMessage({ id: 'msg-1' });
      messagesRepo.upsert(msg);

      const row = messagesRepo.getById('msg-1');
      expect(row).toBeDefined();
      expect(row!.id).toBe('msg-1');
      expect(row!.body).toBe(msg.body);
    });

    it('updates on conflict (upsert)', () => {
      const msg = makeMessage({ id: 'msg-1', is_starred: 0 });
      messagesRepo.upsert(msg);

      // Upsert with updated is_starred
      messagesRepo.upsert({ ...msg, is_starred: 1 });

      const row = messagesRepo.getById('msg-1');
      expect(row!.is_starred).toBe(1);
    });

    it('preserves existing fields not in update', () => {
      const msg = makeMessage({ id: 'msg-1', body: 'original', is_starred: 0 });
      messagesRepo.upsert(msg);

      // Upsert should keep original body (not in ON CONFLICT SET)
      messagesRepo.upsert({ id: 'msg-1', remote_jid: msg.remote_jid, timestamp: msg.timestamp });

      const row = messagesRepo.getById('msg-1');
      expect(row!.body).toBe('original');
    });
  });

  describe('getById', () => {
    it('returns undefined for nonexistent ID', () => {
      expect(messagesRepo.getById('nonexistent')).toBeUndefined();
    });

    it('returns the message for valid ID', () => {
      messagesRepo.upsert(makeMessage({ id: 'msg-1', body: 'hello' }));
      const row = messagesRepo.getById('msg-1');
      expect(row!.body).toBe('hello');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      // Insert 10 messages across 2 chats
      for (let i = 0; i < 10; i++) {
        messagesRepo.upsert(
          makeMessage({
            id: `msg-${i}`,
            remote_jid: i < 5 ? '111@s.whatsapp.net' : '222@s.whatsapp.net',
            from_me: i % 2 === 0 ? 1 : 0,
            timestamp: 1000 + i,
            message_type: i < 7 ? 'text' : 'image',
            body: `message ${i}`,
            has_media: i >= 7 ? 1 : 0,
          })
        );
      }
    });

    it('returns all messages by default', () => {
      const result = messagesRepo.query({});
      expect(result.total).toBe(10);
      expect(result.data.length).toBe(10);
    });

    it('filters by remote_jid', () => {
      const result = messagesRepo.query({ remote_jid: '111@s.whatsapp.net' });
      expect(result.total).toBe(5);
      expect(result.data.every((m) => m.remote_jid === '111@s.whatsapp.net')).toBe(true);
    });

    it('filters by from_me', () => {
      const result = messagesRepo.query({ from_me: true });
      expect(result.total).toBe(5);
      expect(result.data.every((m) => m.from_me === 1)).toBe(true);
    });

    it('filters by message_type', () => {
      const result = messagesRepo.query({ message_type: 'image' });
      expect(result.total).toBe(3);
    });

    it('filters by a single message_types entry', () => {
      const result = messagesRepo.query({ message_types: ['image'] });
      expect(result.total).toBe(3);
      expect(result.data.every((m) => m.message_type === 'image')).toBe(true);
    });

    it('filters by several message_types at once', () => {
      const result = messagesRepo.query({ message_types: ['text', 'image'] });
      expect(result.total).toBe(10);
      expect(result.data.every((m) => m.message_type === 'text' || m.message_type === 'image')).toBe(true);
    });

    it('counts only the matching types, not every row the other filters left', () => {
      // The count and the page have to agree: `total` is rendered to a model as
      // "N more matches" next to the call that is supposed to fetch them.
      const result = messagesRepo.query({ message_types: ['image'], limit: 1 });
      expect(result.data.length).toBe(1);
      expect(result.total).toBe(3);
    });

    it('treats an empty message_types as no type filter at all', () => {
      const result = messagesRepo.query({ message_types: [] });
      expect(result.total).toBe(10);
    });

    it('returns nothing for a type no message has', () => {
      const result = messagesRepo.query({ message_types: ['sticker'] });
      expect(result.total).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('composes message_types with the other filters', () => {
      const result = messagesRepo.query({
        message_types: ['text', 'image'],
        remote_jid: '222@s.whatsapp.net',
      });
      expect(result.total).toBe(5);
    });

    it('binds the types as parameters rather than splicing them into the SQL', () => {
      const result = messagesRepo.query({ message_types: ["text') OR 1=1 --"] });
      expect(result.total).toBe(0);
    });

    it('filters by text search', () => {
      const result = messagesRepo.query({ search: 'message 3' });
      expect(result.total).toBe(1);
      expect(result.data[0].body).toBe('message 3');
    });

    it('filters by timestamp range', () => {
      const result = messagesRepo.query({ after: 1004, before: 1008 });
      expect(result.total).toBe(3); // timestamps 1005, 1006, 1007
    });

    it('filters by has_media', () => {
      const result = messagesRepo.query({ has_media: true });
      expect(result.total).toBe(3);
    });

    it('paginates with limit and offset', () => {
      const result = messagesRepo.query({ limit: 3, offset: 2 });
      expect(result.data.length).toBe(3);
      expect(result.total).toBe(10);
    });

    it('orders ascending', () => {
      const result = messagesRepo.query({ order: 'asc', limit: 3 });
      expect(result.data[0].timestamp).toBeLessThan(result.data[2].timestamp);
    });

    it('orders descending by default', () => {
      const result = messagesRepo.query({ limit: 3 });
      expect(result.data[0].timestamp).toBeGreaterThan(result.data[2].timestamp);
    });

    it('combines multiple filters', () => {
      const result = messagesRepo.query({
        remote_jid: '111@s.whatsapp.net',
        from_me: true,
        message_type: 'text',
      });
      // Chat 111 has indices 0-4, from_me on evens (0,2,4), all text
      expect(result.total).toBe(3);
    });
  });

  describe('markDeleted', () => {
    it('sets is_deleted flag and deleted_at timestamp', () => {
      messagesRepo.upsert(makeMessage({ id: 'msg-1' }));
      messagesRepo.markDeleted('msg-1');

      const row = messagesRepo.getById('msg-1');
      expect(row!.is_deleted).toBe(1);
      expect(row!.deleted_at).toBeTruthy();
    });
  });

  describe('markEdited', () => {
    it('updates body and sets edit metadata', () => {
      messagesRepo.upsert(makeMessage({ id: 'msg-1', body: 'original' }));
      messagesRepo.markEdited('msg-1', 'edited text');

      const row = messagesRepo.getById('msg-1');
      expect(row!.body).toBe('edited text');
      expect(row!.edit_type).toBe(1);
      expect(row!.edited_at).toBeTruthy();
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      messagesRepo.upsert(makeMessage({ id: 'msg-1', message_type: 'text', has_media: 0 }));
      messagesRepo.upsert(makeMessage({ id: 'msg-2', message_type: 'text', has_media: 0 }));
      messagesRepo.upsert(makeMessage({ id: 'msg-3', message_type: 'image', has_media: 1 }));

      const stats = messagesRepo.getStats();
      expect(stats.total).toBe(3);
      expect(stats.mediaCount).toBe(1);
      expect(stats.byType.length).toBe(2);
    });
  });

  describe('getAnalytics', () => {
    const now = Math.floor(Date.now() / 1000);

    it('aggregates totals, splits and breakdowns', () => {
      messagesRepo.upsert(makeMessage({ id: 'a', from_me: 1, message_type: 'text', body: 'hello world', timestamp: now - 100 }));
      messagesRepo.upsert(makeMessage({ id: 'b', from_me: 0, message_type: 'text', body: 'one two three', timestamp: now - 200 }));
      messagesRepo.upsert(makeMessage({ id: 'c', from_me: 0, message_type: 'image', body: '', has_media: 1, media_mime_type: 'image/jpeg', media_size: 2048, timestamp: now - 300 }));
      messagesRepo.upsert(makeMessage({ id: 'd', from_me: 0, message_type: 'text', body: 'x', is_forwarded: 1, timestamp: now - 400 }));

      const a = messagesRepo.getAnalytics();
      expect(a.totals.total).toBe(4);
      expect(a.totals.sent).toBe(1);
      expect(a.totals.received).toBe(3);
      expect(a.totals.media).toBe(1);
      expect(a.totals.forwarded).toBe(1);
      // "hello world"(2) + "one two three"(3) + "x"(1) = 6
      expect(a.totals.words).toBe(6);
      expect(a.totals.activeDays).toBeGreaterThanOrEqual(1);
      expect(a.byType.find((t) => t.message_type === 'text')!.count).toBe(3);
      expect(a.media.total).toBe(1);
      expect(a.media.totalSize).toBe(2048);
      expect(a.media.byKind[0].kind).toBe('image');
      expect(a.byHour.reduce((s, h) => s + h.count, 0)).toBe(4);
    });

    it('scopes to a single chat when chat is provided', () => {
      const jid = '5511777777777@s.whatsapp.net';
      messagesRepo.upsert(makeMessage({ id: 'in', remote_jid: jid, timestamp: now - 10 }));
      messagesRepo.upsert(makeMessage({ id: 'out', remote_jid: 'other@s.whatsapp.net', timestamp: now - 20 }));

      const a = messagesRepo.getAnalytics({ chat: jid });
      expect(a.totals.total).toBe(1);
      expect(a.byChat.length).toBe(1);
      expect(a.byChat[0].remote_jid).toBe(jid);
    });

    it('respects the trailing-day window', () => {
      messagesRepo.upsert(makeMessage({ id: 'recent', timestamp: now - 3600 }));
      messagesRepo.upsert(makeMessage({ id: 'old', timestamp: now - 40 * 86400 }));

      const a = messagesRepo.getAnalytics({ days: 7 });
      expect(a.totals.total).toBe(1);
      expect(a.range.days).toBe(7);
    });
  });

  describe('stripRawMessages', () => {
    it('includes raw_message when stripRawMessages is false', () => {
      messagesRepo.upsert(makeMessage({ id: 'msg-1', raw_message: '{"key":"value"}' }));
      const row = messagesRepo.getById('msg-1');
      expect(row!.raw_message).toBe('{"key":"value"}');
    });
  });

  describe('getOldestForChat', () => {
    const jid = '5511888888888@s.whatsapp.net';

    it('returns the chronologically oldest message for the chat (the history-sync anchor)', () => {
      messagesRepo.upsert(makeMessage({ id: 'newer', remote_jid: jid, timestamp: 3000 }));
      messagesRepo.upsert(makeMessage({ id: 'oldest', remote_jid: jid, timestamp: 1000, from_me: 1, participant: 'p@s.whatsapp.net' }));
      messagesRepo.upsert(makeMessage({ id: 'middle', remote_jid: jid, timestamp: 2000 }));
      // A message in a different chat must be ignored.
      messagesRepo.upsert(makeMessage({ id: 'other', remote_jid: 'other@s.whatsapp.net', timestamp: 1 }));

      const oldest = messagesRepo.getOldestForChat(jid);
      expect(oldest).toBeDefined();
      expect(oldest!.id).toBe('oldest');
      expect(oldest!.timestamp).toBe(1000);
      expect(!!oldest!.from_me).toBe(true);
      expect(oldest!.participant).toBe('p@s.whatsapp.net');
    });

    it('returns undefined when the chat has no stored messages', () => {
      expect(messagesRepo.getOldestForChat('nobody@s.whatsapp.net')).toBeUndefined();
    });
  });
});
