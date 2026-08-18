import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { createTestDb } from '../../test-utils/db.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolResult } from '../types.js';

let db: Database.Database;

vi.mock('../../database/index.js', () => ({ getDb: () => db }));
// `messagesRepo` reads config at import time to decide whether to strip raw
// payloads; the inbox never looks at them, so pin it rather than load real env.
vi.mock('../../config.js', () => ({
  config: { security: { stripRawMessages: false }, mediaDir: '/tmp/test-media' },
}));

// Import AFTER mocks are set up.
const { chatsRepo } = await import('../../database/repositories/chats.js');
const { messagesRepo } = await import('../../database/repositories/messages.js');
const { contactsRepo } = await import('../../database/repositories/contacts.js');
const { groupsRepo } = await import('../../database/repositories/groups.js');
const { inboxTools } = await import('./inbox.js');

/**
 * A stand-in `McpServer` that keeps the registration instead of serving it.
 * The zod shape is parsed before the handler runs, exactly as the SDK does it,
 * so defaults and coercion are under test rather than assumed.
 */
interface Registered {
  name: string;
  config: { inputSchema: z.ZodRawShape; description: string; annotations: Record<string, unknown> };
  handler: (args: unknown, extra?: unknown) => Promise<ToolResult>;
}

function register(): Registered {
  let captured: Registered | undefined;
  const fake = {
    registerTool(name: string, config: Registered['config'], handler: Registered['handler']) {
      captured = { name, config, handler };
    },
  } as unknown as McpServer;
  for (const tool of inboxTools) tool.register(fake);
  if (!captured) throw new Error('inboxTools registered nothing');
  return captured;
}

async function inbox(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const tool = register();
  const parsed = z.object(tool.config.inputSchema).parse(args);
  return tool.handler(parsed);
}

/** What the model actually reads. */
function content(result: ToolResult): string {
  return result.content.map((c) => c.text).join('\n');
}

interface StructuredChat {
  name: string | null;
  jid: string;
  is_group: boolean;
  unread_count: number;
  last_message_ts: number | null;
  last_message_preview: string | null;
  last_message_sender: string | null;
}

function structured(result: ToolResult) {
  return result.structuredContent as unknown as {
    unread_chat_count: number;
    unread: StructuredChat[];
    recent: StructuredChat[];
    include_read: boolean;
    limit: number;
    timezone: string;
    generated_at: number;
    next_call: string | null;
  };
}

const NOW = Math.floor(Date.now() / 1000);
const MINUTES = 60;
const HOURS = 3600;

/** Seed one chat. `ago` is seconds before now for its last message. */
function chat(opts: {
  jid: string;
  name?: string;
  unread?: number;
  ago?: number;
  body?: string;
  group?: boolean;
}) {
  chatsRepo.upsert({
    jid: opts.jid,
    name: opts.name,
    is_group: opts.group ? 1 : 0,
    unread_count: opts.unread ?? 0,
    last_message_ts: opts.ago === undefined ? undefined : NOW - opts.ago,
    last_message_body: opts.body,
  });
}

/**
 * Seed the message a chat's preview came from. `ago` must match the chat's own
 * `ago` — that agreement is exactly what the attribution keys off, and the
 * tests that deliberately break it say so.
 */
function lastMessage(opts: {
  jid: string;
  ago: number;
  body: string;
  from_me?: boolean;
  sender?: string;
  push_name?: string;
}) {
  messagesRepo.upsert({
    id: `msg-${opts.jid}-${opts.ago}`,
    remote_jid: opts.jid,
    from_jid: opts.sender,
    participant: opts.sender,
    from_me: opts.from_me ? 1 : 0,
    timestamp: NOW - opts.ago,
    push_name: opts.push_name,
    message_type: 'text',
    body: opts.body,
  });
}

const FAMILIA = '120363000000000001@g.us';
const ANA = '5511999990001@s.whatsapp.net';
const BRUNO = '5511999990002@s.whatsapp.net';
const NAMELESS = '5511999994821@s.whatsapp.net';
const TRABALHO = '120363000000000002@g.us';
/** A group participant — never a chat of its own. */
const MAE = '5511999997777@s.whatsapp.net';

describe('whatsapp_inbox', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  describe('registration', () => {
    it('registers under the expected name with read-only annotations', () => {
      const tool = register();
      expect(tool.name).toBe('whatsapp_inbox');
      expect(tool.config.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
    });

    it('tells the model when to prefer it over the neighbouring read tools', () => {
      const { description } = register().config;
      expect(description).toContain('whatsapp_overview');
      expect(description).toContain('list_chats');
      expect(description).toContain('get_conversation');
    });
  });

  describe('nothing to show', () => {
    it('says the mirror is empty when there are no chats at all', async () => {
      const result = await inbox();

      expect(content(result)).toContain('No chats in the local mirror yet');
      expect(structured(result).unread_chat_count).toBe(0);
      expect(structured(result).next_call).toBeNull();
    });

    it('distinguishes "chats exist, no messages" from an empty mirror', async () => {
      chat({ jid: ANA, name: 'Ana Costa' });

      const result = await inbox();

      expect(content(result)).toContain('none of them has a message in it yet');
    });
  });

  describe('nothing unread', () => {
    beforeEach(() => {
      chat({ jid: ANA, name: 'Ana Costa', ago: 2 * HOURS, body: 'ok, mando amanhã' });
      chat({ jid: BRUNO, name: 'Bruno', ago: 3 * 86400, body: 'valeu' });
    });

    it('does not stop at "nothing unread" — it falls back to the recent chats', async () => {
      const text = content(await inbox());

      expect(text).toContain('Nothing unread');
      expect(text).toContain('Most recent chats');
      expect(text).toContain('Ana Costa');
      expect(text).toContain('Bruno');
    });

    it('warns that the unread count is the phone’s and can lag', async () => {
      expect(content(await inbox())).toContain('resets there the moment a chat is opened');
    });

    it('still ends with a call that opens the newest chat', async () => {
      const text = content(await inbox());

      expect(text).toContain('Read one: get_conversation(chat="Ana Costa", last_n=50)');
    });

    it('reports the fallback list under `recent`, leaving `unread` empty', async () => {
      const s = structured(await inbox());

      expect(s.unread).toEqual([]);
      expect(s.unread_chat_count).toBe(0);
      expect(s.recent.map((c) => c.name)).toEqual(['Ana Costa', 'Bruno']);
    });
  });

  describe('unread chats', () => {
    beforeEach(() => {
      chat({
        jid: FAMILIA,
        name: 'Família',
        group: true,
        unread: 3,
        ago: 2 * HOURS,
        body: 'vc vem jantar hoje?',
      });
      chat({ jid: ANA, name: 'Ana Costa', unread: 1, ago: 5 * HOURS, body: 'mando o arquivo amanhã' });
      chat({ jid: BRUNO, name: 'Bruno', unread: 7, ago: 20 * MINUTES, body: 'olha isso' });
      // Read, and more recent than every unread chat — must not jump the queue.
      chat({ jid: TRABALHO, name: 'Trabalho', group: true, ago: 5 * MINUTES, body: 'fechado' });
    });

    it('lists unread chats newest-first, and only unread ones by default', async () => {
      const text = content(await inbox());

      const bruno = text.indexOf('Bruno');
      const familia = text.indexOf('Família');
      const ana = text.indexOf('Ana Costa');
      expect(bruno).toBeGreaterThan(-1);
      expect(bruno).toBeLessThan(familia);
      expect(familia).toBeLessThan(ana);
      expect(text).not.toContain('Trabalho');
    });

    it('heads the screen with the count, the plural and the reference stamp', async () => {
      const text = content(await inbox({ timezone: 'UTC' }));

      expect(text).toContain('3 chats with unread messages');
      expect(text).toMatch(/Ages are measured from \d{2}-\d{2} \d{2}:\d{2} \(UTC\)/);
    });

    it('carries the unread count, the age and the last line on each chat line', async () => {
      const text = content(await inbox());

      expect(text).toContain('Família · group · 3 unread · 2h · vc vem jantar hoje?');
    });

    it('renders the stamp in the requested timezone', async () => {
      const utc = content(await inbox({ timezone: 'UTC' }));
      const tokyo = content(await inbox({ timezone: 'Asia/Tokyo' }));

      expect(tokyo).toContain('(Asia/Tokyo)');
      // Same instant, nine hours apart: the two stamps cannot be equal.
      const stampOf = (t: string) => t.match(/measured from (\S+ \S+) \(/)![1];
      expect(stampOf(tokyo)).not.toBe(stampOf(utc));
    });

    it('names UTC, not the caller’s nonsense, when the zone is unusable', async () => {
      const text = content(await inbox({ timezone: 'Mars/Olympus_Mons' }));

      expect(text).toContain('(UTC)');
      expect(text).not.toContain('Mars/Olympus_Mons');
    });

    it('singularises the header for exactly one unread chat', async () => {
      db = createTestDb();
      chat({ jid: ANA, name: 'Ana Costa', unread: 1, ago: 1 * HOURS, body: 'oi' });

      expect(content(await inbox())).toContain('1 chat with unread messages');
    });

    it('keeps JIDs in structuredContent for programmatic clients', async () => {
      const s = structured(await inbox());

      expect(s.unread_chat_count).toBe(3);
      expect(s.unread.map((c) => c.jid)).toEqual([BRUNO, FAMILIA, ANA]);
      expect(s.unread[1]).toMatchObject({
        name: 'Família',
        jid: FAMILIA,
        is_group: true,
        unread_count: 3,
        last_message_preview: 'vc vem jantar hoje?',
      });
    });
  });

  describe('limit', () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        chat({
          jid: `551199999${1000 + i}@s.whatsapp.net`,
          name: `Contact ${i}`,
          unread: 1,
          ago: (i + 1) * HOURS,
          body: `line ${i}`,
        });
      }
    });

    it('caps the list but reports the true total', async () => {
      const result = await inbox({ limit: 2 });

      expect(content(result)).toContain('5 chats with unread messages, 2 newest shown');
      expect(structured(result).unread).toHaveLength(2);
      expect(structured(result).unread_chat_count).toBe(5);
    });

    it('accepts a limit passed as a string, the way models write them', async () => {
      const result = await inbox({ limit: '2' });

      expect(structured(result).unread).toHaveLength(2);
      expect(structured(result).limit).toBe(2);
    });

    it('defaults to 15 when the caller omits it', async () => {
      expect(structured(await inbox()).limit).toBe(15);
    });
  });

  describe('include_read', () => {
    beforeEach(() => {
      chat({ jid: ANA, name: 'Ana Costa', unread: 2, ago: 1 * HOURS, body: 'me liga' });
      chat({ jid: TRABALHO, name: 'Trabalho', group: true, ago: 30 * MINUTES, body: 'fechado' });
      chat({ jid: BRUNO, name: 'Bruno', ago: 2 * 86400, body: 'até mais' });
    });

    it('hides read chats by default', async () => {
      const result = await inbox();

      expect(content(result)).not.toContain('Trabalho');
      expect(content(result)).not.toContain('Recently active');
      expect(structured(result).recent).toEqual([]);
    });

    it('appends them under their own heading when asked', async () => {
      const result = await inbox({ include_read: true });
      const text = content(result);

      expect(text).toContain('Recently active, nothing unread:');
      expect(text.indexOf('Ana Costa')).toBeLessThan(text.indexOf('Recently active'));
      expect(text.indexOf('Recently active')).toBeLessThan(text.indexOf('Trabalho'));
      expect(structured(result).recent.map((c) => c.name)).toEqual(['Trabalho', 'Bruno']);
    });

    it('never files an unread chat under "nothing unread", even past the limit', async () => {
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 9, ago: 10 * MINUTES });

      // limit 1 shows only Família; Ana is unread and must not reappear below.
      const result = await inbox({ limit: 1, include_read: true });

      expect(structured(result).recent.map((c) => c.name)).not.toContain('Ana Costa');
      expect(content(result).indexOf('Ana Costa')).toBe(-1);
    });

    it('omits chats that have never had a message', async () => {
      chat({ jid: NAMELESS });

      const result = await inbox({ include_read: true });

      expect(structured(result).recent.map((c) => c.jid)).not.toContain(NAMELESS);
    });
  });

  describe('identity', () => {
    it('masks a chat with no name anywhere instead of printing its JID', async () => {
      chat({ jid: NAMELESS, unread: 1, ago: 10 * MINUTES, body: 'quem é?' });

      const text = content(await inbox());

      expect(text).toContain('…4821 (DM)');
      expect(text).not.toContain(NAMELESS);
      expect(text).not.toContain('5511999994821');
    });

    it('falls back to the contact record when the chat row has no name', async () => {
      chat({ jid: ANA, unread: 1, ago: 10 * MINUTES, body: 'oi' });
      contactsRepo.upsert({ jid: ANA, name: 'Ana Costa' });

      const text = content(await inbox());

      expect(text).toContain('Ana Costa');
      expect(text).not.toContain('…0001');
    });

    it('falls back to the group record for a nameless group chat', async () => {
      chat({ jid: FAMILIA, group: true, unread: 4, ago: 10 * MINUTES, body: 'bom dia' });
      groupsRepo.upsert({ jid: FAMILIA, name: 'Família' });

      expect(content(await inbox())).toContain('Família · group · 4 unread');
    });

    it('never leaks a JID into content, in any section', async () => {
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 3, ago: 1 * HOURS, body: 'oi' });
      chat({ jid: NAMELESS, unread: 1, ago: 2 * HOURS, body: 'quem é?' });
      chat({ jid: TRABALHO, group: true, ago: 3 * HOURS, body: 'fechado' });
      chat({ jid: BRUNO, name: 'Bruno', ago: 4 * HOURS, body: 'até' });

      const text = content(await inbox({ include_read: true }));

      expect(text).not.toContain('@s.whatsapp.net');
      expect(text).not.toContain('@g.us');
      // The structured half keeps every one of them.
      const s = structured(await inbox({ include_read: true }));
      expect([...s.unread, ...s.recent].map((c) => c.jid).sort()).toEqual(
        [FAMILIA, NAMELESS, TRABALHO, BRUNO].sort(),
      );
    });
  });

  describe('sender attribution', () => {
    it('names the participant who spoke in a group', async () => {
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 3, ago: 2 * HOURS, body: 'vc vem jantar hoje?' });
      lastMessage({ jid: FAMILIA, ago: 2 * HOURS, body: 'vc vem jantar hoje?', sender: MAE });
      contactsRepo.upsert({ jid: MAE, name: 'Mãe' });

      expect(content(await inbox())).toContain(
        'Família · group · 3 unread · 2h · Mãe: vc vem jantar hoje?',
      );
    });

    it('falls back to the push name when the participant is not a saved contact', async () => {
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 1, ago: 1 * HOURS, body: 'cheguei' });
      lastMessage({ jid: FAMILIA, ago: 1 * HOURS, body: 'cheguei', sender: MAE, push_name: 'Tia Lu' });

      expect(content(await inbox())).toContain('· Tia Lu: cheguei');
    });

    it('masks an unresolvable participant rather than printing their JID', async () => {
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 1, ago: 1 * HOURS, body: 'quem adicionou?' });
      lastMessage({ jid: FAMILIA, ago: 1 * HOURS, body: 'quem adicionou?', sender: MAE });

      const text = content(await inbox());

      expect(text).toContain('…7777: quem adicionou?');
      expect(text).not.toContain(MAE);
      expect(text).not.toContain('@s.whatsapp.net');
    });

    it('marks the user’s own outgoing message in a DM, where it would otherwise read as theirs', async () => {
      chat({ jid: ANA, name: 'Ana Costa', ago: 5 * HOURS, body: 'ok, mando o arquivo amanhã' });
      lastMessage({ jid: ANA, ago: 5 * HOURS, body: 'ok, mando o arquivo amanhã', from_me: true });

      expect(content(await inbox())).toContain('Ana Costa · 5h · you: ok, mando o arquivo amanhã');
    });

    it('marks an outgoing message in a group too', async () => {
      chat({ jid: TRABALHO, name: 'Trabalho', group: true, ago: 40 * MINUTES, body: 'subo depois do almoço' });
      lastMessage({ jid: TRABALHO, ago: 40 * MINUTES, body: 'subo depois do almoço', from_me: true });

      expect(content(await inbox())).toContain('· you: subo depois do almoço');
    });

    it('says nothing extra for an incoming DM — the sender is the chat', async () => {
      chat({ jid: ANA, name: 'Ana Costa', unread: 1, ago: 5 * HOURS, body: 'me liga quando puder' });
      lastMessage({ jid: ANA, ago: 5 * HOURS, body: 'me liga quando puder', sender: ANA });
      contactsRepo.upsert({ jid: ANA, name: 'Ana Costa' });

      expect(content(await inbox())).toContain('Ana Costa · 1 unread · 5h · me liga quando puder');
    });

    it('falls back silently to the bare preview when the message was never stored', async () => {
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 2, ago: 2 * HOURS, body: 'só o preview' });

      const result = await inbox();

      expect(content(result)).toContain('Família · group · 2 unread · 2h · só o preview');
      expect(result.isError).toBeUndefined();
      expect(structured(result).unread[0].last_message_sender).toBeNull();
    });

    it('refuses to attribute when the newest stored message is not the previewed one', async () => {
      // A partial sync: the chat row moved on, the messages table did not.
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 2, ago: 1 * HOURS, body: 'a mais nova' });
      lastMessage({ jid: FAMILIA, ago: 9 * HOURS, body: 'uma bem mais velha', sender: MAE });
      contactsRepo.upsert({ jid: MAE, name: 'Mãe' });

      const result = await inbox();

      expect(content(result)).toContain('Família · group · 2 unread · 1h · a mais nova');
      expect(content(result)).not.toContain('Mãe');
      expect(structured(result).unread[0].last_message_sender).toBeNull();
    });

    it('keeps the sender as its own field in structuredContent', async () => {
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 1, ago: 1 * HOURS, body: 'bom dia' });
      lastMessage({ jid: FAMILIA, ago: 1 * HOURS, body: 'bom dia', sender: MAE });
      contactsRepo.upsert({ jid: MAE, name: 'Mãe' });

      expect(structured(await inbox()).unread[0]).toMatchObject({
        last_message_sender: 'Mãe',
        // The preview stays the raw body — gluing the two together is the prose
        // half's job, not a programmatic client's problem.
        last_message_preview: 'bom dia',
      });
    });

    it('spends the sender’s characters on the sender, not on the message', async () => {
      const body = 'x'.repeat(200);
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 1, ago: 1 * HOURS, body });
      lastMessage({ jid: FAMILIA, ago: 1 * HOURS, body, sender: MAE });
      contactsRepo.upsert({ jid: MAE, name: 'Uma Pessoa De Nome Bem Comprido' });

      const chatLine = content(await inbox()).split('\n')[1];
      const preview = chatLine.split(' · ').pop()!;

      // 80 characters of body survive whatever the name costs (the last is the ellipsis).
      expect(preview).toBe(`Uma Pessoa De Nome Bem Comprido: ${'x'.repeat(79)}…`);
    });
  });

  describe('layout', () => {
    it('reads as one screen: each heading hugs its rows, blank lines between sections', async () => {
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 3, ago: 2 * HOURS, body: 'vc vem jantar hoje?' });
      lastMessage({ jid: FAMILIA, ago: 2 * HOURS, body: 'vc vem jantar hoje?', sender: MAE });
      contactsRepo.upsert({ jid: MAE, name: 'Mãe' });
      chat({ jid: NAMELESS, unread: 2, ago: 26 * HOURS, body: 'confirmando sua consulta' });
      lastMessage({ jid: NAMELESS, ago: 26 * HOURS, body: 'confirmando sua consulta', sender: NAMELESS });
      chat({ jid: TRABALHO, name: 'Trabalho', group: true, ago: 40 * MINUTES, body: 'fechado então' });
      lastMessage({ jid: TRABALHO, ago: 40 * MINUTES, body: 'fechado então', from_me: true });

      // The stamp is the only part that moves; everything else is pinned.
      const text = content(await inbox({ include_read: true, timezone: 'UTC' })).replace(
        /\d{2}-\d{2} \d{2}:\d{2}/,
        '<stamp>',
      );

      expect(text).toBe(
        [
          '2 chats with unread messages. Ages are measured from <stamp> (UTC).',
          'Família · group · 3 unread · 2h · Mãe: vc vem jantar hoje?',
          '…4821 (DM) · 2 unread · 1d · confirmando sua consulta',
          '',
          'Recently active, nothing unread:',
          'Trabalho · group · 40m · you: fechado então',
          '',
          'Read one: get_conversation(chat="Família", last_n=50)',
          'Then clear it: resolve_contact(query="Família") for its JID, then `mark_read(jid=…)`. ' +
            'That sends real blue ticks to real people and cannot be undone, so only once you ' +
            'have actually read it.',
        ].join('\n'),
      );
    });
  });

  describe('continuation', () => {
    it('points at the top unread chat by its resolved name', async () => {
      chat({ jid: FAMILIA, name: 'Família', group: true, unread: 3, ago: 1 * HOURS, body: 'oi' });
      chat({ jid: ANA, name: 'Ana Costa', unread: 1, ago: 5 * HOURS, body: 'oi' });

      const result = await inbox();

      expect(content(result)).toContain('Read one: get_conversation(chat="Família", last_n=50)');
      expect(structured(result).next_call).toBe(
        'get_conversation(chat="Família", last_n=50)',
      );
    });

    it('is the last thing the model reads', async () => {
      chat({ jid: ANA, name: 'Ana Costa', ago: 1 * HOURS, body: 'oi' });

      const lines = content(await inbox()).trimEnd().split('\n');

      expect(lines[lines.length - 1]).toBe(
        'Read one: get_conversation(chat="Ana Costa", last_n=50)',
      );
    });

    it('offers the clear as a second call when something is unread', async () => {
      chat({ jid: ANA, name: 'Ana Costa', unread: 1, ago: 1 * HOURS, body: 'oi' });

      const lines = content(await inbox()).trimEnd().split('\n');

      expect(lines[lines.length - 2]).toBe(
        'Read one: get_conversation(chat="Ana Costa", last_n=50)',
      );
      // `mark_read` takes a JID and only a JID, and a JID is the one thing that
      // may not be printed — so the lookup that produces one is spelled out.
      expect(lines[lines.length - 1]).toBe(
        'Then clear it: resolve_contact(query="Ana Costa") for its JID, then `mark_read(jid=…)`. ' +
          'That sends real blue ticks to real people and cannot be undone, so only once you ' +
          'have actually read it.',
      );
    });

    it('says out loud that clearing is visible to the other person', async () => {
      chat({ jid: ANA, name: 'Ana Costa', unread: 1, ago: 1 * HOURS, body: 'oi' });

      const text = content(await inbox());

      expect(text).toContain('real blue ticks to real people');
      expect(text).toContain('cannot be undone');
    });

    it('does not offer the clear when nothing is unread', async () => {
      chat({ jid: ANA, name: 'Ana Costa', ago: 1 * HOURS, body: 'oi' });

      const text = content(await inbox());

      expect(text).toContain('Read one: get_conversation(chat="Ana Costa", last_n=50)');
      expect(text).not.toContain('mark_read');
    });

    it('does not offer the clear when the only named chat is a read one', async () => {
      // The continuation falls through to a read chat here; marking that one
      // read would be a no-op signal fired at someone for nothing.
      chat({ jid: NAMELESS, unread: 2, ago: 10 * MINUTES, body: 'quem é?' });
      chat({ jid: ANA, name: 'Ana Costa', ago: 3 * HOURS, body: 'oi' });

      const result = await inbox({ include_read: true });

      expect(structured(result).next_call).toBe('get_conversation(chat="Ana Costa", last_n=50)');
      expect(content(result)).not.toContain('mark_read');
    });

    it('skips a nameless top chat — a masked label would resolve to nothing', async () => {
      chat({ jid: NAMELESS, unread: 2, ago: 10 * MINUTES, body: 'quem é?' });
      chat({ jid: ANA, name: 'Ana Costa', unread: 1, ago: 3 * HOURS, body: 'oi' });

      expect(structured(await inbox()).next_call).toBe(
        'get_conversation(chat="Ana Costa", last_n=50)',
      );
    });

    it('offers list_chats when nothing on screen has a name to call it by', async () => {
      chat({ jid: NAMELESS, unread: 2, ago: 10 * MINUTES, body: 'quem é?' });

      const result = await inbox();

      expect(structured(result).next_call).toBe('list_chats(unread_only=true, limit=15)');
      expect(content(result)).toContain('No chat here has a name to address it by');
    });
  });
});
