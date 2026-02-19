import { Router } from 'express';
import crypto from 'crypto';
import { storeTicket } from '../../websocket/server.js';

const router = Router();
const TICKET_TTL_MS = 30_000; // 30 seconds

// POST /api/ws/ticket — issue a one-time WebSocket ticket
router.post('/ticket', (_req, res) => {
  const ticket = crypto.randomBytes(32).toString('base64url');
  storeTicket(ticket, TICKET_TTL_MS);
  res.json({ ticket, expiresIn: 30 });
});

export default router;
