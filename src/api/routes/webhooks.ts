import { Router } from 'express';
import { getDb } from '../../database/index.js';
import { validateUrlForFetch } from '../../utils/security.js';
import { validate } from '../middleware/validate.js';
import { webhookCreateSchema } from '../schemas.js';
import { asyncHandler, BadRequestError } from '../errors.js';
import { webhookDispatcher } from '../../webhooks/dispatcher.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// GET /api/webhooks — list subscriptions
router.get('/', asyncHandler(async (_req, res) => {
  const db = getDb();
  const webhooks = db.prepare(
    'SELECT id, url, events, is_active, created_at, updated_at, secret IS NOT NULL as has_secret FROM webhook_subscriptions ORDER BY created_at DESC'
  ).all();
  res.json({ data: webhooks });
}));

// POST /api/webhooks — create subscription
router.post('/', validate(webhookCreateSchema), asyncHandler(async (req, res) => {
  const { url, secret, events } = req.body;

  // SSRF protection
  try {
    await validateUrlForFetch(url);
  } catch (e) {
    throw new BadRequestError((e as Error).message);
  }

  const id = uuid();
  const db = getDb();
  db.prepare(`
    INSERT INTO webhook_subscriptions (id, url, secret, events) VALUES (?, ?, ?, ?)
  `).run(id, url, secret || null, events || '*');
  webhookDispatcher.invalidateCache();
  res.json({ success: true, id });
}));

// DELETE /api/webhooks/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').run(req.params.id as string);
  webhookDispatcher.invalidateCache();
  res.json({ success: true, deleted: result.changes > 0 });
}));

// PUT /api/webhooks/:id/toggle
router.put('/:id/toggle', asyncHandler(async (req, res) => {
  const db = getDb();
  db.prepare(`
    UPDATE webhook_subscriptions SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?
  `).run(req.params.id as string);
  webhookDispatcher.invalidateCache();
  res.json({ success: true });
}));

export default router;
