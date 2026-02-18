import { Router, Request, Response } from 'express';
import { mediaRepo } from '../../database/repositories/media.js';
import { mediaManager } from '../../media/manager.js';
import { sanitizeFilename } from '../../utils/security.js';
import { config } from '../../config.js';
import fs from 'fs';
import path from 'path';

const router = Router();

// GET /api/media/stats — media statistics
router.get('/stats', (_req: Request, res: Response) => {
  try {
    res.json(mediaRepo.getStats());
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/media/:id — media metadata
router.get('/:id', (req: Request, res: Response) => {
  try {
    const media = mediaRepo.getById(req.params.id as string);
    if (!media) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }
    res.json(media);
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/media/:id/download — download the actual media file
router.get('/:id/download', (req: Request, res: Response) => {
  try {
    const media = mediaRepo.getById(req.params.id as string);
    if (!media) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }
    if (!media.file_path || media.download_status !== 'downloaded') {
      res.status(404).json({ error: 'Media file not available', status: media.download_status });
      return;
    }

    const fullPath = mediaManager.getMediaPath(media.file_path);

    // Path traversal check
    if (!path.resolve(fullPath).startsWith(path.resolve(config.mediaDir))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Media file missing from disk' });
      return;
    }

    res.setHeader('Content-Type', media.mime_type || 'application/octet-stream');
    if (media.original_filename) {
      const safe = sanitizeFilename(media.original_filename);
      res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
    }
    res.sendFile(path.resolve(fullPath));
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/media/by-message/:messageId — get media by message ID
router.get('/by-message/:messageId', (req: Request, res: Response) => {
  try {
    const media = mediaRepo.getByMessageId(req.params.messageId as string);
    if (!media) {
      res.status(404).json({ error: 'No media for this message' });
      return;
    }
    res.json(media);
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
