import { Router } from 'express';
import { chatsRepo } from '../../database/repositories/chats.js';
import { messagesRepo } from '../../database/repositories/messages.js';
import { clampPagination, isValidJid } from '../../utils/security.js';
import { asyncHandler, NotFoundError, BadRequestError } from '../errors.js';

const router = Router();

// GET /api/chats — list all chats
router.get('/', asyncHandler(async (req, res) => {
  const chats = chatsRepo.getAll({
    search: req.query.search as string | undefined,
    limit: clampPagination(req.query.limit, 100, 500),
    offset: clampPagination(req.query.offset, 0, 100000),
  });
  res.json({ data: chats, total: chats.length });
}));

// GET /api/chats/:jid — single chat with recent messages
router.get('/:jid', asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const chat = chatsRepo.getByJid(req.params.jid as string);
  if (!chat) {
    throw new NotFoundError('Chat not found');
  }
  const recentMessages = messagesRepo.query({
    remote_jid: req.params.jid as string,
    limit: 20,
    order: 'desc',
  });
  res.json({ ...chat, recent_messages: recentMessages.data });
}));

export default router;
