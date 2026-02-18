import { Router, Request, Response } from 'express';
import { connectionManager } from '../../connection/manager.js';
import QRCode from 'qrcode';

const router = Router();

// GET /api/connection/status
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: connectionManager.getStatus(),
    jid: connectionManager.getMyJid(),
    hasQR: !!connectionManager.getQR(),
  });
});

// GET /api/connection/qr — get QR code as base64 image
router.get('/qr', async (_req: Request, res: Response) => {
  try {
    const qr = connectionManager.getQR();
    if (!qr) {
      res.status(404).json({
        error: 'No QR code available',
        status: connectionManager.getStatus(),
      });
      return;
    }
    const dataUrl = await QRCode.toDataURL(qr);
    res.json({ qr: dataUrl, raw: qr });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/connection/qr/image — get QR code as PNG image
router.get('/qr/image', async (_req: Request, res: Response) => {
  try {
    const qr = connectionManager.getQR();
    if (!qr) {
      res.status(404).send('No QR code available');
      return;
    }
    const buffer = await QRCode.toBuffer(qr, { type: 'png', width: 400 });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/connection/restart
router.post('/restart', async (_req: Request, res: Response) => {
  try {
    await connectionManager.restart();
    res.json({ success: true, message: 'Reconnecting...' });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/connection/new-qr — clear auth and generate a fresh QR code
router.post('/new-qr', async (_req: Request, res: Response) => {
  try {
    await connectionManager.newQR();
    res.json({ success: true, message: 'Auth cleared. Generating new QR code...' });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/connection/logout
router.post('/logout', async (_req: Request, res: Response) => {
  try {
    await connectionManager.disconnect();
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
