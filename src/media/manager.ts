import { proto, WAMessage } from '@whiskeysockets/baileys';
import { connectionManager } from '../connection/manager.js';
import { mediaRepo } from '../database/repositories/media.js';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mime from 'mime-types';

class MediaManager {
  private readonly MAX_QUEUE_SIZE = 5000;
  private queue: Array<{ mediaId: string; msg: WAMessage }> = [];
  private processing = false;

  constructor() {
    // Ensure media directory exists
    if (!fs.existsSync(config.mediaDir)) {
      fs.mkdirSync(config.mediaDir, { recursive: true, mode: 0o750 });
    }
  }

  queueDownload(mediaId: string, msg: WAMessage): void {
    if (!config.autoDownloadMedia) {
      mediaRepo.upsert({
        id: mediaId,
        message_id: msg.key?.id || undefined,
        download_status: 'skipped',
      });
      return;
    }

    const innerMsg = msg.message;
    const media =
      innerMsg?.imageMessage ||
      innerMsg?.videoMessage ||
      innerMsg?.audioMessage ||
      innerMsg?.documentMessage ||
      innerMsg?.stickerMessage ||
      innerMsg?.documentWithCaptionMessage?.message?.documentMessage;

    const fileSize = media ? Number((media as any).fileLength || 0) : 0;
    const maxBytes = config.maxMediaSizeMB * 1024 * 1024;

    if (maxBytes > 0 && fileSize > maxBytes) {
      mediaRepo.upsert({
        id: mediaId,
        message_id: msg.key?.id || undefined,
        mime_type: (media as any)?.mimetype,
        file_size: fileSize,
        original_filename: (media as any)?.fileName,
        download_status: 'skipped',
        download_error: `File size ${Math.round(fileSize / 1024 / 1024)}MB exceeds max ${config.maxMediaSizeMB}MB`,
      });
      return;
    }

    mediaRepo.upsert({
      id: mediaId,
      message_id: msg.key?.id || undefined,
      mime_type: (media as any)?.mimetype,
      file_size: fileSize,
      original_filename: (media as any)?.fileName,
      width: (media as any)?.width ? Number((media as any).width) : undefined,
      height: (media as any)?.height ? Number((media as any).height) : undefined,
      duration: (media as any)?.seconds ? Number((media as any).seconds) : undefined,
      download_status: 'pending',
    });

    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      console.warn(`[Media] Download queue full (${this.MAX_QUEUE_SIZE}), dropping new item`);
      return;
    }

    this.queue.push({ mediaId, msg });
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await this.downloadMedia(item.mediaId, item.msg);
      } catch (err) {
        console.error(`[Media] Failed to download ${item.mediaId}:`, err);
        mediaRepo.updateStatus(item.mediaId, 'failed', String(err));
      }

      // Small delay between downloads to avoid rate limiting
      await new Promise((r) => setTimeout(r, 200));
    }

    this.processing = false;
  }

  private async downloadMedia(mediaId: string, msg: WAMessage): Promise<void> {
    const buffer = await connectionManager.downloadMedia(msg);

    const innerMsg = msg.message;
    const media =
      innerMsg?.imageMessage ||
      innerMsg?.videoMessage ||
      innerMsg?.audioMessage ||
      innerMsg?.documentMessage ||
      innerMsg?.stickerMessage ||
      innerMsg?.documentWithCaptionMessage?.message?.documentMessage;

    const mimeType = (media as any)?.mimetype || 'application/octet-stream';
    const ext = mime.extension(mimeType) || 'bin';

    // Create date-based subdirectory
    const now = new Date();
    const dateDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    const fullDir = path.join(config.mediaDir, dateDir);
    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true, mode: 0o750 });
    }

    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const filename = `${mediaId.slice(0, 8)}_${hash}.${ext}`;
    const relativePath = path.join(dateDir, filename);
    const fullPath = path.join(config.mediaDir, relativePath);

    fs.writeFileSync(fullPath, buffer);

    mediaRepo.upsert({
      id: mediaId,
      file_path: relativePath,
      filename,
      file_hash: hash,
      file_size: buffer.length,
      download_status: 'downloaded',
    });

    console.log(`[Media] Downloaded: ${relativePath} (${Math.round(buffer.length / 1024)}KB)`);
  }

  getMediaPath(relativePath: string): string {
    return path.join(config.mediaDir, relativePath);
  }

  getMediaDir(): string {
    return config.mediaDir;
  }
}

export const mediaManager = new MediaManager();
