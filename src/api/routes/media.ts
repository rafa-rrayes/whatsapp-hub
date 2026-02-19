import { Router } from 'express';
import { mediaRepo } from '../../database/repositories/media.js';
import { mediaManager } from '../../media/manager.js';
import { sanitizeFilename } from '../../utils/security.js';
import { config } from '../../config.js';
import { asyncHandler, NotFoundError, ForbiddenError } from '../errors.js';
import fs from 'fs';
import path from 'path';

const router = Router();

// GET /api/media/stats — media statistics
router.get('/stats', asyncHandler(async (_req, res) => {
  res.json(mediaRepo.getStats());
}));

// GET /api/media/:id — media metadata
router.get('/:id', asyncHandler(async (req, res) => {
  const media = mediaRepo.getById(req.params.id as string);
  if (!media) {
    throw new NotFoundError('Media not found');
  }
  res.json(media);
}));

// GET /api/media/:id/download — download the actual media file
router.get('/:id/download', asyncHandler(async (req, res) => {
  const media = mediaRepo.getById(req.params.id as string);
  if (!media) {
    throw new NotFoundError('Media not found');
  }
  if (!media.file_path || media.download_status !== 'downloaded') {
    throw new NotFoundError('Media file not available');
  }

  const fullPath = mediaManager.getMediaPath(media.file_path);

  // Path traversal check
  if (!path.resolve(fullPath).startsWith(path.resolve(config.mediaDir))) {
    throw new ForbiddenError('Access denied');
  }

  if (!fs.existsSync(fullPath)) {
    throw new NotFoundError('Media file missing from disk');
  }

  res.setHeader('Content-Type', media.mime_type || 'application/octet-stream');
  if (media.original_filename) {
    const safe = sanitizeFilename(media.original_filename);
    res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
  }
  res.sendFile(path.resolve(fullPath));
}));

// GET /api/media/by-message/:messageId — get media by message ID
router.get('/by-message/:messageId', asyncHandler(async (req, res) => {
  const media = mediaRepo.getByMessageId(req.params.messageId as string);
  if (!media) {
    throw new NotFoundError('No media for this message');
  }
  res.json(media);
}));

export default router;
