import { Router, Request, Response } from 'express';
import { chatsRepo } from '../../database/repositories/chats.js';
import { messagesRepo } from '../../database/repositories/messages.js';
import { clampPagination, isValidJid } from '../../utils/security.js';

const router = Router();

// GET /api/chats — list all chats
router.get('/', (req: Request, res: Response) => {
  try {
    const chats = chatsRepo.getAll({
      search: req.query.search as string | undefined,
      limit: clampPagination(req.query.limit, 100, 500),
      offset: clampPagination(req.query.offset, 0, 100000),
    });
    res.json({ data: chats, total: chats.length });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/chats/:jid — single chat with recent messages
router.get('/:jid', (req: Request, res: Response) => {
  try {
    const chat = chatsRepo.getByJid(req.params.jid as string);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }
    const recentMessages = messagesRepo.query({
      remote_jid: req.params.jid as string,
      limit: 20,
      order: 'desc',
    });
    res.json({ ...chat, recent_messages: recentMessages.data });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
