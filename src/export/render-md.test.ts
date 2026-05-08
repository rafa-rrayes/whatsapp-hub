import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render-md.js';
import type { ExportContext, SelectedChat, SelectedMessage } from './types.js';
import type { ChatRow } from '../database/repositories/chats.js';

function makeChat(jid: string, name: string, isGroup = false): ChatRow {
  return {
    jid,
    name,
    is_group: isGroup ? 1 : 0,
    is_archived: 0,
    is_pinned: 0,
    is_muted: 0,
    unread_count: 0,
    last_message_ts: 1_700_000_000,
    last_message_body: 'last',
    updated_at: '2026-01-01',
  };
}

function makeMsg(over: Partial<SelectedMessage> & { id: string; remote_jid: string; timestamp: number }): SelectedMessage {
  return {
    from_me: 0,
    is_forwarded: 0,
    forward_score: 0,
    is_starred: 0,
    is_broadcast: 0,
    is_ephemeral: 0,
    edit_type: 0,
    is_deleted: 0,
    has_media: 0,
    created_at: '',
    ...over,
  } as SelectedMessage;
}

function makeContext(overrides: Partial<ExportContext> = {}): ExportContext {
  const ctx: ExportContext = {
    options: {
      days: 1,
      from: undefined,
      to: undefined,
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
    } as ExportContext['options'],
    window: { from: 1_699_900_000, to: 1_700_100_000 },
    baseUrl: 'http://localhost:3100',
    generatedAt: new Date('2026-05-08T18:43:00Z'),
    resolveName: (jid, fallback) => fallback || (jid ? `+${jid.split('@')[0]}` : 'Unknown'),
    resolveChatLabel: (jid) => jid,
    formatTime: (unix) => new Date(unix * 1000).toISOString().slice(11, 16),
    formatDate: (unix) => new Date(unix * 1000).toISOString().slice(0, 10),
    formatDateGroup: (unix) => new Date(unix * 1000).toISOString().slice(0, 10),
    fields: new Set(['timestamp', 'sender', 'body', 'media', 'reply', 'reactions', 'edits', 'forwarded', 'starred']),
    ...overrides,
  };
  return ctx;
}

describe('renderMarkdown', () => {
  it('produces YAML frontmatter at the top', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const msg = makeMsg({ id: 'm1', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_000, body: 'Hello' });
    const ctx = makeContext();
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toMatch(/generated_at: 2026-05-08T18:43:00\.000Z/);
    expect(md).toMatch(/messages_included: 1/);
    expect(md).toMatch(/chats_included: 1/);
  });

  it('renders an H1 title and TOC with anchor link', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const msg = makeMsg({ id: 'm1', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_000, body: 'Hi' });
    const ctx = makeContext();
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md).toMatch(/^# WhatsApp Export$/m);
    expect(md).toMatch(/^## Table of contents$/m);
    expect(md).toMatch(/\[111@s\.whatsapp\.net]\(#/);
  });

  it('renders chat header with type and JID', () => {
    const chat = makeChat('111-22@g.us', 'Soccer Tuesdays', true);
    const msg = makeMsg({
      id: 'm1', remote_jid: '111-22@g.us', participant: '999@s.whatsapp.net',
      timestamp: 1_700_000_000, body: 'who is in tonight?',
    });
    const ctx = makeContext({ resolveChatLabel: () => 'Soccer Tuesdays' });
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md).toMatch(/^## Soccer Tuesdays$/m);
    expect(md).toMatch(/> \*\*Type:\*\* Group/);
    expect(md).toMatch(/> \*\*JID:\*\* `111-22@g\.us`/);
  });

  it('renders messages with timestamp and sender', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const msg = makeMsg({
      id: 'm1', remote_jid: '111@s.whatsapp.net', from_me: 1,
      timestamp: 1_700_000_000, body: 'Olá!',
    });
    const ctx = makeContext();
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md).toMatch(/\*\*Me:\*\* Olá!/);
  });

  it('marks deleted messages with strikethrough', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const msg = makeMsg({
      id: 'm1', remote_jid: '111@s.whatsapp.net',
      timestamp: 1_700_000_000, body: 'before delete', is_deleted: 1,
    });
    const ctx = makeContext();
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md).toMatch(/~~_\(message deleted\)_~~/);
  });

  it('marks edited messages with (edited)', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const msg = makeMsg({
      id: 'm1', remote_jid: '111@s.whatsapp.net',
      timestamp: 1_700_000_000, body: 'fixed typo', edit_type: 1,
    });
    const ctx = makeContext();
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md).toMatch(/\*\(edited\)\*/);
  });

  it('renders reply quoted body as a blockquote', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const msg = makeMsg({
      id: 'm2', remote_jid: '111@s.whatsapp.net',
      timestamp: 1_700_000_001, body: 'Sim ma', quoted_id: 'm1', quoted_body: 'Filho, vc tá em casa?',
    });
    const ctx = makeContext();
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md).toMatch(/> ↩ replying to: Filho, vc tá em casa\?/);
  });

  it('attaches reactions inline to their target', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const target = makeMsg({
      id: 'target', remote_jid: '111@s.whatsapp.net',
      timestamp: 1_700_000_000, body: 'fun day',
      reactions_to_self: [{ emoji: '👍', from_jid: '999@s.whatsapp.net', from_label: '' }],
    });
    const ctx = makeContext();
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [target]]]),
      ctx
    );
    expect(md).toMatch(/> 👍 \+999/);
  });

  it('skips media in default `none` mode but emits placeholder', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const msg = makeMsg({
      id: 'm1', remote_jid: '111@s.whatsapp.net',
      timestamp: 1_700_000_000, body: 'check this', has_media: 1,
      media_id: 'media-1', media_mime_type: 'image/jpeg',
      media_filename: 'photo.jpg',
    });
    const ctx = makeContext();
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md).toMatch(/\*\[image: photo\.jpg\]\*/);
    expect(md).not.toMatch(/!\[/); // no real image markdown in 'none' mode
  });

  it('emits clickable refs in `media: ref` mode when downloaded', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const msg = makeMsg({
      id: 'm1', remote_jid: '111@s.whatsapp.net',
      timestamp: 1_700_000_000, body: 'photo', has_media: 1,
      media_id: 'media-1',
      media_row: {
        id: 'media-1', mime_type: 'image/jpeg', file_size: 12_345,
        original_filename: 'beach.jpg', file_path: '2026/04/23/file.jpg',
        download_status: 'downloaded', created_at: '',
      },
    });
    const ctx = makeContext({
      options: { ...makeContext().options, media: 'ref' } as ExportContext['options'],
    });
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md).toMatch(/!\[beach\.jpg\]\(http:\/\/localhost:3100\/api\/media\/media-1\/download\)/);
  });

  it('redacts phone numbers when redact_phone_numbers is true', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Friend');
    const msg = makeMsg({
      id: 'm1', remote_jid: '111@s.whatsapp.net',
      timestamp: 1_700_000_000, body: 'call me on +5511987654321',
    });
    const ctx = makeContext({
      options: { ...makeContext().options, redact_phone_numbers: true } as ExportContext['options'],
    });
    const md = renderMarkdown(
      [{ chat, message_count: 1 }],
      new Map([[chat.jid, [msg]]]),
      ctx
    );
    expect(md).not.toMatch(/5511987654321/);
    expect(md).toMatch(/•/);
  });

  it('inserts date subheading when date_grouping=day', () => {
    const chat = makeChat('111@s.whatsapp.net', 'Mom');
    const day1 = makeMsg({ id: 'd1', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_000_000, body: 'monday' });
    const day2 = makeMsg({ id: 'd2', remote_jid: '111@s.whatsapp.net', timestamp: 1_700_086_400, body: 'tuesday' });
    const ctx = makeContext();
    const md = renderMarkdown(
      [{ chat, message_count: 2 }],
      new Map([[chat.jid, [day1, day2]]]),
      ctx
    );
    const subheadings = md.match(/^### /gm) || [];
    expect(subheadings.length).toBeGreaterThanOrEqual(2);
  });
});
