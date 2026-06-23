import { Router } from 'express';
import { messagesRepo } from '../../database/repositories/messages.js';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { groupsRepo } from '../../database/repositories/groups.js';
import { mediaRepo } from '../../database/repositories/media.js';
import { eventsRepo } from '../../database/repositories/events.js';
import { getDb } from '../../database/index.js';
import { clampPagination } from '../../utils/security.js';
import { getRecentLogs } from '../../utils/log-buffer.js';
import { asyncHandler } from '../errors.js';

const router = Router();

// GET /api/stats — overall dashboard stats
router.get('/', asyncHandler(async (_req, res) => {
  const db = getDb();
  res.json({
    messages: messagesRepo.getStats(),
    contacts: contactsRepo.getCount(),
    groups: groupsRepo.getCount(),
    media: mediaRepo.getStats(),
    calls: (db.prepare('SELECT COUNT(*) as c FROM call_log').get() as { c: number }).c,
    chats: (db.prepare('SELECT COUNT(*) as c FROM chats').get() as { c: number }).c,
  });
}));

// GET /api/stats/analytics — rich message analytics for the Statistics dashboard.
// Optional query params: chat (jid), days (trailing window; omit for all-time).
router.get('/analytics', asyncHandler(async (req, res) => {
  const chat = (req.query.chat as string | undefined) || undefined;
  const daysRaw = req.query.days ? parseInt(req.query.days as string, 10) : NaN;
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 3650) : undefined;
  res.json(messagesRepo.getAnalytics({ chat, days }));
}));

// GET /api/events — query event audit log
router.get('/events', asyncHandler(async (req, res) => {
  const events = eventsRepo.query({
    type: req.query.type as string | undefined,
    limit: clampPagination(req.query.limit, 50, 500),
    offset: clampPagination(req.query.offset, 0, 100000),
    after: req.query.after as string | undefined,
  });
  res.json({ data: events });
}));

// GET /api/events/types — list all event types with counts
router.get('/events/types', asyncHandler(async (_req, res) => {
  res.json({ data: eventsRepo.getEventTypes() });
}));

// DELETE /api/events/prune — prune old events
router.delete('/events/prune', asyncHandler(async (req, res) => {
  const days = clampPagination(req.query.days, 30, 3650) || 1;
  const deleted = eventsRepo.prune(days);
  res.json({ success: true, deleted });
}));

// GET /api/stats/logs — recent application/container log lines (in-memory ring buffer)
router.get('/logs', asyncHandler(async (req, res) => {
  const limit = clampPagination(req.query.limit, 500, 2000) || 500;
  res.json({ data: getRecentLogs(limit) });
}));

export default router;
