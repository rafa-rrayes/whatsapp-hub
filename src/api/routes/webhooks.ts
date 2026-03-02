import { Router } from 'express';
import { getDb } from '../../database/index.js';
import { validateUrlForFetch } from '../../utils/security.js';
import { validate } from '../middleware/validate.js';
import { webhookCreateSchema } from '../schemas.js';
import { asyncHandler, BadRequestError, NotFoundError } from '../errors.js';
import { clampPagination } from '../../utils/security.js';
import { webhookDispatcher } from '../../webhooks/dispatcher.js';
import { config } from '../../config.js';
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

  // Encrypt secret at rest if enabled
  let storedSecret = secret || null;
  if (storedSecret && config.security.encryptWebhookSecrets && config.security.encryptionKey) {
    const { encryptWebhookSecret } = await import('../../utils/encryption.js');
    storedSecret = encryptWebhookSecret(storedSecret);
  }

  const id = uuid();
  const db = getDb();
  db.prepare(`
    INSERT INTO webhook_subscriptions (id, url, secret, events) VALUES (?, ?, ?, ?)
  `).run(id, url, storedSecret, events || '*');
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

// GET /api/webhooks/deliveries — query delivery log
router.get('/deliveries', asyncHandler(async (req, res) => {
  const db = getDb();
  const q = req.query;
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (q.subscription_id) {
    conditions.push('subscription_id = @subscription_id');
    params.subscription_id = q.subscription_id as string;
  }
  if (q.status) {
    conditions.push('status = @status');
    params.status = q.status as string;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = clampPagination(q.limit, 50, 500);
  const offset = clampPagination(q.offset, 0, 100000);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM webhook_delivery_log ${where}`).get(params) as { c: number }).c;
  const data = db.prepare(`SELECT * FROM webhook_delivery_log ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  res.json({ data, total });
}));

// POST /api/webhooks/deliveries/:id/retry — manually retry a failed delivery
router.post('/deliveries/:id/retry', asyncHandler(async (req, res) => {
  const result = await webhookDispatcher.retryDelivery(req.params.id as string);
  if (result.error === 'Delivery not found') {
    throw new NotFoundError('Delivery not found');
  }
  res.json(result);
}));

export default router;
