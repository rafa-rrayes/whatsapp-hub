import { Router, Request, Response } from 'express';
import { messagesRepo } from '../../database/repositories/messages.js';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { groupsRepo } from '../../database/repositories/groups.js';
import { mediaRepo } from '../../database/repositories/media.js';
import { eventsRepo } from '../../database/repositories/events.js';
import { getDb } from '../../database/index.js';
import { clampPagination } from '../../utils/security.js';

const router = Router();

// GET /api/stats — overall dashboard stats
router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    res.json({
      messages: messagesRepo.getStats(),
      contacts: contactsRepo.getCount(),
      groups: groupsRepo.getCount(),
      media: mediaRepo.getStats(),
      calls: (db.prepare('SELECT COUNT(*) as c FROM call_log').get() as any).c,
      chats: (db.prepare('SELECT COUNT(*) as c FROM chats').get() as any).c,
    });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/events — query event audit log
router.get('/events', (req: Request, res: Response) => {
  try {
    const events = eventsRepo.query({
      type: req.query.type as string | undefined,
      limit: clampPagination(req.query.limit, 50, 500),
      offset: clampPagination(req.query.offset, 0, 100000),
      after: req.query.after as string | undefined,
    });
    res.json({ data: events });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/events/types — list all event types with counts
router.get('/events/types', (_req: Request, res: Response) => {
  try {
    res.json({ data: eventsRepo.getEventTypes() });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/events/prune — prune old events
router.delete('/events/prune', (req: Request, res: Response) => {
  try {
    const days = clampPagination(req.query.days, 30, 3650) || 1;
    const deleted = eventsRepo.prune(days);
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
