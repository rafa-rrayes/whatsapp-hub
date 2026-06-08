import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import type { WAMessage } from '@whiskeysockets/baileys';
import { createTestDb } from '../test-utils/db.js';

let db: Database.Database;

// Mock getDb so every repository (messages, chats, contacts, events, …) hits our
// fresh in-memory test database.
vi.mock('../database/index.js', () => ({
  getDb: () => db,
}));

// Keep raw_message in the DB so getById round-trips like production.
vi.mock('../config.js', () => ({
  config: {
    security: { stripRawMessages: false, hashEventJids: false },
  },
}));

// Stub the logger so it doesn't pull in pino's level config (mocked config above
// omits logLevel, which the real logger reads at import time).
vi.mock('../utils/logger.js', () => ({
  log: {
    event: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

// The history path must NEVER queue media downloads — spy so we can assert that.
const queueDownload = vi.fn();
vi.mock('../media/manager.js', () => ({
  mediaManager: { queueDownload },
}));

// fetchGroupMetadataAsync calls into the connection manager; mock it so no socket
// machinery is touched. (Our fixtures use 1:1 JIDs, so this should not be hit.)
vi.mock('../connection/manager.js', () => ({
  connectionManager: {
    getGroupMetadata: vi.fn().mockResolvedValue(null),
  },
}));

// Import AFTER mocks are in place.
const { eventBus } = await import('./bus.js');
const { registerEventHandlers } = await import('./handler.js');
const { messagesRepo } = await import('../database/repositories/messages.js');
const { eventsRepo } = await import('../database/repositories/events.js');

let registered = false;

/** Build a minimal but realistic history WAMessage. */
function makeHistoryMessage(overrides: {
  id: string;
  text?: string;
  remoteJid?: string;
  timestamp?: number;
  protocol?: boolean;
}): WAMessage {
  const message = overrides.protocol
    ? { protocolMessage: { type: 0 } }
    : { conversation: overrides.text ?? `history ${overrides.id}` };

  return {
    key: {
      id: overrides.id,
      remoteJid: overrides.remoteJid ?? '5511988887777@s.whatsapp.net',
      fromMe: false,
    },
    messageTimestamp: overrides.timestamp ?? 1700000000,
    pushName: 'Historical Sender',
    message,
  } as unknown as WAMessage;
}

describe('messaging-history.set handler', () => {
  beforeEach(() => {
    db = createTestDb();
    queueDownload.mockClear();
    // registerEventHandlers attaches listeners to the singleton eventBus; only do it once.
    if (!registered) {
      registerEventHandlers();
      registered = true;
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persists history-sync messages (previously discarded)', () => {
    const messages = [
      makeHistoryMessage({ id: 'hist-1', text: 'first old message' }),
      makeHistoryMessage({ id: 'hist-2', text: 'second old message' }),
    ];

    eventBus.publish('wa.messaging-history.set', {
      chats: [],
      contacts: [],
      messages,
      isLatest: true,
      syncType: 2,
    });

    // The core bug fix: rows now land in the messages table.
    const row1 = messagesRepo.getById('hist-1');
    const row2 = messagesRepo.getById('hist-2');
    expect(row1).toBeDefined();
    expect(row1!.body).toBe('first old message');
    expect(row1!.message_type).toBe('text');
    expect(row2).toBeDefined();
    expect(row2!.body).toBe('second old message');

    expect(messagesRepo.query({}).total).toBe(2);
  });

  it('does not queue media downloads for history messages (metadata only)', () => {
    const imageMessage: WAMessage = {
      key: { id: 'hist-img', remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
      messageTimestamp: 1700000100,
      message: {
        imageMessage: { mimetype: 'image/jpeg', fileLength: 12345, caption: 'a photo' },
      },
    } as unknown as WAMessage;

    eventBus.publish('wa.messaging-history.set', {
      chats: [],
      contacts: [],
      messages: [imageMessage],
      isLatest: true,
      syncType: 2,
    });

    const row = messagesRepo.getById('hist-img');
    expect(row).toBeDefined();
    expect(row!.has_media).toBe(1);
    expect(row!.media_mime_type).toBe('image/jpeg');
    // Metadata persisted, but no download queued for historical media.
    expect(queueDownload).not.toHaveBeenCalled();
  });

  it('skips protocol messages just like the live path', () => {
    eventBus.publish('wa.messaging-history.set', {
      chats: [],
      contacts: [],
      messages: [
        makeHistoryMessage({ id: 'hist-real', text: 'keep me' }),
        makeHistoryMessage({ id: 'hist-proto', protocol: true }),
      ],
      isLatest: true,
      syncType: 2,
    });

    expect(messagesRepo.getById('hist-real')).toBeDefined();
    expect(messagesRepo.getById('hist-proto')).toBeUndefined();
    expect(messagesRepo.query({}).total).toBe(1);
  });

  it('includes syncType in the history.sync event log', () => {
    eventBus.publish('wa.messaging-history.set', {
      chats: [],
      contacts: [],
      messages: [makeHistoryMessage({ id: 'hist-sync' })],
      isLatest: false,
      syncType: 5,
    });

    const events = eventsRepo.query({ type: 'history.sync' });
    expect(events.length).toBe(1);
    const payload = JSON.parse(events[0].payload);
    expect(payload.syncType).toBe(5);
    expect(payload.messages).toBe(1);
    expect(payload.isLatest).toBe(false);
  });
});
