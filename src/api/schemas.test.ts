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
