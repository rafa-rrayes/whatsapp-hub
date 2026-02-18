import { getDb } from '../index.js';

export interface MediaRow {
  id: string;
  message_id?: string;
  mime_type?: string;
  file_size?: number;
  filename?: string;
  original_filename?: string;
  file_path?: string;
  file_hash?: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail_path?: string;
  download_status: string;
  download_error?: string;
  created_at: string;
}

export const mediaRepo = {
  upsert(media: Partial<MediaRow>): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO media (id, message_id, mime_type, file_size, filename, original_filename, file_path, file_hash, width, height, duration, thumbnail_path, download_status, download_error)
      VALUES (@id, @message_id, @mime_type, @file_size, @filename, @original_filename, @file_path, @file_hash, @width, @height, @duration, @thumbnail_path, @download_status, @download_error)
      ON CONFLICT(id) DO UPDATE SET
        file_path = COALESCE(excluded.file_path, media.file_path),
        file_hash = COALESCE(excluded.file_hash, media.file_hash),
        download_status = COALESCE(excluded.download_status, media.download_status),
        download_error = COALESCE(excluded.download_error, media.download_error),
        thumbnail_path = COALESCE(excluded.thumbnail_path, media.thumbnail_path)
    `).run({
      id: media.id,
      message_id: media.message_id || null,
      mime_type: media.mime_type || null,
      file_size: media.file_size || null,
      filename: media.filename || null,
      original_filename: media.original_filename || null,
      file_path: media.file_path || null,
      file_hash: media.file_hash || null,
      width: media.width || null,
      height: media.height || null,
      duration: media.duration || null,
      thumbnail_path: media.thumbnail_path || null,
      download_status: media.download_status || 'pending',
      download_error: media.download_error || null,
    });
  },

  getById(id: string): MediaRow | undefined {
    return getDb().prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  },

  getByMessageId(messageId: string): MediaRow | undefined {
    return getDb().prepare('SELECT * FROM media WHERE message_id = ?').get(messageId) as MediaRow | undefined;
  },

  getPending(limit = 20): MediaRow[] {
    return getDb()
      .prepare('SELECT * FROM media WHERE download_status = ? ORDER BY created_at LIMIT ?')
      .all('pending', limit) as MediaRow[];
  },

  updateStatus(id: string, status: string, error?: string): void {
    getDb()
      .prepare('UPDATE media SET download_status = ?, download_error = ? WHERE id = ?')
      .run(status, error || null, id);
  },

  getStats(): any {
    const db = getDb();
    return {
      total: (db.prepare('SELECT COUNT(*) as c FROM media').get() as any).c,
      downloaded: (db.prepare("SELECT COUNT(*) as c FROM media WHERE download_status = 'downloaded'").get() as any).c,
      pending: (db.prepare("SELECT COUNT(*) as c FROM media WHERE download_status = 'pending'").get() as any).c,
      failed: (db.prepare("SELECT COUNT(*) as c FROM media WHERE download_status = 'failed'").get() as any).c,
      totalSize: (db.prepare('SELECT COALESCE(SUM(file_size), 0) as s FROM media').get() as any).s,
      byType: db.prepare('SELECT mime_type, COUNT(*) as count FROM media GROUP BY mime_type ORDER BY count DESC').all(),
    };
  },
};
