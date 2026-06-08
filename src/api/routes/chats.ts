import { Router } from 'express';
import { chatsRepo } from '../../database/repositories/chats.js';
import { messagesRepo } from '../../database/repositories/messages.js';
import { connectionManager } from '../../connection/manager.js';
import { clampPagination, isValidJid } from '../../utils/security.js';
import { validate } from '../middleware/validate.js';
import { syncHistorySchema } from '../schemas.js';
import { asyncHandler, NotFoundError, BadRequestError } from '../errors.js';
import { toApiChat, toApiMessage } from '../../types/mappers.js';
import { emitSyncStarted, emitSyncRequested, emitSyncFinished } from '../../events/sync-progress.js';
import { v4 as uuid } from 'uuid';

const router = Router();

/**
 * Request older message history for a single chat, anchored on the oldest
 * message we already have stored (Baileys walks backwards from that cursor).
 * Returns null when there's no stored message to anchor the cursor on.
 */
async function syncOneChat(jid: string, count: number) {
  const oldest = messagesRepo.getOldestForChat(jid);
  if (!oldest) return null;
  const key = { remoteJid: jid, id: oldest.id, fromMe: !!oldest.from_me, participant: oldest.participant || undefined };
  const requestId = await connectionManager.requestHistorySync(key, oldest.timestamp, count);
  return { requestId, cursor: { id: oldest.id, timestamp: oldest.timestamp } };
}

// GET /api/chats — list all chats
router.get('/', asyncHandler(async (req, res) => {
  const chats = chatsRepo.getAll({
    search: req.query.search as string | undefined,
    limit: clampPagination(req.query.limit, 100, 500),
    offset: clampPagination(req.query.offset, 0, 100000),
  });
  res.json({ data: chats.map(toApiChat), total: chats.length });
}));

// POST /api/chats/sync-history — request older history for ALL chats (bulk).
// Registered before the /:jid routes so the literal path isn't captured by :jid.
router.post('/sync-history', asyncHandler(async (_req, res) => {
  const count = 50;
  const allChats = chatsRepo.getAll({ limit: 10000 });
  const sessionId = uuid();

  // Announce the run so the dashboard can open its progress panel before the
  // (throttled) loop below — which holds this request open for ~N×600ms — finishes.
  emitSyncStarted({ sessionId, scope: 'all', total: allChats.length, count });

  let requested = 0;
  let skipped = 0;
  let processed = 0;

  for (const chat of allChats) {
    const result = await syncOneChat(chat.jid, count);
    if (result) requested++;
    else skipped++;
    processed++;
    emitSyncRequested({
      sessionId,
      jid: chat.jid,
      didRequest: !!result,
      processed,
      total: allChats.length,
      requested,
      skipped,
    });
    // Throttle so we don't flood WhatsApp with history requests.
    await new Promise((r) => setTimeout(r, 600));
  }

  emitSyncFinished({ sessionId, requested, skipped, total: allChats.length });

  res.json({ success: true, requested, skipped, total: allChats.length });
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

// POST /api/chats/:jid/sync-history — request older history for a single chat
router.post('/:jid/sync-history', validate(syncHistorySchema), asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const jid = req.params.jid as string;
  const count = req.body.count ?? 50;
  const result = await syncOneChat(jid, count);
  if (!result) {
    throw new BadRequestError('No messages stored for this chat yet to anchor history sync');
  }

  // Drive the same progress panel as the bulk path (a single-chat, single-row run).
  const sessionId = uuid();
  emitSyncStarted({ sessionId, scope: 'chat', total: 1, count });
  emitSyncRequested({ sessionId, jid, didRequest: true, processed: 1, total: 1, requested: 1, skipped: 0 });
  emitSyncFinished({ sessionId, requested: 1, skipped: 0, total: 1 });

  res.json({ success: true, jid, ...result });
}));

export default router;
