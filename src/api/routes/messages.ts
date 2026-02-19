import { Router, Request, Response } from 'express';
import { messagesRepo } from '../../database/repositories/messages.js';
import { clampPagination } from '../../utils/security.js';
import { log } from '../../utils/logger.js';

const router = Router();

// GET /api/messages — query messages with filters
router.get('/', (req: Request, res: Response) => {
  try {
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
  } catch (err) {
    log.api.error({ err }, 'messages query failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/messages/search — full-text search
router.get('/search', (req: Request, res: Response) => {
  try {
    const q = req.query.q as string | undefined;
    if (!q) {
      res.status(400).json({ error: 'Missing query parameter "q"' });
      return;
    }
    const result = messagesRepo.query({
      search: q,
      remote_jid: req.query.chat as string | undefined,
      limit: clampPagination(req.query.limit, 50, 500),
      offset: clampPagination(req.query.offset, 0, 100000),
    });
    res.json(result);
  } catch (err) {
    log.api.error({ err }, 'messages search failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/messages/stats — message statistics
router.get('/stats', (_req: Request, res: Response) => {
  try {
    res.json(messagesRepo.getStats());
  } catch (err) {
    log.api.error({ err }, 'messages stats failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/messages/:id — single message by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const msg = messagesRepo.getById(req.params.id as string);
    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    res.json(msg);
  } catch (err) {
    log.api.error({ err }, 'message detail failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
