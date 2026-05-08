import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb } from '../test-utils/db.js';
import { makeMessage, resetFixtures } from '../test-utils/fixtures.js';
import type { ExportOptions, ResolvedTimeWindow } from './types.js';

let db: Database.Database;

vi.mock('../database/index.js', () => ({ getDb: () => db }));
vi.mock('../config.js', () => ({
  config: {
    security: { stripRawMessages: false },
    mediaDir: '/tmp/test-media',
  },
}));

const { messagesRepo } = await import('../database/repositories/messages.js');
const { chatsRepo } = await import('../database/repositories/chats.js');
const { selectChats, selectMessages, resolveTimeWindow } = await import('./selector.js');

function defaultOpts(over: Partial<ExportOptions> = {}): ExportOptions {
  return {
    days: 30,
    include_archived: false,
    include_muted: true,
    unread_only: false,
    min_messages: 0,
    sort_chats_by: 'recent',
    include_deleted: false,
    include_system: false,
    min_body_length: 0,
    format: 'md',
    preset: 'full',
    timezone: 'UTC',
    time_format: 'absolute',
    date_grouping: 'day',
    reactions: 'inline',
    me_alias: 'Me',
    prefer_saved_names: true,
    media: 'none',
    max_media_size_mb: 50,
    include_thumbnails: false,
    redact_phone_numbers: false,
    anonymize_jids: false,
    strip_quoted_bodies: false,
    max_messages: 100_000,
    max_chats: 500,
    exclude_types: ['reaction', 'poll_update'],
    ...over,
  } as ExportOptions;
}

describe('resolveTimeWindow', () => {
  it('uses now-days when days is set', () => {
    const opts = defaultOpts({ days: 7 });
    const w = resolveTimeWindow(opts);
    const now = Math.floor(Date.now() / 1000);
    expect(w.to).toBeGreaterThanOrEqual(now - 5);
    expect(w.from).toBeGreaterThanOrEqual(now - 7 * 86400 - 5);
  });

  it('honours absolute from/to over days', () => {
    const opts = defaultOpts({ from: 1_700_000_000, to: 1_700_864_000, days: 1 });
    const w = resolveTimeWindow(opts);
    expect(w.from).toBe(1_700_000_000);
    expect(w.to).toBe(1_700_864_000);
  });

  it('parses ISO strings to unix seconds', () => {
    const opts = defaultOpts({ from: '2024-01-01T00:00:00Z', to: '2024-01-02T00:00:00Z' });
    const w = resolveTimeWindow(opts);
    expect(w.to - w.from).toBe(86_400);
  });
});

describe('selectChats / selectMessages', () => {
  beforeEach(() => {
    db = createTestDb();
    resetFixtures();

    chatsRepo.upsert({ jid: '111@s.whatsapp.net', name: 'Mom', is_group: 0, is_archived: 0, is_muted: 0, last_message_ts: 1_700_000_100 });
    chatsRepo.upsert({ jid: '222@s.whatsapp.net', name: 'Dad', is_group: 0, is_archived: 0, is_muted: 0, last_message_ts: 1_700_000_200 });
    chatsRepo.upsert({ jid: '333-1@g.us', name: 'Soccer', is_group: 1, is_archived: 0, is_muted: 0, last_message_ts: 1_700_000_300 });
    chatsRepo.upsert({ jid: '444@s.whatsapp.net', name: 'Archived', is_group: 0, is_archived: 1, is_muted: 0, last_message_ts: 1_700_000_400 });

    for (let i = 0; i < 3; i++) {
      messagesRepo.upsert(makeMessage({ id: `mom-${i}`, remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_000 + i, message_type: 'text', body: `mom ${i}` }));
    }
    messagesRepo.upsert(makeMessage({ id: 'dad-0', remote_jid: '222@s.whatsapp.net', timestamp: 1_700_000_010, message_type: 'text', body: 'dad' }));
    for (let i = 0; i < 5; i++) {
      messagesRepo.upsert(makeMessage({ id: `g-${i}`, remote_jid: '333-1@g.us', timestamp: 1_700_000_020 + i, message_type: 'text', body: `g${i}` }));
    }
    messagesRepo.upsert(makeMessage({ id: 'arch-0', remote_jid: '444@s.whatsapp.net', timestamp: 1_700_000_030, message_type: 'text', body: 'arch' }));
  });

  const window: ResolvedTimeWindow = { from: 1_699_999_000, to: 1_700_001_000 };

  it('returns all non-archived chats by default', () => {
    const result = selectChats(defaultOpts(), window);
    const jids = result.map((r) => r.chat.jid);
    expect(jids).toContain('111@s.whatsapp.net');
    expect(jids).toContain('222@s.whatsapp.net');
    expect(jids).toContain('333-1@g.us');
    expect(jids).not.toContain('444@s.whatsapp.net');
  });

  it('includes archived when include_archived=true', () => {
    const result = selectChats(defaultOpts({ include_archived: true }), window);
    expect(result.map((r) => r.chat.jid)).toContain('444@s.whatsapp.net');
  });

  it('groups_only filters to groups', () => {
    const result = selectChats(defaultOpts({ groups_only: true }), window);
    expect(result.length).toBe(1);
    expect(result[0].chat.jid).toBe('333-1@g.us');
  });

  it('dms_only filters to DMs', () => {
    const result = selectChats(defaultOpts({ dms_only: true }), window);
    expect(result.every((r) => r.chat.is_group === 0)).toBe(true);
  });

  it('chats allowlist restricts to provided jids', () => {
    const result = selectChats(defaultOpts({ chats: ['111@s.whatsapp.net'] }), window);
    expect(result.length).toBe(1);
    expect(result[0].chat.jid).toBe('111@s.whatsapp.net');
  });

  it('exclude_chats removes a jid from the result', () => {
    const result = selectChats(defaultOpts({ exclude_chats: ['111@s.whatsapp.net'] }), window);
    expect(result.map((r) => r.chat.jid)).not.toContain('111@s.whatsapp.net');
  });

  it('min_messages filters out low-volume chats', () => {
    const result = selectChats(defaultOpts({ min_messages: 4 }), window);
    expect(result.length).toBe(1);
    expect(result[0].chat.jid).toBe('333-1@g.us'); // 5 messages
  });

  it('sort_chats_by=volume sorts descending by count', () => {
    const result = selectChats(defaultOpts({ sort_chats_by: 'volume' }), window);
    expect(result[0].chat.jid).toBe('333-1@g.us');
  });

  it('sort_chats_by=name sorts alphabetically', () => {
    const result = selectChats(defaultOpts({ sort_chats_by: 'name' }), window);
    const names = result.map((r) => r.chat.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('selectMessages respects time window', () => {
    const msgs = selectMessages('111@s.whatsapp.net', window, defaultOpts(), 100);
    expect(msgs.length).toBe(3);
  });

  it('selectMessages applies has_media filter', () => {
    messagesRepo.upsert(makeMessage({
      id: 'mom-img', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_005,
      message_type: 'image', has_media: 1,
    }));
    const msgs = selectMessages('111@s.whatsapp.net', window, defaultOpts({ has_media: true }), 100);
    expect(msgs.length).toBe(1);
    expect(msgs[0].id).toBe('mom-img');
  });

  it('selectMessages excludes deleted by default', () => {
    messagesRepo.upsert(makeMessage({
      id: 'mom-del', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_005,
      message_type: 'text', body: 'gone',
    }));
    messagesRepo.markDeleted('mom-del');
    const msgs = selectMessages('111@s.whatsapp.net', window, defaultOpts(), 100);
    expect(msgs.find((m) => m.id === 'mom-del')).toBeUndefined();
  });

  it('selectMessages includes deleted when include_deleted=true', () => {
    messagesRepo.upsert(makeMessage({
      id: 'mom-del', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_005,
      message_type: 'text', body: 'gone',
    }));
    messagesRepo.markDeleted('mom-del');
    const msgs = selectMessages('111@s.whatsapp.net', window, defaultOpts({ include_deleted: true }), 100);
    expect(msgs.find((m) => m.id === 'mom-del')).toBeDefined();
  });

  it('selectMessages applies min_body_length', () => {
    messagesRepo.upsert(makeMessage({
      id: 'short', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_005,
      message_type: 'text', body: 'ok',
    }));
    const msgs = selectMessages('111@s.whatsapp.net', window, defaultOpts({ min_body_length: 10 }), 100);
    expect(msgs.find((m) => m.id === 'short')).toBeUndefined();
  });

  it('selectMessages includes reactions when reactions=inline', () => {
    messagesRepo.upsert(makeMessage({
      id: 'rxn', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_005,
      message_type: 'reaction', reaction_emoji: '👍', reaction_target_id: 'mom-0',
    }));
    const msgs = selectMessages('111@s.whatsapp.net', window, defaultOpts({ reactions: 'inline' }), 100);
    const targetMsg = msgs.find((m) => m.id === 'mom-0');
    expect(targetMsg?.reactions_to_self).toBeDefined();
    expect(targetMsg!.reactions_to_self![0].emoji).toBe('👍');
  });

  it('selectMessages omits reactions when reactions=omit', () => {
    messagesRepo.upsert(makeMessage({
      id: 'rxn', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_005,
      message_type: 'reaction', reaction_emoji: '👍', reaction_target_id: 'mom-0',
    }));
    const msgs = selectMessages('111@s.whatsapp.net', window, defaultOpts({ reactions: 'omit' }), 100);
    expect(msgs.find((m) => m.message_type === 'reaction')).toBeUndefined();
  });
});
