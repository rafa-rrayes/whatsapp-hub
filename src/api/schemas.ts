import { z } from 'zod';

const JID_REGEX = /^(\d+@(s\.whatsapp\.net|lid|broadcast)|\d+-\d+@g\.us|status@broadcast)$/;

const jid = z.string().regex(JID_REGEX, 'Invalid JID format');

export const sendTextSchema = z.object({
  jid,
  text: z.string().min(1, 'text is required'),
  quoted_id: z.string().optional(),
});

export const sendMediaSchema = z.object({
  jid,
  base64: z.string().optional(),
  url: z.string().optional(),
  caption: z.string().optional(),
  mime_type: z.string().optional(),
}).refine((d) => d.base64 || d.url, { message: 'Either base64 or url is required' });

export const sendDocumentSchema = z.object({
  jid,
  base64: z.string().optional(),
  url: z.string().optional(),
  filename: z.string().min(1, 'filename is required'),
  mime_type: z.string().min(1, 'mime_type is required'),
  caption: z.string().optional(),
}).refine((d) => d.base64 || d.url, { message: 'Either base64 or url is required' });

export const sendAudioSchema = z.object({
  jid,
  base64: z.string().optional(),
  url: z.string().optional(),
  ptt: z.boolean().optional(),
}).refine((d) => d.base64 || d.url, { message: 'Either base64 or url is required' });

export const sendVideoSchema = z.object({
  jid,
  base64: z.string().optional(),
  url: z.string().optional(),
  caption: z.string().optional(),
}).refine((d) => d.base64 || d.url, { message: 'Either base64 or url is required' });

export const sendStickerSchema = z.object({
  jid,
  base64: z.string().optional(),
  url: z.string().optional(),
}).refine((d) => d.base64 || d.url, { message: 'Either base64 or url is required' });

export const sendLocationSchema = z.object({
  jid,
  latitude: z.number(),
  longitude: z.number(),
  name: z.string().optional(),
  address: z.string().optional(),
});

export const sendContactSchema = z.object({
  jid,
  contact_jid: jid,
  name: z.string().min(1, 'name is required'),
});

export const reactSchema = z.object({
  jid,
  message_id: z.string().min(1, 'message_id is required'),
  emoji: z.string().min(1, 'emoji is required'),
});

export const readSchema = z.object({
  jid,
  message_ids: z.array(z.string()).min(1, 'message_ids must not be empty'),
});

export const presenceSchema = z.object({
  type: z.enum(['available', 'unavailable', 'composing', 'recording', 'paused']),
  jid: z.string().regex(JID_REGEX, 'Invalid JID format').optional(),
});

export const profileStatusSchema = z.object({
  status: z.string().min(1, 'status text is required'),
});

export const webhookCreateSchema = z.object({
  url: z.string().min(1, 'url is required').max(2048, 'url must be under 2048 characters'),
  secret: z.string().max(256, 'secret must be under 256 characters').optional(),
  events: z.string().max(1024, 'events must be under 1024 characters').optional(),
});
