import { describe, it, expect } from 'vitest';
import {
  sendTextSchema,
  sendMediaSchema,
  sendDocumentSchema,
  sendLocationSchema,
  sendContactSchema,
  reactSchema,
  readSchema,
  presenceSchema,
  webhookCreateSchema,
  settingsUpdateSchema,
  groupSubjectSchema,
  groupParticipantsSchema,
  exportRequestSchema,
} from './schemas.js';

describe('sendTextSchema', () => {
  it('accepts valid input', () => {
    const result = sendTextSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      text: 'Hello!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing text', () => {
    const result = sendTextSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty text', () => {
    const result = sendTextSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid JID', () => {
    const result = sendTextSchema.safeParse({
      jid: 'not-a-valid-jid',
      text: 'Hello!',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional quoted_id', () => {
    const result = sendTextSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      text: 'Reply',
      quoted_id: 'msg-123',
    });
    expect(result.success).toBe(true);
  });
});

describe('sendMediaSchema', () => {
  it('accepts with base64', () => {
    const result = sendMediaSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      base64: 'SGVsbG8=',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with url', () => {
    const result = sendMediaSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      url: 'https://example.com/image.jpg',
    });
    expect(result.success).toBe(true);
  });

  it('rejects without base64 or url', () => {
    const result = sendMediaSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
    });
    expect(result.success).toBe(false);
  });
});

describe('sendDocumentSchema', () => {
  it('requires filename and mime_type', () => {
    const result = sendDocumentSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      base64: 'SGVsbG8=',
      filename: 'doc.pdf',
      mime_type: 'application/pdf',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing filename', () => {
    const result = sendDocumentSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      base64: 'SGVsbG8=',
      mime_type: 'application/pdf',
    });
    expect(result.success).toBe(false);
  });
});

describe('sendLocationSchema', () => {
  it('accepts valid coordinates', () => {
    const result = sendLocationSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      latitude: -23.5505,
      longitude: -46.6333,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing latitude', () => {
    const result = sendLocationSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      longitude: -46.6333,
    });
    expect(result.success).toBe(false);
  });
});

describe('sendContactSchema', () => {
  it('accepts valid contact', () => {
    const result = sendContactSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      contact_jid: '5511888888888@s.whatsapp.net',
      name: 'Alice',
    });
    expect(result.success).toBe(true);
  });

  it('validates contact_jid format', () => {
    const result = sendContactSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      contact_jid: 'invalid',
      name: 'Alice',
    });
    expect(result.success).toBe(false);
  });
});

describe('reactSchema', () => {
  it('accepts valid reaction', () => {
    const result = reactSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      message_id: 'msg-123',
      emoji: '👍',
    });
    expect(result.success).toBe(true);
  });
});

describe('readSchema', () => {
  it('accepts valid read receipt', () => {
    const result = readSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      message_ids: ['msg-1', 'msg-2'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty message_ids', () => {
    const result = readSchema.safeParse({
      jid: '5511999999999@s.whatsapp.net',
      message_ids: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('presenceSchema', () => {
  it('accepts valid presence types', () => {
    for (const type of ['available', 'unavailable', 'composing', 'recording', 'paused']) {
      expect(presenceSchema.safeParse({ type }).success).toBe(true);
    }
  });

  it('rejects invalid presence type', () => {
    expect(presenceSchema.safeParse({ type: 'invalid' }).success).toBe(false);
  });

  it('accepts optional jid', () => {
    const result = presenceSchema.safeParse({
      type: 'composing',
      jid: '5511999999999@s.whatsapp.net',
    });
    expect(result.success).toBe(true);
  });
});

describe('webhookCreateSchema', () => {
  it('accepts valid webhook', () => {
    const result = webhookCreateSchema.safeParse({
      url: 'https://example.com/hook',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty url', () => {
    const result = webhookCreateSchema.safeParse({ url: '' });
    expect(result.success).toBe(false);
  });

  it('rejects overly long url', () => {
    const result = webhookCreateSchema.safeParse({
      url: 'https://example.com/' + 'a'.repeat(2100),
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional secret and events', () => {
    const result = webhookCreateSchema.safeParse({
      url: 'https://example.com/hook',
      secret: 'my-secret',
      events: 'wa.message,wa.group',
    });
    expect(result.success).toBe(true);
  });
});

describe('settingsUpdateSchema', () => {
  it('accepts valid settings', () => {
    const result = settingsUpdateSchema.safeParse({
      logLevel: 'debug',
      autoDownloadMedia: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = settingsUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid log level', () => {
    const result = settingsUpdateSchema.safeParse({
      logLevel: 'verbose',
    });
    expect(result.success).toBe(false);
  });
});

describe('groupSubjectSchema', () => {
  it('accepts valid subject', () => {
    expect(groupSubjectSchema.safeParse({ subject: 'My Group' }).success).toBe(true);
  });

  it('rejects overly long subject', () => {
    expect(groupSubjectSchema.safeParse({ subject: 'a'.repeat(101) }).success).toBe(false);
  });
});

describe('groupParticipantsSchema', () => {
  it('accepts valid participant operation', () => {
    const result = groupParticipantsSchema.safeParse({
      participants: ['5511999999999@s.whatsapp.net'],
      action: 'add',
    });
    expect(result.success).toBe(true);
  });

  it('validates all action types', () => {
    for (const action of ['add', 'remove', 'promote', 'demote']) {
      const result = groupParticipantsSchema.safeParse({
        participants: ['5511999999999@s.whatsapp.net'],
        action,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid action', () => {
    const result = groupParticipantsSchema.safeParse({
      participants: ['5511999999999@s.whatsapp.net'],
      action: 'ban',
    });
    expect(result.success).toBe(false);
  });

  it('validates participant JID format', () => {
    const result = groupParticipantsSchema.safeParse({
      participants: ['invalid-jid'],
      action: 'add',
    });
    expect(result.success).toBe(false);
  });
});

describe('exportRequestSchema', () => {
  it('accepts a minimal valid request with `days`', () => {
    const result = exportRequestSchema.safeParse({ days: 7 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('md');
      expect(result.data.preset).toBe('full');
      expect(result.data.media).toBe('none');
      expect(result.data.reactions).toBe('inline');
      expect(result.data.timezone).toBe('UTC');
    }
  });

  it('accepts an absolute time window with unix timestamps', () => {
    const result = exportRequestSchema.safeParse({ from: 1_700_000_000, to: 1_700_864_000 });
    expect(result.success).toBe(true);
  });

  it('accepts an ISO datetime string for from/to', () => {
    const result = exportRequestSchema.safeParse({
      from: '2026-04-23T00:00:00Z',
      to: '2026-05-08T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when neither from/to nor days is provided', () => {
    const result = exportRequestSchema.safeParse({ format: 'md' });
    expect(result.success).toBe(false);
  });

  it('rejects when to is before from', () => {
    const result = exportRequestSchema.safeParse({ from: 2_000, to: 1_000 });
    expect(result.success).toBe(false);
  });

  it('rejects mutually exclusive groups_only + dms_only', () => {
    const result = exportRequestSchema.safeParse({
      days: 7,
      groups_only: true,
      dms_only: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects format=zip without media=attach', () => {
    const result = exportRequestSchema.safeParse({ days: 7, format: 'zip' });
    expect(result.success).toBe(false);
  });

  it('accepts format=zip with media=attach', () => {
    const result = exportRequestSchema.safeParse({ days: 7, format: 'zip', media: 'attach' });
    expect(result.success).toBe(true);
  });

  it('validates jid format inside chats array', () => {
    const result = exportRequestSchema.safeParse({
      days: 7,
      chats: ['not-a-jid'],
    });
    expect(result.success).toBe(false);
  });

  it('clamps days to 1..365', () => {
    expect(exportRequestSchema.safeParse({ days: 0 }).success).toBe(false);
    expect(exportRequestSchema.safeParse({ days: 366 }).success).toBe(false);
    expect(exportRequestSchema.safeParse({ days: 365 }).success).toBe(true);
  });

  it('clamps max_messages to <= 200_000', () => {
    expect(exportRequestSchema.safeParse({ days: 7, max_messages: 200_001 }).success).toBe(false);
    expect(exportRequestSchema.safeParse({ days: 7, max_messages: 200_000 }).success).toBe(true);
  });

  it('default exclude_types filters reactions and poll_updates', () => {
    const result = exportRequestSchema.safeParse({ days: 7 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exclude_types).toEqual(['reaction', 'poll_update']);
    }
  });

  it('accepts allowed format/preset/media/reactions enums', () => {
    for (const format of ['md', 'txt', 'json'] as const) {
      expect(exportRequestSchema.safeParse({ days: 1, format }).success).toBe(true);
    }
    for (const preset of ['concise', 'full', 'llm', 'archive'] as const) {
      expect(exportRequestSchema.safeParse({ days: 1, preset }).success).toBe(true);
    }
    for (const media of ['none', 'ref', 'embed'] as const) {
      expect(exportRequestSchema.safeParse({ days: 1, media }).success).toBe(true);
    }
    for (const reactions of ['inline', 'separate', 'omit'] as const) {
      expect(exportRequestSchema.safeParse({ days: 1, reactions }).success).toBe(true);
    }
  });

  it('rejects max_chats > 500', () => {
    expect(exportRequestSchema.safeParse({ days: 1, max_chats: 501 }).success).toBe(false);
  });
});
