import { Router, Request, Response } from 'express';
import { getDb } from '../../database/index.js';
import { validateUrlForFetch } from '../../utils/security.js';
import { validate } from '../middleware/validate.js';
import { webhookCreateSchema } from '../schemas.js';
import { log } from '../../utils/logger.js';
import { webhookDispatcher } from '../../webhooks/dispatcher.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// GET /api/webhooks — list subscriptions
router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const webhooks = db.prepare(
      'SELECT id, url, events, is_active, created_at, updated_at, secret IS NOT NULL as has_secret FROM webhook_subscriptions ORDER BY created_at DESC'
    ).all();
    res.json({ data: webhooks });
  } catch (err) {
    log.api.error({ err }, 'webhooks list failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/webhooks — create subscription
router.post('/', validate(webhookCreateSchema), async (req: Request, res: Response) => {
  try {
    const { url, secret, events } = req.body;

    // SSRF protection
    try {
      await validateUrlForFetch(url);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }

    const id = uuid();
    const db = getDb();
    db.prepare(`
      INSERT INTO webhook_subscriptions (id, url, secret, events) VALUES (?, ?, ?, ?)
    `).run(id, url, secret || null, events || '*');
    webhookDispatcher.invalidateCache();
    res.json({ success: true, id });
  } catch (err) {
    log.api.error({ err }, 'webhook create failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/webhooks/:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').run(req.params.id as string);
    webhookDispatcher.invalidateCache();
    res.json({ success: true, deleted: result.changes > 0 });
  } catch (err) {
    log.api.error({ err }, 'webhook delete failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/webhooks/:id/toggle
router.put('/:id/toggle', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`
      UPDATE webhook_subscriptions SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?
    `).run(req.params.id as string);
    webhookDispatcher.invalidateCache();
    res.json({ success: true });
  } catch (err) {
    log.api.error({ err }, 'webhook toggle failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
