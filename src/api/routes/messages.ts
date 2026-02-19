import { Router } from 'express';
import { messagesRepo } from '../../database/repositories/messages.js';
import { clampPagination } from '../../utils/security.js';
import { asyncHandler, NotFoundError, BadRequestError } from '../errors.js';

const router = Router();

// GET /api/messages — query messages with filters
router.get('/', asyncHandler(async (req, res) => {
  const q = req.query;
  const result = messagesRepo.query({
    remote_jid: q.chat as string | undefined,
    from_jid: q.from as string | undefined,
    from_me: q.from_me !== undefined ? q.from_me === 'true' : undefined,
    message_type: q.type as string | undefined,
    search: q.search as string | undefined,
    before: q.before ? Number(q.before) : undefined,
    after: q.after ? Number(q.after) : undefined,
    has_media: q.has_media !== undefined ? q.has_media === 'true' : undefined,
    limit: clampPagination(q.limit, 50, 500),
    offset: clampPagination(q.offset, 0, 100000),
    order: (q.order as 'asc' | 'desc') || 'desc',
  });
  res.json(result);
}));

// GET /api/messages/search — full-text search
router.get('/search', asyncHandler(async (req, res) => {
  const q = req.query.q as string | undefined;
  if (!q) {
    throw new BadRequestError('Missing query parameter "q"');
  }
  const result = messagesRepo.query({
    search: q,
    remote_jid: req.query.chat as string | undefined,
    limit: clampPagination(req.query.limit, 50, 500),
    offset: clampPagination(req.query.offset, 0, 100000),
  });
  res.json(result);
}));

// GET /api/messages/stats — message statistics
router.get('/stats', asyncHandler(async (_req, res) => {
  res.json(messagesRepo.getStats());
}));

// GET /api/messages/:id — single message by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const msg = messagesRepo.getById(req.params.id as string);
  if (!msg) {
    throw new NotFoundError('Message not found');
  }
  res.json(msg);
}));

export default router;
