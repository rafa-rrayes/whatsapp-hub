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

  describe('stripRawMessages', () => {
    it('includes raw_message when stripRawMessages is false', () => {
      messagesRepo.upsert(makeMessage({ id: 'msg-1', raw_message: '{"key":"value"}' }));
      const row = messagesRepo.getById('msg-1');
      expect(row!.raw_message).toBe('{"key":"value"}');
    });
  });
});
