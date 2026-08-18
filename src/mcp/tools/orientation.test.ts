import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb } from '../../test-utils/db.js';

/**
 * The three navigation tools answer in prose now. Two things are on trial here:
 * that the prose is worth reading, and — the harder constraint — that
 * `structuredContent` is exactly the object these tools have always returned.
 * The second half is asserted field by field, key order included, because a
 * programmatic client reading `structuredContent` must not be able to tell that
 * the rendering changed underneath it.
 *
 * The rule with no exceptions: no raw JID reaches `content`.
 */

let db: Database.Database;

vi.mock('../../database/index.js', () => ({
  getDb: () => db,
}));

const { orientationTools } = await import('./orientation.js');
const { chatsRepo } = await import('../../database/repositories/chats.js');
const { contactsRepo } = await import('../../database/repositories/contacts.js');
const { groupsRepo } = await import('../../database/repositories/groups.js');
const { messagesRepo } = await import('../../database/repositories/messages.js');

interface ToolResponse {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;

// The tools register against an McpServer; all this suite needs from one is the
// handler each tool hands it, so a recorder standing in for the server is both
// enough and immune to SDK churn.
const handlers = new Map<string, ToolHandler>();
for (const tool of orientationTools) {
  tool.register({
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  } as never);
}

const call = (name: string, args: Record<string, unknown> = {}): Promise<ToolResponse> =>
  handlers.get(name)!(args);

const textOf = (res: ToolResponse): string => res.content[0].text;

const HOUR = 3600;
const DAY = 86400;
const NOW = Math.floor(Date.now() / 1000);

const FAMILIA = '120363111111111111@g.us';
const ANA = '5511911111111@s.whatsapp.net';
const MARIA_A = '5511922224821@s.whatsapp.net';
const MARIA_B = '5511933339902@s.whatsapp.net';
const NAMELESS = '5511944445555@s.whatsapp.net';
const NAMELESS_LID = '77778888@lid';

/** Every JID spelling the hub can produce. None may appear in prose. */
const JID_DOMAINS = ['@s.whatsapp.net', '@g.us', '@lid'];

function expectNoJids(text: string): void {
  for (const domain of JID_DOMAINS) {
    expect(text).not.toContain(domain);
  }
  // Belt and braces: a bare 13-digit user part is a phone number even without
  // its domain, and would be just as much of a leak.
  expect(text).not.toMatch(/\d{11,}/);
}

let messageSeq = 0;
function seedMessages(jid: string, n: number, agoSec: number): void {
  for (let i = 0; i < n; i++) {
    messagesRepo.upsert({
      id: `msg-${messageSeq++}`,
      remote_jid: jid,
      timestamp: NOW - agoSec - i,
      body: `line ${i}`,
      message_type: 'conversation',
    });
  }
}

/** A small world: a busy named group, a named DM, and a chat with no name. */
function seedWorld(): void {
  groupsRepo.upsert({ jid: FAMILIA, name: 'Família' });
  chatsRepo.upsert({
    jid: FAMILIA,
    name: 'Família',
    is_group: 1,
    unread_count: 3,
    last_message_ts: NOW - 2 * HOUR,
    last_message_body: 'vc vem jantar hoje?',
  });
  seedMessages(FAMILIA, 5, 2 * HOUR);

  contactsRepo.upsert({ jid: ANA, name: 'Ana', phone_number: '5511911111111' });
  chatsRepo.upsert({
    jid: ANA,
    name: 'Ana',
    is_group: 0,
    unread_count: 0,
    last_message_ts: NOW - 5 * HOUR,
    last_message_body: 'bom dia!',
  });
  seedMessages(ANA, 2, 5 * HOUR);

  chatsRepo.upsert({
    jid: NAMELESS,
    is_group: 0,
    unread_count: 1,
    last_message_ts: NOW - 3 * DAY,
    last_message_body: 'oi, tudo bem?',
  });
  seedMessages(NAMELESS, 1, 3 * DAY);
}

/** `n` named chats, newest first, for the tests about how far a listing looked. */
function seedManyChats(n: number): void {
  for (let i = 0; i < n; i++) {
    chatsRepo.upsert({
      jid: `5511900${String(i).padStart(6, '0')}@s.whatsapp.net`,
      name: `Chat ${i}`,
      last_message_ts: NOW - i * HOUR,
      last_message_body: 'oi',
    });
  }
}

beforeEach(() => {
  db = createTestDb();
  messageSeq = 0;
});

describe('whatsapp_overview', () => {
  it('opens with a paragraph of totals and recent activity', async () => {
    seedWorld();

    const text = textOf(await call('whatsapp_overview', { days: 7 }));
    const paragraph = text.split('\n\n')[0];

    expect(paragraph).toContain('3 chats · 8 messages · 1 contact · 1 group.');
    expect(paragraph).toContain('Last 7 days: 8 messages, 2 chats with something unread.');
    // The stamp carries its date, and the age sits beside it.
    expect(paragraph).toMatch(/Last activity \d{2}-\d{2} \d{2}:\d{2} \(2h\)\./);
  });

  it('lists the busiest chats as lines, not objects', async () => {
    seedWorld();

    const text = textOf(await call('whatsapp_overview', {}));

    expect(text).toContain('Busiest in the last 7 days:');
    expect(text).toContain('Família · group · 3 unread · 2h · 5 messages');
    expect(text).toContain('Ana · 5h · 2 messages');
  });

  it('names the call that continues it', async () => {
    seedWorld();

    const text = textOf(await call('whatsapp_overview', {}));

    expect(text).toContain('Triage what is unread: list_chats(unread_only=true, limit=30)');
    expect(text).toContain('Read one: get_conversation(chat="Família", last_n=50)');
  });

  it('offers browsing rather than triage when nothing is unread', async () => {
    chatsRepo.upsert({
      jid: ANA,
      name: 'Ana',
      unread_count: 0,
      last_message_ts: NOW - HOUR,
      last_message_body: 'oi',
    });
    seedMessages(ANA, 1, HOUR);

    const text = textOf(await call('whatsapp_overview', {}));

    expect(text).toContain('nothing unread.');
    expect(text).toContain('Browse the chats: list_chats(limit=30)');
  });

  it('says the mirror is empty rather than rendering a table of zeroes', async () => {
    const res = await call('whatsapp_overview', {});

    expect(textOf(res)).toContain('No WhatsApp data has been mirrored yet');
    // The structured half still reports the zeroes for a programmatic caller.
    expect(res.structuredContent).toMatchObject({ total_chats: 0, total_messages: 0 });
  });

  it('masks a chat that has no name instead of printing its JID', async () => {
    chatsRepo.upsert({
      jid: NAMELESS,
      is_group: 0,
      last_message_ts: NOW - HOUR,
      last_message_body: 'oi',
    });
    seedMessages(NAMELESS, 3, HOUR);

    const text = textOf(await call('whatsapp_overview', {}));

    expect(text).toContain('…5555 (DM) · 1h · 3 messages');
    expectNoJids(text);
    // With no name to quote, there is no `get_conversation(chat=…)` worth
    // offering — a masked stand-in would resolve to nothing.
    expect(text).not.toContain('get_conversation');
  });

  it('keeps a raw JID out of the prose in every path', async () => {
    seedWorld();
    chatsRepo.upsert({
      jid: NAMELESS_LID,
      is_group: 0,
      last_message_ts: NOW - HOUR,
      last_message_body: 'hidden id chat',
    });
    seedMessages(NAMELESS_LID, 1, HOUR);

    expectNoJids(textOf(await call('whatsapp_overview', {})));
  });

  it('keeps structuredContent exactly as it was, JIDs and all', async () => {
    seedWorld();

    const res = await call('whatsapp_overview', { days: 7 });
    const structured = res.structuredContent!;

    expect(Object.keys(structured)).toEqual([
      'total_chats',
      'total_messages',
      'total_contacts',
      'total_groups',
      'messages_in_window',
      'window_days',
      'unread_chat_count',
      'top_active_chats',
      'last_activity_ts',
    ]);
    expect(structured).toEqual({
      total_chats: 3,
      total_messages: 8,
      total_contacts: 1,
      total_groups: 1,
      messages_in_window: 8,
      window_days: 7,
      unread_chat_count: 2,
      top_active_chats: [
        {
          name: 'Família',
          jid: FAMILIA,
          is_group: true,
          message_count_in_window: 5,
          last_message_ts: NOW - 2 * HOUR,
        },
        {
          name: 'Ana',
          jid: ANA,
          is_group: false,
          message_count_in_window: 2,
          last_message_ts: NOW - 5 * HOUR,
        },
        {
          // An unnamed chat still falls back to its JID here. That fallback is
          // the reason the prose half needs its own name resolution, and it
          // must survive untouched for clients that depend on it.
          name: NAMELESS,
          jid: NAMELESS,
          is_group: false,
          message_count_in_window: 1,
          last_message_ts: NOW - 3 * DAY,
        },
      ],
      last_activity_ts: NOW - 2 * HOUR,
    });
    expect(Object.keys(structured.top_active_chats as object[])).toHaveLength(3);
  });

  it('no longer duplicates the JSON into the model-visible half', async () => {
    seedWorld();

    const res = await call('whatsapp_overview', {});

    expect(textOf(res)).not.toBe(JSON.stringify(res.structuredContent, null, 2));
  });
});

describe('resolve_contact', () => {
  function seedTwoMarias(): void {
    contactsRepo.upsert({ jid: MARIA_A, name: 'Maria', phone_number: '5511922224821' });
    chatsRepo.upsert({
      jid: MARIA_A,
      name: 'Maria',
      is_group: 0,
      last_message_ts: NOW - 3 * DAY,
      last_message_body: 'vou levar o bolo',
    });
    contactsRepo.upsert({ jid: MARIA_B, name: 'Maria', phone_number: '5511933339902' });
    chatsRepo.upsert({
      jid: MARIA_B,
      name: 'Maria',
      is_group: 0,
      unread_count: 2,
      last_message_ts: NOW - 5 * HOUR,
      last_message_body: 'me liga quando puder',
    });
  }

  it('renders candidates as skimmable lines', async () => {
    seedWorld();

    const text = textOf(await call('resolve_contact', { query: 'Ana' }));

    expect(text).toContain('"Ana" is one chat:');
    expect(text).toContain('Ana · 5h · bom dia!');
    expect(text).toContain('Read it: get_conversation(chat="Ana", last_n=50)');
  });

  it('tells two people of the same name apart without printing either number', async () => {
    seedTwoMarias();

    const text = textOf(await call('resolve_contact', { query: 'Maria' }));

    expect(text).toContain('2 matches for "Maria", best first:');
    expect(text).toContain('Maria · …9902 (DM) · 2 unread · 5h · me liga quando puder');
    expect(text).toContain('Maria · …4821 (DM) · 3d · vou levar o bolo');
    expect(text).toContain('Where two lines share a name, pass the four digits shown instead');
    expect(text).toContain('get_conversation(chat="…", last_n=50)');
    expectNoJids(text);
    // And no worked example naming "Maria": that call resolves to an ambiguity
    // error, which is the very thing this listing exists to avoid.
    expect(text).not.toContain('get_conversation(chat="Maria"');
  });

  it('still offers a worked example when an unambiguous name is on the list', async () => {
    seedTwoMarias();
    chatsRepo.upsert({
      jid: ANA,
      name: 'Maria Ana',
      last_message_ts: NOW - HOUR,
      last_message_body: 'oi',
    });

    const text = textOf(await call('resolve_contact', { query: 'Maria' }));

    expect(text).toContain(
      'Any tool that takes a chat takes one of these names, e.g. get_conversation(chat="Maria Ana", last_n=50)',
    );
    expect(text).toContain('Where two lines share a name');
  });

  it('gives advice that works: the four digits it shows do resolve', async () => {
    seedTwoMarias();

    const res = await call('resolve_contact', { query: '4821' });
    const candidates = res.structuredContent!.candidates as Array<{ jid: string }>;

    expect(candidates).toHaveLength(1);
    expect(candidates[0].jid).toBe(MARIA_A);
    expect(textOf(res)).toContain('is one chat:');
  });

  it('leaves the masked digits off when a name is unambiguous', async () => {
    seedWorld();

    const text = textOf(await call('resolve_contact', { query: 'Ana' }));

    expect(text).not.toContain('(DM)');
    expect(text).not.toContain('share a name');
  });

  it('masks a candidate that has no name at all', async () => {
    chatsRepo.upsert({
      jid: NAMELESS,
      is_group: 0,
      last_message_ts: NOW - 2 * HOUR,
      last_message_body: 'oi, tudo bem?',
    });

    const text = textOf(await call('resolve_contact', { query: '4444' }));

    expect(text).toContain('…5555 (DM) · 2h · oi, tudo bem?');
    expect(text).toContain('No name is on record for these');
    expectNoJids(text);
  });

  it('says what to try next when nothing matches', async () => {
    seedWorld();

    const text = textOf(await call('resolve_contact', { query: 'Nobody' }));

    expect(text).toBe(
      'Nothing matched "Nobody". Try fewer words or part of a phone number, ' +
      'or list_chats(limit=30) to see what exists.',
    );
  });

  it('keeps every candidate field, JIDs included, in structuredContent', async () => {
    seedTwoMarias();

    const res = await call('resolve_contact', { query: 'Maria' });
    const structured = res.structuredContent!;

    expect(Object.keys(structured)).toEqual(['query', 'candidates']);
    expect(structured.query).toBe('Maria');
    expect(structured.candidates).toEqual([
      {
        jid: MARIA_B,
        name: 'Maria',
        kind: 'contact',
        is_group: false,
        score: 900,
        last_message_ts: NOW - 5 * HOUR,
        unread_count: 2,
        last_message_preview: 'me liga quando puder',
        phone_number: '5511933339902',
      },
      {
        jid: MARIA_A,
        name: 'Maria',
        kind: 'contact',
        is_group: false,
        score: 900,
        last_message_ts: NOW - 3 * DAY,
        unread_count: 0,
        last_message_preview: 'vou levar o bolo',
        phone_number: '5511922224821',
      },
    ]);
  });

  it('masks the echoed query when the caller asked with a JID', async () => {
    seedWorld();

    const res = await call('resolve_contact', { query: FAMILIA });

    // The head repeats what was asked, so a JID query is a way for one to walk
    // straight back into the model's context. It gets masked like any other.
    expect(textOf(res)).toContain('…1111 (group) is one chat:');
    expectNoJids(textOf(res));
    // The exact-JID short-circuit still resolves, and still reports the JID in
    // the structured half.
    expect((res.structuredContent!.candidates as Array<{ jid: string }>)[0].jid).toBe(FAMILIA);
  });

  it('surfaces an unnamed JID query as a mask rather than an echo', async () => {
    const res = await call('resolve_contact', { query: NAMELESS_LID });

    // resolveCandidates falls back to `name: query` — i.e. the JID itself —
    // when nothing is on record. The renderer has to catch that.
    expect((res.structuredContent!.candidates as Array<{ name: string }>)[0].name).toBe(NAMELESS_LID);
    expect(textOf(res)).toContain('…8888 (DM) · no messages');
    expectNoJids(textOf(res));
  });
});

describe('list_chats', () => {
  it('renders one chat per line, newest first', async () => {
    seedWorld();

    const text = textOf(await call('list_chats', {}));
    const lines = text.split('\n');

    expect(lines[0]).toBe('3 chats, newest first:');
    expect(lines[1]).toBe('Família · group · 3 unread · 2h · vc vem jantar hoje?');
    expect(lines[2]).toBe('Ana · 5h · bom dia!');
    expect(lines[3]).toBe('…5555 (DM) · 1 unread · 3d · oi, tudo bem?');
    expectNoJids(text);
  });

  it('says in the head what was filtered for', async () => {
    seedWorld();

    const text = textOf(await call('list_chats', { unread_only: true, dms_only: true }));

    expect(text.split('\n')[0]).toBe('1 unread DM, newest first:');
  });

  it('masks a JID the caller passed as a name filter', async () => {
    seedWorld();

    const text = textOf(await call('list_chats', { name_contains: ANA }));

    expect(text.split('\n')[0]).toBe('1 chat matching …1111 (DM), newest first:');
    expectNoJids(text);
  });

  it('states the exact call that returns the rest', async () => {
    seedWorld();

    const text = textOf(await call('list_chats', { limit: 1 }));

    expect(text).toContain('… 2 more chats · list_chats(limit=3)');
  });

  it('carries the filters into the continuation call', async () => {
    seedWorld();
    chatsRepo.upsert({
      jid: MARIA_A,
      name: 'Maria',
      unread_count: 1,
      last_message_ts: NOW - HOUR,
      last_message_body: 'oi',
    });

    const text = textOf(await call('list_chats', { limit: 1, unread_only: true }));

    expect(text).toContain('… 2 more chats · list_chats(unread_only=true, limit=3)');
  });

  it('asks for a narrower question once the limit is at its ceiling', async () => {
    seedManyChats(205);

    const text = textOf(await call('list_chats', { limit: 200 }));

    expect(text).toContain('… 5 more chats — narrow it: list_chats(name_contains="…")');
  });

  // `list_chats` filters in memory over a pool of chats, so once that pool comes
  // back full its counts stop being totals. A cap that reads as completeness is
  // worse than an obvious truncation: the model stops asking.
  describe('the scanned pool', () => {
    it('states an exact count while the pool still has room', async () => {
      seedManyChats(199);

      const text = textOf(await call('list_chats', { limit: 5 }));

      expect(text.split('\n')[0]).toBe('199 chats, newest first:');
      expect(text).not.toContain('at least');
      expect(text).not.toContain('floor');
      expect(text).toContain('… 194 more chats · list_chats(limit=199)');
    });

    it('calls the count a floor once the pool comes back full', async () => {
      seedManyChats(250);

      const text = textOf(await call('list_chats', { limit: 30 }));

      expect(text.split('\n')[0]).toBe('At least 200 chats, newest first:');
      expect(text).toContain(
        'Only the 200 most recently active chats were scanned, so 200 is a floor, not a total.',
      );
      expect(text).toContain('… at least 170 more chats · list_chats(limit=200)');
    });

    it('says the search was cut short even when nothing was truncated', async () => {
      seedManyChats(250);
      chatsRepo.upsert({
        jid: MARIA_A,
        name: 'Maria',
        unread_count: 2,
        last_message_ts: NOW - 1,
        last_message_body: 'oi',
      });

      const text = textOf(await call('list_chats', { unread_only: true }));

      // One line and no truncation marker: without the note below, nothing here
      // would suggest that 249 chats went unexamined.
      expect(text.split('\n')[0]).toBe('At least 1 unread chat, newest first:');
      expect(text).toContain(
        'Only the 200 most recently active chats were scanned, so 1 is a floor, not a total.',
      );
      expect(text).toContain('Look further: list_chats(unread_only=true, limit=200)');
    });

    it('offers narrowing, not a bigger limit, when the pool is at its own ceiling', async () => {
      seedManyChats(1005);

      const text = textOf(await call('list_chats', { limit: 200 }));

      expect(text.split('\n')[0]).toBe('At least 1000 chats, newest first:');
      expect(text).toContain(
        'Only the 1000 most recently active chats were scanned, so 1000 is a floor, not a total.',
      );
      expect(text).toContain('… at least 800 more chats — narrow it: list_chats(name_contains="…")');
      // Raising the limit cannot get past the ceiling, so it must not be offered.
      expect(text).not.toContain('limit=200)');
    });

    it('does not claim a filter matched nothing when it only scanned part of the way', async () => {
      seedManyChats(250);

      const text = textOf(await call('list_chats', { unread_only: true }));

      expect(text).toBe(
        'No unread chats among the 200 most recently active chats, which is as far as this looked. ' +
          'Look further: list_chats(unread_only=true, limit=200)',
      );
    });
  });

  it('points at a chat worth reading', async () => {
    seedWorld();

    const text = textOf(await call('list_chats', {}));

    expect(text).toContain(
      'Read one: get_conversation(chat="Família", last_n=50) — the name is the first field on each line.',
    );
  });

  it('does not offer a chat to read whose name means two chats', async () => {
    chatsRepo.upsert({ jid: MARIA_A, name: 'Maria', last_message_ts: NOW - HOUR, last_message_body: 'a' });
    chatsRepo.upsert({ jid: MARIA_B, name: 'Maria', last_message_ts: NOW - 2 * HOUR, last_message_body: 'b' });

    const text = textOf(await call('list_chats', {}));

    // `get_conversation(chat="Maria")` would come back as an ambiguity error.
    expect(text).not.toContain('Read one:');
  });

  it('offers a wider call when a filter matched nothing', async () => {
    seedWorld();

    const text = textOf(await call('list_chats', { unread_only: true, groups_only: true, name_contains: 'zzz' }));

    expect(text).toBe(
      'No unread group chats matching "zzz". Widen it: list_chats(limit=30)',
    );
  });

  it('says the mirror is empty when there is nothing at all', async () => {
    const text = textOf(await call('list_chats', {}));

    expect(text).toBe('No chats have been mirrored yet.');
  });

  it('keeps a raw JID out of the prose across group, DM and lid chats', async () => {
    seedWorld();
    chatsRepo.upsert({
      jid: NAMELESS_LID,
      is_group: 0,
      last_message_ts: NOW - HOUR,
      last_message_body: 'hidden id chat',
    });

    expectNoJids(textOf(await call('list_chats', {})));
  });

  it('keeps structuredContent exactly as it was, JIDs and all', async () => {
    seedWorld();

    const res = await call('list_chats', {});
    const structured = res.structuredContent!;

    expect(Object.keys(structured)).toEqual(['total', 'chats']);
    expect(structured).toEqual({
      total: 3,
      chats: [
        {
          name: 'Família',
          jid: FAMILIA,
          is_group: true,
          unread_count: 3,
          last_message_ts: NOW - 2 * HOUR,
          last_message_preview: 'vc vem jantar hoje?',
        },
        {
          name: 'Ana',
          jid: ANA,
          is_group: false,
          unread_count: 0,
          last_message_ts: NOW - 5 * HOUR,
          last_message_preview: 'bom dia!',
        },
        {
          name: NAMELESS,
          jid: NAMELESS,
          is_group: false,
          unread_count: 1,
          last_message_ts: NOW - 3 * DAY,
          last_message_preview: 'oi, tudo bem?',
        },
      ],
    });
  });

  it('still truncates the structured preview at 80 characters', async () => {
    const long = 'a'.repeat(200);
    chatsRepo.upsert({
      jid: ANA,
      name: 'Ana',
      last_message_ts: NOW - HOUR,
      last_message_body: long,
    });

    const res = await call('list_chats', {});
    const preview = (res.structuredContent!.chats as Array<{ last_message_preview: string }>)[0]
      .last_message_preview;

    expect(preview).toHaveLength(80);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('rejects mutually exclusive filters as before', async () => {
    const res = await call('list_chats', { groups_only: true, dms_only: true });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('mutually exclusive');
  });
});
