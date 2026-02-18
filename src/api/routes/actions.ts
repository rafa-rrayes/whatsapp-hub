import { Router, Request, Response } from 'express';
import { connectionManager } from '../../connection/manager.js';
import { validateUrlForFetch, isValidJid } from '../../utils/security.js';

const router = Router();

// POST /api/actions/send/text
router.post('/send/text', async (req: Request, res: Response) => {
  try {
    const { jid, text, quoted_id } = req.body;
    if (!jid || !text) {
      res.status(400).json({ error: 'Missing jid or text' });
      return;
    }
    if (!isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }
    const result = await connectionManager.sendTextMessage(jid, text, quoted_id);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/image
router.post('/send/image', async (req: Request, res: Response) => {
  try {
    const { jid, url, base64, caption, mime_type } = req.body;
    if (!jid || (!url && !base64)) {
      res.status(400).json({ error: 'Missing jid or image data (url or base64)' });
      return;
    }
    if (!isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }

    let buffer: Buffer;
    if (base64) {
      buffer = Buffer.from(base64, 'base64');
    } else {
      try { await validateUrlForFetch(url); } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
      const response = await fetch(url);
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const result = await connectionManager.sendImage(jid, buffer, caption, mime_type);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/document
router.post('/send/document', async (req: Request, res: Response) => {
  try {
    const { jid, base64, url, filename, mime_type, caption } = req.body;
    if (!jid || (!base64 && !url) || !filename || !mime_type) {
      res.status(400).json({ error: 'Missing required fields: jid, (base64 or url), filename, mime_type' });
      return;
    }
    if (!isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }

    let buffer: Buffer;
    if (base64) {
      buffer = Buffer.from(base64, 'base64');
    } else {
      try { await validateUrlForFetch(url); } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
      const response = await fetch(url);
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const result = await connectionManager.sendDocument(jid, buffer, filename, mime_type, caption);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/audio
router.post('/send/audio', async (req: Request, res: Response) => {
  try {
    const { jid, base64, url, ptt } = req.body;
    if (!jid || (!base64 && !url)) {
      res.status(400).json({ error: 'Missing jid or audio data' });
      return;
    }
    if (!isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }

    let buffer: Buffer;
    if (base64) {
      buffer = Buffer.from(base64, 'base64');
    } else {
      try { await validateUrlForFetch(url); } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
      const response = await fetch(url);
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const result = await connectionManager.sendAudio(jid, buffer, ptt);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/video
router.post('/send/video', async (req: Request, res: Response) => {
  try {
    const { jid, base64, url, caption } = req.body;
    if (!jid || (!base64 && !url)) {
      res.status(400).json({ error: 'Missing jid or video data' });
      return;
    }
    if (!isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }

    let buffer: Buffer;
    if (base64) {
      buffer = Buffer.from(base64, 'base64');
    } else {
      try { await validateUrlForFetch(url); } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
      const response = await fetch(url);
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const result = await connectionManager.sendVideo(jid, buffer, caption);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/sticker
router.post('/send/sticker', async (req: Request, res: Response) => {
  try {
    const { jid, base64, url } = req.body;
    if (!jid || (!base64 && !url)) {
      res.status(400).json({ error: 'Missing jid or sticker data' });
      return;
    }
    if (!isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }

    let buffer: Buffer;
    if (base64) {
      buffer = Buffer.from(base64, 'base64');
    } else {
      try { await validateUrlForFetch(url); } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
      const response = await fetch(url);
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const result = await connectionManager.sendSticker(jid, buffer);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/location
router.post('/send/location', async (req: Request, res: Response) => {
  try {
    const { jid, latitude, longitude, name, address } = req.body;
    if (!jid || latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: 'Missing jid, latitude, or longitude' });
      return;
    }
    if (!isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }
    const result = await connectionManager.sendLocation(jid, latitude, longitude, name, address);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/send/contact
router.post('/send/contact', async (req: Request, res: Response) => {
  try {
    const { jid, contact_jid, name } = req.body;
    if (!jid || !contact_jid || !name) {
      res.status(400).json({ error: 'Missing jid, contact_jid, or name' });
      return;
    }
    if (!isValidJid(jid) || !isValidJid(contact_jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }
    const result = await connectionManager.sendContact(jid, contact_jid, name);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/react
router.post('/react', async (req: Request, res: Response) => {
  try {
    const { jid, message_id, emoji } = req.body;
    if (!jid || !message_id || !emoji) {
      res.status(400).json({ error: 'Missing jid, message_id, or emoji' });
      return;
    }
    if (!isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }
    const result = await connectionManager.sendReaction(jid, message_id, emoji);
    res.json({ success: true, key: result?.key });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/read — mark messages as read
router.post('/read', async (req: Request, res: Response) => {
  try {
    const { jid, message_ids } = req.body;
    if (!jid || !message_ids?.length) {
      res.status(400).json({ error: 'Missing jid or message_ids' });
      return;
    }
    if (!isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }
    await connectionManager.markRead(jid, message_ids);
    res.json({ success: true });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/presence
router.post('/presence', async (req: Request, res: Response) => {
  try {
    const { type, jid } = req.body;
    if (!type) {
      res.status(400).json({ error: 'Missing presence type' });
      return;
    }
    if (jid && !isValidJid(jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }
    await connectionManager.sendPresenceUpdate(type, jid);
    res.json({ success: true });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/actions/profile-status
router.put('/profile-status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ error: 'Missing status text' });
      return;
    }
    await connectionManager.updateProfileStatus(status);
    res.json({ success: true });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
