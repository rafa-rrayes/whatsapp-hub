import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTestDb } from '../../test-utils/db.js';
import { makeMessage, resetFixtures } from '../../test-utils/fixtures.js';
import type { ToolResult } from '../types.js';

let db: Database.Database;

// The repositories are real; only the handle to the database is swapped. A
// search tool that renders what SQLite actually returns is the thing worth
// testing — stubbing the repos would test the fixtures instead.
vi.mock('../../database/index.js', () => ({
  getDb: () => db,
}));

vi.mock('../../config.js', () => ({
  config: {
    security: { stripRawMessages: false },
  },
}));

// Imported after the mocks, or the repositories capture the real getDb.
const { searchTools } = await import('./search.js');
const { messagesRepo } = await import('../../database/repositories/messages.js');
const { chatsRepo } = await import('../../database/repositories/chats.js');
const { contactsRepo } = await import('../../database/repositories/contacts.js');
const { groupsRepo } = await import('../../database/repositories/groups.js');

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * Pulls a tool's handler out of the registration call.
 *
 * Calling it directly skips zod, which is deliberate: every default this tool
 * cares about (`limit`, `timezone`) is re-applied inside the handler, so the
 * test exercises the handler's own fallbacks rather than the schema's.
 */
function handlerFor(name: string): Handler {
  let captured: Handler | undefined;
  const stub = {
    registerTool(toolName: string, _config: unknown, handler: Handler) {
      if (toolName === name) captured = handler;
    },
  };
  for (const tool of searchTools) tool.register(stub as unknown as McpServer);
  if (!captured) throw new Error(`tool not registered: ${name}`);
  return captured;
}

const searchMessages = handlerFor('search_messages');

function contentOf(result: ToolResult): string {
  return result.content.map((c) => c.text).join('\n');
}

/**
 * Mid-June at noon UTC, this year. Chosen the way `prose.test.ts` chooses it:
 * no zone on earth pushes it across a year boundary, so `formatStamp` never
 * adds its year prefix and the suite does not go red on January 1st.
 */
const THIS_YEAR = new Date().getUTCFullYear();
const NOON = Date.UTC(THIS_YEAR, 5, 15, 12, 0, 0) / 1000;

const FAMILIA = '120363001234567890@g.us';
const ANA = '5511988887777@s.whatsapp.net';
const JOAO = '5511977776666@s.whatsapp.net';
const STRANGER = '5511900001234@s.whatsapp.net';

/**
 * Five hits over three chats: a named group, a DM named only by its contact
 * row, and a chat we have no name for anywhere. Newest first, which is the
 * order the tool returns.
 */
function seedCorpus(): void {
  groupsRepo.upsert({ jid: FAMILIA, name: 'Família', participant_count: 5 });
  contactsRepo.upsert({ jid: ANA, name: 'Ana' });
  contactsRepo.upsert({ jid: JOAO, name: 'João' });

  messagesRepo.upsert(makeMessage({
    id: '3EB0F1A2', remote_jid: FAMILIA, participant: ANA, from_jid: ANA,
    timestamp: NOON, body: 'o boleto chegou hoje', push_name: 'Ana',
  }));
  messagesRepo.upsert(makeMessage({
    id: '3EB0D001', remote_jid: ANA, from_jid: ANA,
    timestamp: NOON - 1800, body: 'te mando o boleto amanhã',
  }));
  messagesRepo.upsert(makeMessage({
    id: '3EB0F1A3', remote_jid: FAMILIA, from_me: 1,
    timestamp: NOON - 3600, body: 'paguei o boleto ontem',
  }));
  messagesRepo.upsert(makeMessage({
    id: '3EB0U001', remote_jid: STRANGER, from_jid: STRANGER,
    timestamp: NOON - 5400, body: 'boleto pago',
  }));
  messagesRepo.upsert(makeMessage({
    id: '3EB0F1A4', remote_jid: FAMILIA, participant: JOAO, from_jid: JOAO,
    timestamp: NOON - 7200, body: 'alguém viu o boleto do condomínio?',
  }));
}

beforeEach(() => {
  db = createTestDb();
  resetFixtures();
});

describe('search_messages prose', () => {
  it('renders hits grouped by chat, newest first', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'boleto' });

    // The whole dialect in one assertion: it is the thing this tool returns,
    // and a diff on it is exactly the review a rendering change deserves.
    expect(contentOf(result)).toBe([
      '5 matches for "boleto" across 3 chats, newest first:',
      '',
      'Família · group',
      '  [06-15 12:00] Ana: o boleto chegou hoje  `3EB0F1A2`',
      '  [06-15 11:00] Me: paguei o boleto ontem  `3EB0F1A3`',
      '  [06-15 10:00] João: alguém viu o boleto do condomínio?  `3EB0F1A4`',
      '',
      'Ana',
      '  [06-15 11:30] Ana: te mando o boleto amanhã  `3EB0D001`',
      '',
      '…1234 (DM)',
      '  [06-15 10:30] …1234 (DM): boleto pago  `3EB0U001`',
      '',
      'Read any of these in context with get_conversation(chat="Família", around_message_id="…")'
        + ' — the id is the last thing on each hit line.',
    ].join('\n'));
  });

  it('names the chat in the header and drops group headings when hits share one chat', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'condomínio' });
    const text = contentOf(result);

    expect(text).toContain('1 match for "condomínio" in Família:');
    // One chat, named once: no heading line, and therefore no indent.
    expect(text).toContain('\n[06-15 10:00] João: alguém viu o boleto do condomínio?');
    expect(text).not.toContain('Família · group');
  });

  it('answers a search with no hits in prose, not an empty array', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'xyzzy' });
    const text = contentOf(result);

    expect(text).toContain('Nothing matches "xyzzy".');
    expect(text).toContain('list_chats()');
    expect(text).not.toContain('{');
    expect(result.structuredContent).toEqual({ total: 0, returned: 0, results: [] });
  });

  it('reports the scope it searched when nothing matched inside it', async () => {
    seedCorpus();
    const result = await searchMessages({
      query: 'boleto', chat: 'Família', from: 'Ana', after: String(NOON + 60),
    });

    expect(contentOf(result)).toContain(
      `Nothing in Família from Ana after 06-15 12:01 matches "boleto".`,
    );
  });

  it('renders stamps in the requested timezone', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'condomínio', timezone: 'Asia/Tokyo' });

    // Tokyo is UTC+9 year-round: 10:00 UTC is 19:00 the same day.
    expect(contentOf(result)).toContain('[06-15 19:00]');
  });
});

describe('search_messages identity', () => {
  it('never puts a raw JID in the model-facing half', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'boleto' });
    const text = contentOf(result);

    expect(text).not.toContain('@s.whatsapp.net');
    expect(text).not.toContain('@g.us');
    expect(text).not.toContain('@lid');
  });

  it('masks a chat that has no name anywhere rather than falling back to its JID', async () => {
    // Only the unnamed chat has a hit, so the masked label is also what the
    // header has to name the search with.
    messagesRepo.upsert(makeMessage({
      id: 'STRANGER-1', remote_jid: STRANGER, from_jid: STRANGER,
      timestamp: NOON, body: 'boleto pago',
    }));
    const result = await searchMessages({ query: 'boleto' });
    const text = contentOf(result);

    expect(text).toContain('1 match for "boleto" in …1234 (DM):');
    expect(text).not.toContain(STRANGER);
    // With no readable chat name to offer, the follow-up call is a placeholder
    // rather than an uncallable masked label.
    expect(text).toContain('get_conversation(chat="…", around_message_id="…")');
  });

  it('masks a JID that arrives inside a message body', async () => {
    messagesRepo.upsert(makeMessage({
      id: 'LEAK-1', remote_jid: ANA, from_jid: ANA,
      timestamp: NOON, body: `manda pro ${JOAO} que ele resolve`,
    }));
    const result = await searchMessages({ query: 'manda' });
    const text = contentOf(result);

    expect(text).not.toContain('@s.whatsapp.net');
    expect(text).toContain('manda pro …6666 (DM) que ele resolve');
  });

  it('echoes a JID the caller typed as the query, so its continuation still runs', async () => {
    contactsRepo.upsert({ jid: ANA, name: 'Ana' });
    for (let i = 0; i < 3; i++) {
      messagesRepo.upsert(makeMessage({
        id: `QJID-${i}`, remote_jid: ANA, from_jid: ANA,
        timestamp: NOON - i * 60, body: `manda pro ${JOAO} que ele resolve`,
      }));
    }
    const result = await searchMessages({ query: JOAO, limit: 1 });
    const text = contentOf(result);

    // The caller typed this string, so echoing it back tells it nothing it did
    // not already have — while masking it would emit a continuation that
    // returns nothing when run, the exact failure that rule exists to prevent.
    expect(text).toContain(`1 match for "${JOAO}" in Ana:`);
    expect(text).toContain(`… 2 more matches · search_messages(query="${JOAO}", limit=3)`);

    // The same identifier arriving out of the archive is still masked.
    expect(text).toContain('manda pro …6666 (DM) que ele resolve');
  });

  it('scrubs a JID embedded in a chat name, keeping the rest of the name', async () => {
    chatsRepo.upsert({ jid: STRANGER, name: `obra ${JOAO}` });
    messagesRepo.upsert(makeMessage({
      id: 'NAMED-1', remote_jid: STRANGER, from_jid: STRANGER,
      timestamp: NOON, body: 'boleto pago',
    }));
    const result = await searchMessages({ query: 'boleto' });

    expect(contentOf(result)).toContain('in obra …6666 (DM):');
    expect(contentOf(result)).not.toContain('@s.whatsapp.net');
  });
});

describe('search_messages truncation', () => {
  it('states the literal call that returns the matches it left behind', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'boleto', limit: 2 });
    const text = contentOf(result);

    expect(text).toContain('… 3 more matches · search_messages(query="boleto", limit=5)');
    expect(text).not.toContain('has_more');
  });

  it('carries the caller\'s own filters into the continuation call', async () => {
    seedCorpus();
    const result = await searchMessages({
      query: 'boleto', chat: 'Família', limit: 1, timezone: 'Asia/Tokyo',
    });

    expect(contentOf(result)).toContain(
      '… 2 more matches · search_messages(query="boleto", chat="Família", limit=3, timezone="Asia/Tokyo")',
    );
  });

  it('carries a types filter through, which continuation() cannot render alone', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'boleto', limit: 2, types: ['text', 'image'] });

    expect(contentOf(result)).toContain(
      'search_messages(query="boleto", limit=5, types=["text", "image"])',
    );
  });

  it('counts only the matching types when several are given', async () => {
    seedCorpus();
    // Three image hits on top of the five text ones. The count that reaches the
    // model used to be the unfiltered eight, because the type filter ran in
    // memory over a COUNT(*) that never saw it — so a request for images was
    // answered with "… 7 more matches" and a call that returns two.
    for (let i = 0; i < 3; i++) {
      messagesRepo.upsert(makeMessage({
        id: `IMG-${i}`, remote_jid: ANA, from_jid: ANA, message_type: 'image',
        timestamp: NOON - 60 - i, body: `boleto scan ${i}`, has_media: 1,
      }));
    }

    const result = await searchMessages({ query: 'boleto', limit: 1, types: ['image', 'audio'] });
    const structured = result.structuredContent as { total: number; returned: number };

    expect(structured.total).toBe(3);
    expect(structured.returned).toBe(1);
    expect(contentOf(result)).toContain(
      '… 2 more matches · search_messages(query="boleto", limit=3, types=["image", "audio"])',
    );
  });

  it('excludes the types the caller did not ask for', async () => {
    seedCorpus();
    messagesRepo.upsert(makeMessage({
      id: 'IMG-ONLY', remote_jid: ANA, from_jid: ANA, message_type: 'image',
      timestamp: NOON, body: 'boleto scan', has_media: 1,
    }));

    const result = await searchMessages({ query: 'boleto', types: ['image'] });
    const structured = result.structuredContent as {
      total: number; results: Array<{ message_type: string }>;
    };

    expect(structured.total).toBe(1);
    expect(structured.results.map((r) => r.message_type)).toEqual(['image']);
  });

  it('advises narrowing instead of paging when the page is already as wide as it goes', async () => {
    contactsRepo.upsert({ jid: ANA, name: 'Ana' });
    for (let i = 0; i < 105; i++) {
      messagesRepo.upsert(makeMessage({
        id: `BULK-${i}`, remote_jid: ANA, from_jid: ANA,
        timestamp: NOON - i * 60, body: `boleto ${i}`,
      }));
    }
    // 100 is the schema's maximum, so there is no larger `limit` left to offer.
    const result = await searchMessages({ query: 'boleto', limit: 100 });
    const text = contentOf(result);

    expect(text).toContain('… 5 more matches — narrow by chat, sender or time range to reach them.');
    expect(text).not.toContain('limit=100');
  });

  it('says nothing about continuing when the page held everything', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'boleto' });

    expect(contentOf(result)).not.toContain('more matches');
  });
});

describe('search_messages structuredContent', () => {
  it('is unchanged, field for field, from what the tool returned before', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'condomínio' });

    // Transcribed from the pre-change `jsonResult({ total, returned, results })`
    // payload, JIDs included: programmatic clients must see no difference.
    expect(result.structuredContent).toEqual({
      total: 1,
      returned: 1,
      results: [
        {
          message_id: '3EB0F1A4',
          chat_name: 'Família',
          chat_jid: FAMILIA,
          sender_name: 'João',
          sender_jid: JOAO,
          timestamp: NOON - 7200,
          is_from_me: false,
          snippet: 'alguém viu o boleto do condomínio?',
          has_media: false,
          message_type: 'text',
        },
      ],
    });
  });

  it('keeps the JIDs in the structured half that the prose half hides', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'boleto' });
    const structured = result.structuredContent as {
      total: number; returned: number; results: Array<{ chat_jid: string }>;
    };

    expect(structured.total).toBe(5);
    expect(structured.returned).toBe(5);
    expect(structured.results.map((r) => r.chat_jid)).toContain(STRANGER);
    expect(JSON.stringify(structured)).toContain('@s.whatsapp.net');
  });

  it('no longer duplicates the JSON into the text half', async () => {
    seedCorpus();
    const result = await searchMessages({ query: 'boleto' });

    expect(contentOf(result).trimStart().startsWith('{')).toBe(false);
  });
});

describe('get_conversation character budget', () => {
  const getConversation = handlerFor('get_conversation');

  /** `n` messages of `chars` each, oldest first, in a chat named "Família". */
  function seedBulk(n: number, chars: number): void {
    groupsRepo.upsert({ jid: FAMILIA, name: 'Família', participant_count: 5 });
    chatsRepo.upsert({ jid: FAMILIA, name: 'Família', is_group: 1 });
    contactsRepo.upsert({ jid: ANA, name: 'Ana' });
    for (let i = 0; i < n; i++) {
      messagesRepo.upsert(makeMessage({
        id: `BULK${i}`, remote_jid: FAMILIA, participant: ANA, from_jid: ANA,
        timestamp: NOON - (n - i) * 60, body: `${i}:`.padEnd(chars, 'x'),
      }));
    }
  }


  it('leaves a short conversation untouched and says nothing about budgets', async () => {
    seedBulk(3, 20);
    const text = contentOf(await getConversation({ chat: 'Família' }));

    expect(text).not.toContain('omitted');
    expect(text).toContain('Ana: 0:');
  });

  it('drops the oldest first and keeps the newest when the default cap bites', async () => {
    seedBulk(50, 400);
    const text = contentOf(await getConversation({ chat: 'Família' }));

    expect(text.length).toBeLessThanOrEqual(6000);
    // Newest survives, oldest is gone — the direction of the drop is the whole
    // contract, and a renderer that dropped the *newest* first would still fit
    // the budget and still pass a bare length assertion. Bodies are matched
    // through the `Ana: ` prefix so `0:` cannot be satisfied by the `10:`,
    // `20:`, … that share its tail, nor by a `HH:MM` stamp.
    expect(text).toContain('Ana: 49:');
    expect(text).not.toContain('Ana: 0:');
    expect(text).toMatch(/_\[\d+ earlier messages omitted to fit the character budget\./);
  });

  it('names the exact call that reads further back, with a bigger ceiling', async () => {
    seedBulk(50, 400);
    const text = contentOf(await getConversation({ chat: 'Família', last_n: 50 }));

    expect(text).toContain(
      'To read them: get_conversation(chat="Família", last_n=50, max_chars=12000)',
    );
  });

  it('honours a raised max_chars', async () => {
    seedBulk(50, 400);
    const tight = contentOf(await getConversation({ chat: 'Família', max_chars: 2000 }));
    const roomy = contentOf(await getConversation({ chat: 'Família', max_chars: 40000 }));

    expect(tight.length).toBeLessThanOrEqual(2000);
    expect(roomy.length).toBeGreaterThan(tight.length);
    expect(roomy).not.toContain('omitted');
    expect(roomy).toContain('Ana: 0:');
  });

  it('keeps a lone oversized message whole rather than emitting a note about nothing', async () => {
    seedBulk(1, 9000);
    const text = contentOf(await getConversation({ chat: 'Família' }));

    expect(text).not.toContain('omitted');
    expect(text.length).toBeGreaterThan(6000);
  });
});
