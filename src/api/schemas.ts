import { z } from 'zod';

const JID_REGEX = /^(\d+@(s\.whatsapp\.net|lid|broadcast)|\d+(-\d+)?@g\.us|status@broadcast)$/;

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

export const settingsUpdateSchema = z.object({
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  autoDownloadMedia: z.boolean().optional(),
  maxMediaSizeMB: z.number().int().min(0).optional(),
  transcribeMedia: z.boolean().optional(),
  geminiApiKey: z.string().max(256, 'geminiApiKey must be under 256 characters').optional(),
  geminiModel: z.string().min(1, 'geminiModel is required').max(100, 'geminiModel must be under 100 characters').optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one setting is required' });

// Group operation schemas
export const groupSubjectSchema = z.object({
  subject: z.string().min(1, 'subject is required').max(100, 'subject must be under 100 characters'),
});

export const groupDescriptionSchema = z.object({
  description: z.string().max(2048, 'description must be under 2048 characters'),
});

export const groupParticipantsSchema = z.object({
  participants: z.array(
    z.string().regex(JID_REGEX, 'Invalid participant JID format')
  ).min(1, 'participants must not be empty'),
  action: z.enum(['add', 'remove', 'promote', 'demote']),
});

// ── Export endpoint ─────────────────────────────────────────────────────────
//
// Single, richly-parameterised endpoint that produces a Markdown export
// (and zip, txt, json variants) of conversations from the local SQLite store.
// See tasks/todo.md for the design and rationale.

const timeInput = z.union([z.number().int(), z.string().datetime()]);

const messageField = z.enum([
  'timestamp', 'sender', 'body', 'media', 'reply', 'reactions',
  'id', 'edits', 'forwarded', 'starred',
]);

export const exportRequestSchema = z.object({
  // Time window — provide {from, to} OR `days`. If both, {from, to} wins.
  from: timeInput.optional(),
  to: timeInput.optional(),
  days: z.number().int().min(1).max(365).optional(),

  // Chat selection
  chats: z.array(z.string().regex(JID_REGEX, 'Invalid JID format')).max(500).optional(),
  exclude_chats: z.array(z.string().regex(JID_REGEX, 'Invalid JID format')).max(500).optional(),
  groups_only: z.boolean().optional(),
  dms_only: z.boolean().optional(),
  include_archived: z.boolean().default(false),
  include_muted: z.boolean().default(true),
  unread_only: z.boolean().default(false),
  min_messages: z.number().int().min(0).default(0),
  chat_search: z.string().optional(),
  sort_chats_by: z.enum(['recent', 'volume', 'name']).default('recent'),

  // Message selection
  types: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).default(['reaction', 'poll_update']),
  has_media: z.boolean().optional(),
  from_me: z.boolean().optional(),
  include_deleted: z.boolean().default(false),
  include_system: z.boolean().default(false),
  min_body_length: z.number().int().min(0).default(0),
  search: z.string().optional(),

  // Rendering
  format: z.enum(['md', 'txt', 'json', 'zip']).default('md'),
  preset: z.enum(['concise', 'full', 'llm', 'archive']).default('full'),
  fields: z.array(messageField).optional(),

  // Time / locale
  timezone: z.string().default('UTC'),
  time_format: z.enum(['absolute', 'relative', 'both']).default('absolute'),
  date_grouping: z.enum(['none', 'day', 'hour']).default('day'),

  // Reactions
  reactions: z.enum(['inline', 'separate', 'omit']).default('inline'),

  // Names
  me_alias: z.string().default('Me'),
  prefer_saved_names: z.boolean().default(true),

  // Media handling
  media: z.enum(['none', 'ref', 'embed', 'attach']).default('none'),
  media_types: z.array(z.enum(['image', 'video', 'audio', 'sticker', 'document'])).optional(),
  max_media_size_mb: z.number().int().min(0).default(50),
  include_thumbnails: z.boolean().default(false),

  // Privacy
  redact_phone_numbers: z.boolean().default(false),
  anonymize_jids: z.boolean().default(false),
  strip_quoted_bodies: z.boolean().default(false),

  // Caps (callers can lower; server clamps upper bound)
  max_messages: z.number().int().min(1).max(200_000).default(100_000),
  max_chats: z.number().int().min(1).max(500).default(500),
})
  .refine((d) => !(d.groups_only && d.dms_only), { message: 'groups_only and dms_only are mutually exclusive' })
  .refine((d) => {
    const f = typeof d.from === 'string' ? Date.parse(d.from) / 1000 : d.from;
    const t = typeof d.to === 'string' ? Date.parse(d.to) / 1000 : d.to;
    return !(f !== undefined && t !== undefined && t <= f);
  }, { message: 'to must be after from' })
  .refine((d) => d.from !== undefined || d.to !== undefined || d.days !== undefined,
    { message: 'must specify a time window: from/to or days' })
  .refine((d) => !(d.format === 'zip' && d.media !== 'attach'),
    { message: 'format=zip requires media=attach' });

export type ExportRequest = z.infer<typeof exportRequestSchema>;
