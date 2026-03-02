import { proto, WAMessage } from '@whiskeysockets/baileys';
import { connectionManager } from '../connection/manager.js';
import { mediaRepo } from '../database/repositories/media.js';
import { config } from '../config.js';
import { getSettings } from '../settings.js';
import { log } from '../utils/logger.js';
import type { MediaMessageFields } from '../events/types.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mime from 'mime-types';

/** Retry delays in milliseconds: 5s, 30s, 120s */
const RETRY_DELAYS = [5000, 30000, 120000];
const MAX_RETRIES = 3;

interface QueueItem {
  mediaId: string;
  msg: WAMessage;
  retryCount: number;
}

class MediaManager {
  private readonly MAX_QUEUE_SIZE = 5000;
  private queue: QueueItem[] = [];
  private processing = false;

  constructor() {
    // Ensure media directory exists
    if (!fs.existsSync(config.mediaDir)) {
      fs.mkdirSync(config.mediaDir, { recursive: true, mode: 0o750 });
    }
  }

  queueDownload(mediaId: string, msg: WAMessage): void {
    if (!getSettings().autoDownloadMedia) {
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

    const m = media as MediaMessageFields | undefined;
    const fileSize = m ? Number(m.fileLength || 0) : 0;
    const maxMB = getSettings().maxMediaSizeMB;
    const maxBytes = maxMB * 1024 * 1024;

    if (maxBytes > 0 && fileSize > maxBytes) {
      mediaRepo.upsert({
        id: mediaId,
        message_id: msg.key?.id || undefined,
        mime_type: m?.mimetype ?? undefined,
        file_size: fileSize,
        original_filename: m?.fileName ?? undefined,
        download_status: 'skipped',
        download_error: `File size ${Math.round(fileSize / 1024 / 1024)}MB exceeds max ${maxMB}MB`,
      });
      return;
    }

    mediaRepo.upsert({
      id: mediaId,
      message_id: msg.key?.id || undefined,
      mime_type: m?.mimetype ?? undefined,
      file_size: fileSize,
      original_filename: m?.fileName ?? undefined,
      width: m?.width ? Number(m.width) : undefined,
      height: m?.height ? Number(m.height) : undefined,
      duration: m?.seconds ? Number(m.seconds) : undefined,
      download_status: 'pending',
    });

    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      log.media.warn({ maxSize: this.MAX_QUEUE_SIZE }, 'Download queue full, dropping new item');
      return;
    }

    this.queue.push({ mediaId, msg, retryCount: 0 });
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
        const newRetryCount = item.retryCount + 1;
        if (newRetryCount < MAX_RETRIES) {
          const delay = RETRY_DELAYS[Math.min(newRetryCount - 1, RETRY_DELAYS.length - 1)];
          log.media.warn({ err, mediaId: item.mediaId, retry: newRetryCount, delayMs: delay }, 'Media download failed, scheduling retry');
          mediaRepo.updateStatus(item.mediaId, 'pending', `Retry ${newRetryCount}/${MAX_RETRIES}: ${String(err)}`);
          // Re-queue after delay
          setTimeout(() => {
            if (this.queue.length < this.MAX_QUEUE_SIZE) {
              this.queue.push({ ...item, retryCount: newRetryCount });
              this.processQueue();
            }
          }, delay);
        } else {
          log.media.error({ err, mediaId: item.mediaId, attempts: newRetryCount }, 'Media download failed after all retries');
          mediaRepo.updateStatus(item.mediaId, 'failed', String(err));
        }
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

    const m = media as MediaMessageFields | undefined;
    const mimeType = m?.mimetype || 'application/octet-stream';
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

    log.media.info({ path: relativePath, sizeKB: Math.round(buffer.length / 1024) }, 'Downloaded media');
  }

  /** Manually retry downloading a failed media item by reconstructing from the stored raw_message. */
  async retryDownload(mediaId: string): Promise<{ success: boolean; error?: string }> {
    const mediaRow = mediaRepo.getById(mediaId);
    if (!mediaRow) return { success: false, error: 'Media not found' };
    if (mediaRow.download_status === 'downloaded') return { success: false, error: 'Media already downloaded' };

    if (!mediaRow.message_id) return { success: false, error: 'No linked message' };

    // Get the raw message from the messages table
    try {
      const { messagesRepo } = await import('../database/repositories/messages.js');
      const msg = messagesRepo.getByIdInternal(mediaRow.message_id);
      if (!msg?.raw_message) return { success: false, error: 'Raw message not available (may have been stripped)' };

      const waMsg: WAMessage = JSON.parse(msg.raw_message);
      mediaRepo.updateStatus(mediaId, 'pending');
      this.queue.push({ mediaId, msg: waMsg, retryCount: 0 });
      this.processQueue();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  getMediaPath(relativePath: string): string {
    return path.join(config.mediaDir, relativePath);
  }

  getMediaDir(): string {
    return config.mediaDir;
  }
}

export const mediaManager = new MediaManager();
