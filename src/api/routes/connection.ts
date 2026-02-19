import { Router } from 'express';
import { connectionManager } from '../../connection/manager.js';
import { asyncHandler, NotFoundError } from '../errors.js';
import QRCode from 'qrcode';

const router = Router();

// GET /api/connection/status
router.get('/status', (_req, res) => {
  res.json({
    status: connectionManager.getStatus(),
    jid: connectionManager.getMyJid(),
    hasQR: !!connectionManager.getQR(),
  });
});

// GET /api/connection/qr — get QR code as base64 image
router.get('/qr', asyncHandler(async (_req, res) => {
  const qr = connectionManager.getQR();
  if (!qr) {
    throw new NotFoundError('No QR code available');
  }
  const dataUrl = await QRCode.toDataURL(qr);
  res.json({ qr: dataUrl, raw: qr });
}));

// GET /api/connection/qr/image — get QR code as PNG image
router.get('/qr/image', asyncHandler(async (_req, res) => {
  const qr = connectionManager.getQR();
  if (!qr) {
    throw new NotFoundError('No QR code available');
  }
  const buffer = await QRCode.toBuffer(qr, { type: 'png', width: 400 });
  res.setHeader('Content-Type', 'image/png');
  res.send(buffer);
}));

// POST /api/connection/restart
router.post('/restart', asyncHandler(async (_req, res) => {
  await connectionManager.restart();
  res.json({ success: true, message: 'Reconnecting...' });
}));

// POST /api/connection/new-qr — clear auth and generate a fresh QR code
router.post('/new-qr', asyncHandler(async (_req, res) => {
  await connectionManager.newQR();
  res.json({ success: true, message: 'Auth cleared. Generating new QR code...' });
}));

// POST /api/connection/logout
router.post('/logout', asyncHandler(async (_req, res) => {
  await connectionManager.disconnect();
  res.json({ success: true, message: 'Logged out' });
}));

export default router;
