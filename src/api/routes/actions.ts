import { Router } from 'express';
import { connectionManager } from '../../connection/manager.js';
import { validateUrlForFetch } from '../../utils/security.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../errors.js';
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

  const { config } = await import('../../config.js');
  const maxBytes = config.maxMediaSizeMB * 1024 * 1024;

  const response = await fetch(url!, {
    signal: AbortSignal.timeout(30_000),
  });

  // Early rejection via Content-Length header
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength && contentLength > maxBytes) {
    throw new Error(`File too large: ${Math.round(contentLength / 1024 / 1024)}MB exceeds ${config.maxMediaSizeMB}MB limit`);
  }

  // Stream with chunk-by-chunk size guard
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > maxBytes) {
      reader.cancel();
      throw new Error(`File too large: exceeds ${config.maxMediaSizeMB}MB limit`);
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

// POST /api/actions/send/text
router.post('/send/text', validate(sendTextSchema), asyncHandler(async (req, res) => {
  const { jid, text, quoted_id } = req.body;
  const result = await connectionManager.sendTextMessage(jid, text, quoted_id);
  res.json({ success: true, key: result?.key });
}));

// POST /api/actions/send/image
router.post('/send/image', validate(sendMediaSchema), asyncHandler(async (req, res) => {
  const { jid, url, base64, caption, mime_type } = req.body;
  const buffer = await resolveBuffer(base64, url);
  const result = await connectionManager.sendImage(jid, buffer, caption, mime_type);
  res.json({ success: true, key: result?.key });
}));

// POST /api/actions/send/document
router.post('/send/document', validate(sendDocumentSchema), asyncHandler(async (req, res) => {
  const { jid, base64, url, filename, mime_type, caption } = req.body;
  const buffer = await resolveBuffer(base64, url);
  const result = await connectionManager.sendDocument(jid, buffer, filename, mime_type, caption);
  res.json({ success: true, key: result?.key });
}));

// POST /api/actions/send/audio
router.post('/send/audio', validate(sendAudioSchema), asyncHandler(async (req, res) => {
  const { jid, base64, url, ptt } = req.body;
  const buffer = await resolveBuffer(base64, url);
  const result = await connectionManager.sendAudio(jid, buffer, ptt);
  res.json({ success: true, key: result?.key });
}));

// POST /api/actions/send/video
router.post('/send/video', validate(sendVideoSchema), asyncHandler(async (req, res) => {
  const { jid, base64, url, caption } = req.body;
  const buffer = await resolveBuffer(base64, url);
  const result = await connectionManager.sendVideo(jid, buffer, caption);
  res.json({ success: true, key: result?.key });
}));

// POST /api/actions/send/sticker
router.post('/send/sticker', validate(sendStickerSchema), asyncHandler(async (req, res) => {
  const { jid, base64, url } = req.body;
  const buffer = await resolveBuffer(base64, url);
  const result = await connectionManager.sendSticker(jid, buffer);
  res.json({ success: true, key: result?.key });
}));

// POST /api/actions/send/location
router.post('/send/location', validate(sendLocationSchema), asyncHandler(async (req, res) => {
  const { jid, latitude, longitude, name, address } = req.body;
  const result = await connectionManager.sendLocation(jid, latitude, longitude, name, address);
  res.json({ success: true, key: result?.key });
}));

// POST /api/actions/send/contact
router.post('/send/contact', validate(sendContactSchema), asyncHandler(async (req, res) => {
  const { jid, contact_jid, name } = req.body;
  const result = await connectionManager.sendContact(jid, contact_jid, name);
  res.json({ success: true, key: result?.key });
}));

// POST /api/actions/react
router.post('/react', validate(reactSchema), asyncHandler(async (req, res) => {
  const { jid, message_id, emoji } = req.body;
  const result = await connectionManager.sendReaction(jid, message_id, emoji);
  res.json({ success: true, key: result?.key });
}));

// POST /api/actions/read — mark messages as read
router.post('/read', validate(readSchema), asyncHandler(async (req, res) => {
  const { jid, message_ids } = req.body;
  await connectionManager.markRead(jid, message_ids);
  res.json({ success: true });
}));

// POST /api/actions/presence
router.post('/presence', validate(presenceSchema), asyncHandler(async (req, res) => {
  const { type, jid } = req.body;
  await connectionManager.sendPresenceUpdate(type, jid);
  res.json({ success: true });
}));

// PUT /api/actions/profile-status
router.put('/profile-status', validate(profileStatusSchema), asyncHandler(async (req, res) => {
  const { status } = req.body;
  await connectionManager.updateProfileStatus(status);
  res.json({ success: true });
}));

export default router;
