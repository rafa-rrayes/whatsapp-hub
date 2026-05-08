import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import { mediaManager } from '../media/manager.js';
import { config } from '../config.js';
import { log } from '../utils/logger.js';
import type { ExportContext, SelectedChat, SelectedMessage } from './types.js';

interface AttachableMedia {
  id: string;
  filePath: string;
  mime?: string;
  size: number;
  archiveName: string;
}

function attachableFromMessage(msg: SelectedMessage, ctx: ExportContext): AttachableMedia | null {
  const mr = msg.media_row;
  if (!mr || mr.download_status !== 'downloaded' || !mr.file_path || !mr.id) return null;

  const opts = ctx.options;
  const cat = (mr.mime_type || '').split('/')[0];
  if (opts.media_types && opts.media_types.length > 0) {
    const mappedCat = mr.mime_type === 'image/webp' ? 'sticker' : (cat === 'image' || cat === 'video' || cat === 'audio' ? cat : 'document');
    if (!opts.media_types.includes(mappedCat as 'image' | 'video' | 'audio' | 'sticker' | 'document')) return null;
  }
  const maxBytes = opts.max_media_size_mb * 1024 * 1024;
  if (maxBytes > 0 && mr.file_size && mr.file_size > maxBytes) return null;

  const fullPath = mediaManager.getMediaPath(mr.file_path);
  // Path traversal guard
  if (!path.resolve(fullPath).startsWith(path.resolve(config.mediaDir))) return null;
  if (!fs.existsSync(fullPath)) return null;

  const original = mr.original_filename || mr.filename;
  const safeBase = original
    ? original.replace(/[^a-zA-Z0-9._-]+/g, '_')
    : `${mr.id}.bin`;
  const archiveName = `media/${mr.id}-${safeBase}`;

  return {
    id: mr.id,
    filePath: fullPath,
    mime: mr.mime_type,
    size: mr.file_size || 0,
    archiveName,
  };
}

/** Stream a zip containing the rendered markdown + media files into res. */
export function streamZip(
  markdown: string,
  selectedChats: SelectedChat[],
  messagesByChat: Map<string, SelectedMessage[]>,
  ctx: ExportContext,
  res: Response
): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    let bytesWritten = 0;
    const maxBundleBytes = 500 * 1024 * 1024; // 500 MB cap

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        log.api.warn({ err }, 'zip-bundler: file missing');
      } else {
        reject(err);
      }
    });
    archive.on('error', reject);
    archive.on('end', () => resolve());

    archive.pipe(res);

    archive.append(markdown, { name: 'export.md' });

    const seen = new Set<string>();
    for (const sc of selectedChats) {
      const msgs = messagesByChat.get(sc.chat.jid) || [];
      for (const msg of msgs) {
        const m = attachableFromMessage(msg, ctx);
        if (!m) continue;
        if (seen.has(m.archiveName)) continue;
        if (bytesWritten + m.size > maxBundleBytes) {
          log.api.warn({ jid: sc.chat.jid, mediaId: m.id }, 'zip-bundler: cap reached, skipping further media');
          break;
        }
        seen.add(m.archiveName);
        bytesWritten += m.size;
        archive.file(m.filePath, { name: m.archiveName });
      }
    }

    archive.finalize();
  });
}
