import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb } from '../../test-utils/db.js';
import { makeMedia, resetFixtures } from '../../test-utils/fixtures.js';

let db: Database.Database;

vi.mock('../index.js', () => ({
  getDb: () => db,
}));

const { mediaRepo } = await import('./media.js');

describe('mediaRepo', () => {
  beforeEach(() => {
    db = createTestDb();
    resetFixtures();
  });

  describe('upsert', () => {
    it('inserts a new media record', () => {
      mediaRepo.upsert(makeMedia({ id: 'media-1' }));
      const row = mediaRepo.getById('media-1');
      expect(row).toBeDefined();
      expect(row!.id).toBe('media-1');
      expect(row!.download_status).toBe('pending');
    });

    it('updates on conflict', () => {
      mediaRepo.upsert(makeMedia({ id: 'media-1', download_status: 'pending' }));
      mediaRepo.upsert({ id: 'media-1', file_path: '/path/to/file.jpg', download_status: 'downloaded' });

      const row = mediaRepo.getById('media-1');
      expect(row!.download_status).toBe('downloaded');
      expect(row!.file_path).toBe('/path/to/file.jpg');
    });
  });

  describe('getById', () => {
    it('returns undefined for nonexistent ID', () => {
      expect(mediaRepo.getById('nonexistent')).toBeUndefined();
    });
  });

  describe('getByMessageId', () => {
    it('finds media by message ID', () => {
      mediaRepo.upsert(makeMedia({ id: 'media-1', message_id: 'msg-abc' }));
      const row = mediaRepo.getByMessageId('msg-abc');
      expect(row).toBeDefined();
      expect(row!.id).toBe('media-1');
    });

    it('returns undefined for no match', () => {
      expect(mediaRepo.getByMessageId('no-such-msg')).toBeUndefined();
    });
  });

  describe('getPending', () => {
    it('returns only pending media', () => {
      mediaRepo.upsert(makeMedia({ id: 'm1', download_status: 'pending' }));
      mediaRepo.upsert(makeMedia({ id: 'm2', download_status: 'downloaded' }));
      mediaRepo.upsert(makeMedia({ id: 'm3', download_status: 'pending' }));

      const pending = mediaRepo.getPending();
      expect(pending.length).toBe(2);
      expect(pending.every((m) => m.download_status === 'pending')).toBe(true);
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        mediaRepo.upsert(makeMedia({ id: `m-${i}`, download_status: 'pending' }));
      }
      const pending = mediaRepo.getPending(3);
      expect(pending.length).toBe(3);
    });
  });

  describe('updateStatus', () => {
    it('updates status and error', () => {
      mediaRepo.upsert(makeMedia({ id: 'media-1' }));
      mediaRepo.updateStatus('media-1', 'failed', 'Network error');

      const row = mediaRepo.getById('media-1');
      expect(row!.download_status).toBe('failed');
      expect(row!.download_error).toBe('Network error');
    });

    it('clears error when not provided', () => {
      mediaRepo.upsert(makeMedia({ id: 'media-1' }));
      mediaRepo.updateStatus('media-1', 'failed', 'Error');
      mediaRepo.updateStatus('media-1', 'downloaded');

      const row = mediaRepo.getById('media-1');
      expect(row!.download_status).toBe('downloaded');
      expect(row!.download_error).toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      mediaRepo.upsert(makeMedia({ id: 'm1', download_status: 'downloaded', file_size: 1000, mime_type: 'image/jpeg' }));
      mediaRepo.upsert(makeMedia({ id: 'm2', download_status: 'downloaded', file_size: 2000, mime_type: 'image/jpeg' }));
      mediaRepo.upsert(makeMedia({ id: 'm3', download_status: 'pending', file_size: 500, mime_type: 'video/mp4' }));
      mediaRepo.upsert(makeMedia({ id: 'm4', download_status: 'failed', file_size: 0, mime_type: 'audio/ogg' }));

      const stats = mediaRepo.getStats();
      expect(stats.total).toBe(4);
      expect(stats.downloaded).toBe(2);
      expect(stats.pending).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.totalSize).toBe(3500);
      expect(stats.byType.length).toBe(3);
    });
  });
});
