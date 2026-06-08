import { Router } from 'express';
import { chatsRepo } from '../../database/repositories/chats.js';
import { messagesRepo } from '../../database/repositories/messages.js';
import { connectionManager } from '../../connection/manager.js';
import { clampPagination, isValidJid } from '../../utils/security.js';
import { validate } from '../middleware/validate.js';
import { syncHistorySchema } from '../schemas.js';
import { asyncHandler, NotFoundError, BadRequestError, NotConnectedError, ConflictError } from '../errors.js';
import { toApiChat, toApiMessage } from '../../types/mappers.js';
import { startHistorySync, DEFAULT_TARGET, MAX_TARGET } from '../../sync/history-sync.js';
import { normalizeJid } from '../../utils/jid.js';

const router = Router();

// GET /api/chats — list all chats
router.get('/', asyncHandler(async (req, res) => {
  const chats = chatsRepo.getAll({
    search: req.query.search as string | undefined,
    limit: clampPagination(req.query.limit, 100, 500),
    offset: clampPagination(req.query.offset, 0, 100000),
  });
  res.json({ data: chats.map(toApiChat), total: chats.length });
}));

// POST /api/chats/sync-history — depth-first older-history sync for ALL chats.
// Registered before the /:jid routes so the literal path isn't captured by :jid.
// Kicks off a background runner and returns immediately; progress streams over
// the WebSocket as `history.sync.*` events (the dashboard's sync panel).
router.post('/sync-history', asyncHandler(async (req, res) => {
  if (connectionManager.getStatus() !== 'connected') {
    throw new NotConnectedError();
  }
  const target = Math.min(MAX_TARGET, Math.max(1, Math.floor(Number(req.body?.count) || DEFAULT_TARGET)));
  const allChats = chatsRepo.getAll({ limit: 10000 });
  const result = startHistorySync({ scope: 'all', jids: allChats.map((c) => c.jid), target });
  if (!result.started) {
    throw new ConflictError('A history sync is already running');
  }
  res.json({ success: true, sessionId: result.sessionId, total: result.total, target });
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
  res.json({ ...toApiChat(chat), recent_messages: recentMessages.data.map(toApiMessage) });
}));

// POST /api/chats/:jid/sync-history — depth-first older-history sync for one chat.
router.post('/:jid/sync-history', validate(syncHistorySchema), asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  if (connectionManager.getStatus() !== 'connected') {
    throw new NotConnectedError();
  }
  const jid = req.params.jid as string;
  const target = Math.min(MAX_TARGET, Math.max(1, Math.floor(Number(req.body?.count) || DEFAULT_TARGET)));
  // Fail fast (parity with the old behavior) when there's no stored message to
  // anchor the history cursor on.
  if (!messagesRepo.getOldestForChat(normalizeJid(jid))) {
    throw new BadRequestError('No messages stored for this chat yet to anchor history sync');
  }
  const result = startHistorySync({ scope: 'chat', jids: [jid], target });
  if (!result.started) {
    throw new ConflictError('A history sync is already running');
  }
  res.json({ success: true, sessionId: result.sessionId, jid, target });
}));

export default router;
