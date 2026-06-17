import { Router } from 'express';
import { getDb } from '../../database/index.js';
import { connectionManager } from '../../connection/manager.js';
import { isValidJid } from '../../utils/security.js';
import { resolveToPhoneJid, resolveToLid } from '../../utils/jid.js';
import { validate } from '../middleware/validate.js';
import { presenceSubscribeSchema } from '../schemas.js';
import { asyncHandler, BadRequestError } from '../errors.js';

const router = Router();

// POST /api/presence/subscribe — start receiving presence.update events for a
// JID (Baileys only emits them after an explicit subscription).
router.post('/subscribe', validate(presenceSubscribeSchema), asyncHandler(async (req, res) => {
  await connectionManager.presenceSubscribe(req.body.jid as string);
  res.json({ success: true });
}));

// GET /api/presence/:jid — last known presence from the local log
router.get('/:jid', asyncHandler(async (req, res) => {
  const jid = req.params.jid as string;
  if (!isValidJid(jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  // Presence events may be logged under either alias form of the same contact.
  const aliases = new Set([jid, resolveToPhoneJid(jid)]);
  const lid = resolveToLid(resolveToPhoneJid(jid));
  if (lid) aliases.add(lid);
  const placeholders = [...aliases].map(() => '?').join(',');
  const row = getDb()
    .prepare(`SELECT jid, status, last_seen, logged_at FROM presence_log WHERE jid IN (${placeholders}) ORDER BY id DESC LIMIT 1`)
    .get(...aliases) as { jid: string; status?: string; last_seen?: number; logged_at: string } | undefined;
  res.json({
    jid,
    status: row?.status ?? null,
    last_seen: row?.last_seen ?? null,
    logged_at: row?.logged_at ?? null,
  });
}));

export default router;
