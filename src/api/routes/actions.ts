import { Router, Request, Response } from 'express';
import { connectionManager } from '../../connection/manager.js';
import { validateUrlForFetch } from '../../utils/security.js';
import { validate } from '../middleware/validate.js';
import { log } from '../../utils/logger.js';
import {
  sendTextSchema,
  sendMediaSchema,
  sendDocumentSchema,
  sendAudioSchema,
  sendVideoSchema,
  sendStickerSchema,
  sendLocationSchema,
  sendContactSchema,
  reactSchema,
  readSchema,
  presenceSchema,
  profileStatusSchema,
} from '../schemas.js';

const router = Router();

async function resolveBuffer(base64?: string, url?: string): Promise<Buffer> {
  if (base64) {
    return Buffer.from(base64, 'base64');
  }
  await validateUrlForFetch(url!);
  const response = await fetch(url!);
  return Buffer.from(await response.arrayBuffer());
}

// POST /api/actions/send/text
router.post('/send/text', validate(sendTextSchema), async (req: Request, res: Response) => {
  try {
    const { jid, text, quoted_id } = req.body;
    const result = await connectionManager.sendTextMessage(jid, text, quoted_id);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    log.api.error({ err }, 'send/text failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/image
router.post('/send/image', validate(sendMediaSchema), async (req: Request, res: Response) => {
  try {
    const { jid, url, base64, caption, mime_type } = req.body;
    const buffer = await resolveBuffer(base64, url);
    const result = await connectionManager.sendImage(jid, buffer, caption, mime_type);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    log.api.error({ err }, 'send/image failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/document
router.post('/send/document', validate(sendDocumentSchema), async (req: Request, res: Response) => {
  try {
    const { jid, base64, url, filename, mime_type, caption } = req.body;
    const buffer = await resolveBuffer(base64, url);
    const result = await connectionManager.sendDocument(jid, buffer, filename, mime_type, caption);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    log.api.error({ err }, 'send/document failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/audio
router.post('/send/audio', validate(sendAudioSchema), async (req: Request, res: Response) => {
  try {
    const { jid, base64, url, ptt } = req.body;
    const buffer = await resolveBuffer(base64, url);
    const result = await connectionManager.sendAudio(jid, buffer, ptt);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    log.api.error({ err }, 'send/audio failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/video
router.post('/send/video', validate(sendVideoSchema), async (req: Request, res: Response) => {
  try {
    const { jid, base64, url, caption } = req.body;
    const buffer = await resolveBuffer(base64, url);
    const result = await connectionManager.sendVideo(jid, buffer, caption);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    log.api.error({ err }, 'send/video failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/sticker
router.post('/send/sticker', validate(sendStickerSchema), async (req: Request, res: Response) => {
  try {
    const { jid, base64, url } = req.body;
    const buffer = await resolveBuffer(base64, url);
    const result = await connectionManager.sendSticker(jid, buffer);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    log.api.error({ err }, 'send/sticker failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/location
router.post('/send/location', validate(sendLocationSchema), async (req: Request, res: Response) => {
  try {
    const { jid, latitude, longitude, name, address } = req.body;
    const result = await connectionManager.sendLocation(jid, latitude, longitude, name, address);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    log.api.error({ err }, 'send/location failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/contact
router.post('/send/contact', validate(sendContactSchema), async (req: Request, res: Response) => {
  try {
    const { jid, contact_jid, name } = req.body;
    const result = await connectionManager.sendContact(jid, contact_jid, name);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    log.api.error({ err }, 'send/contact failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/react
router.post('/react', validate(reactSchema), async (req: Request, res: Response) => {
  try {
    const { jid, message_id, emoji } = req.body;
    const result = await connectionManager.sendReaction(jid, message_id, emoji);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    log.api.error({ err }, 'react failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/read — mark messages as read
router.post('/read', validate(readSchema), async (req: Request, res: Response) => {
  try {
    const { jid, message_ids } = req.body;
    await connectionManager.markRead(jid, message_ids);
    res.json({ success: true });
  } catch (err) {
    log.api.error({ err }, 'read failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/presence
router.post('/presence', validate(presenceSchema), async (req: Request, res: Response) => {
  try {
    const { type, jid } = req.body;
    await connectionManager.sendPresenceUpdate(type, jid);
    res.json({ success: true });
  } catch (err) {
    log.api.error({ err }, 'presence failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/actions/profile-status
router.put('/profile-status', validate(profileStatusSchema), async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    await connectionManager.updateProfileStatus(status);
    res.json({ success: true });
  } catch (err) {
    log.api.error({ err }, 'profile-status failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
