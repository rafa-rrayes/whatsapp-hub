import { describe, it, expect, vi } from 'vitest';
import type { MessageRow } from '../database/repositories/messages.js';
import type { RenderOptions } from './render.js';

// The real resolver preloads contacts/groups/chats from the database. This
// suite is about the render + budget logic, so stub it with the same
// deterministic `fallback || +number` rule used by src/export/render-md.test.ts.
vi.mock('../export/name-resolver.js', () => ({
  buildNameResolver: () => ({
    resolveName: (jid?: string, fallback?: string) =>
      fallback || (jid ? `+${jid.split('@')[0]}` : 'Unknown'),
    resolveChatLabel: (jid: string) => jid,
    resolveBareName: (jid?: string) => (jid ? `+${jid.split('@')[0]}` : 'Unknown'),
  }),
}));

const { renderConversation } = await import('./render.js');

// 2023-11-14 22:13:20 UTC — the day boundary is 86_400s later.
const T0 = 1_700_000_000;
const DAY = 86_400;
const DAY1 = '2023-11-14';
const DAY2 = '2023-11-15';

const CHAT = '5511999999999@s.whatsapp.net';
const OTHER = '5511111111111@s.whatsapp.net';

function makeMsg(over: Partial<MessageRow> & { id: string; timestamp: number }): MessageRow {
  return {
    remote_jid: CHAT,
    from_jid: OTHER,
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
  } as MessageRow;
}

const BASE: RenderOptions = { timezone: 'UTC', chat_label: 'Família' };

/** `n` chronological messages one minute apart, each body padded to `pad` chars. */
function bulk(n: number, pad = 180, startTs = T0): MessageRow[] {
  return Array.from({ length: n }, (_, i) =>
    makeMsg({
      id: `m${i}`,
      timestamp: startTs + i * 60,
      push_name: 'Ana',
      body: `msg-${i} ` + 'x'.repeat(pad),
    }),
  );
}

const NOTE_RE = /omitted to fit the character budget/;

describe('renderConversation — unbudgeted output (baseline)', () => {
  it('matches the exact pre-budget markdown when no budget is given', () => {
    const msgs = [
      makeMsg({ id: 'm1', timestamp: T0, push_name: 'Ana', body: 'oi, tudo bem?' }),
      makeMsg({ id: 'm2', timestamp: T0 + 60, from_me: 1, body: 'tudo, e você?' }),
      makeMsg({ id: 'm3', timestamp: T0 + DAY, push_name: 'Ana', body: 'no dia seguinte' }),
    ];

    const expected = [
      '# Família',
      '_5511999999999@s.whatsapp.net_',
      '',
      `## ${DAY1}`,
      '',
      '**22:13** Ana: oi, tudo bem?',
      '',
      '**22:14** Me: tudo, e você?',
      '',
      `## ${DAY2}`,
      '',
      '**22:13** Ana: no dia seguinte',
      '',
    ].join('\n');

    const out = renderConversation(msgs, { ...BASE, subtitle: CHAT });
    expect(out).toBe(expected);
    expect(out).not.toMatch(NOTE_RE);
  });

  it('keeps quoted replies and inline reactions attached to their message', () => {
    const msgs = [
      makeMsg({
        id: 'm1', timestamp: T0, push_name: 'Ana',
        body: 'resposta', quoted_id: 'm0', quoted_body: 'pergunta anterior',
      }),
      makeMsg({
        id: 'r1', timestamp: T0 + 30, message_type: 'reaction',
        from_jid: '999@s.whatsapp.net', reaction_target_id: 'm1', reaction_emoji: '👍',
      }),
    ];

    const out = renderConversation(msgs, BASE);
    expect(out).toBe([
      '# Família',
      '',
      `## ${DAY1}`,
      '',
      '> ↩ pergunta anterior',
      '**22:13** Ana: resposta',
      '> 👍 +999',
      '',
    ].join('\n'));
    // The reaction row itself is never rendered as a message of its own.
    expect(out.match(/^\*\*\d\d:\d\d\*\*/gm)).toHaveLength(1);
  });

  it('treats budget: 0, negative and undefined as unlimited', () => {
    const msgs = bulk(8);
    const full = renderConversation(msgs, BASE);

    expect(renderConversation(msgs, { ...BASE, budget: 0 })).toBe(full);
    expect(renderConversation(msgs, { ...BASE, budget: -1 })).toBe(full);
    expect(renderConversation(msgs, { ...BASE, budget: undefined })).toBe(full);
    expect(full).not.toMatch(NOTE_RE);
  });
});

describe('renderConversation — budget that is not binding', () => {
  it('returns everything untouched when the budget is larger than the transcript', () => {
    const msgs = bulk(8);
    const full = renderConversation(msgs, BASE);

    const out = renderConversation(msgs, { ...BASE, budget: full.length + 5_000 });
    expect(out).toBe(full);
    expect(out).not.toMatch(NOTE_RE);
    for (let i = 0; i < 8; i++) expect(out).toContain(`msg-${i} `);
  });

  it('returns everything untouched when the budget is exactly the transcript length', () => {
    const msgs = bulk(8);
    const full = renderConversation(msgs, BASE);

    const out = renderConversation(msgs, { ...BASE, budget: full.length });
    expect(out).toBe(full);
    expect(out).not.toMatch(NOTE_RE);
  });
});

describe('renderConversation — budget that bites', () => {
  it('drops oldest-first, keeps the newest, and stays inside the budget', () => {
    const msgs = bulk(12);
    const full = renderConversation(msgs, BASE);
    const budget = Math.floor(full.length / 3);

    const out = renderConversation(msgs, { ...BASE, budget });

    expect(out.length).toBeLessThanOrEqual(budget);
    expect(out).toMatch(NOTE_RE);
    expect(out).toContain('msg-11 '); // newest survives
    expect(out).not.toContain('msg-0 '); // oldest gone
    // Whatever survives is a contiguous, newest-anchored run.
    const kept = Array.from({ length: 12 }, (_, i) => out.includes(`msg-${i} `));
    const firstKept = kept.indexOf(true);
    expect(firstKept).toBeGreaterThan(0);
    expect(kept.slice(firstKept).every(Boolean)).toBe(true);
  });

  it('reports how many messages went missing', () => {
    const msgs = bulk(12);
    const out = renderConversation(msgs, {
      ...BASE,
      budget: Math.floor(renderConversation(msgs, BASE).length / 3),
    });

    const dropped = Array.from({ length: 12 }, (_, i) => i).filter((i) => !out.includes(`msg-${i} `)).length;
    expect(out).toContain(`${dropped} earlier messages omitted`);
  });

  it('never returns an empty transcript, however small the budget', () => {
    const msgs = bulk(12);
    for (const budget of [1, 5, 40, 200]) {
      const out = renderConversation(msgs, { ...BASE, budget });
      expect(out).toContain('msg-11 ');
      expect(out.trim()).not.toBe('');
    }
  });
});

describe('renderConversation — the newest message is never sacrificed', () => {
  it('renders a lone message in full even when it dwarfs the budget', () => {
    const body = 'y'.repeat(5_000);
    const msgs = [makeMsg({ id: 'solo', timestamp: T0, push_name: 'Ana', body })];

    const out = renderConversation(msgs, { ...BASE, budget: 100 });

    expect(out).toContain(body); // in full, not elided
    expect(out.length).toBeGreaterThan(100);
    // Nothing was dropped, so there is no missing history to point at.
    expect(out).not.toMatch(NOTE_RE);
  });

  it('keeps an oversized newest message intact while dropping the history before it', () => {
    const huge = 'z'.repeat(4_000);
    const msgs = [...bulk(5), makeMsg({ id: 'last', timestamp: T0 + 600, push_name: 'Ana', body: huge })];

    const out = renderConversation(msgs, { ...BASE, budget: 500 });

    expect(out).toContain(huge);
    expect(out).not.toContain('msg-0 ');
    expect(out).not.toContain('msg-4 ');
    expect(out).toMatch(NOTE_RE);
    expect(out).toContain('5 earlier messages omitted');
  });
});

describe('renderConversation — date headers survive trimming', () => {
  it('leaves no orphaned header when every message under it is dropped', () => {
    const msgs = [
      ...bulk(3, 240, T0),
      makeMsg({ id: 'next-day', timestamp: T0 + DAY, push_name: 'Ana', body: 'q'.repeat(240) }),
    ];
    // Room for the newest block plus the note, but nowhere near a second message.
    const tail = renderConversation([msgs[3]], BASE);

    const out = renderConversation(msgs, { ...BASE, budget: tail.length + 200 });

    expect(out).toContain(`## ${DAY2}`);
    expect(out).not.toContain(`## ${DAY1}`);
    expect(out).toMatch(NOTE_RE);
  });

  it('gives the first surviving message a date header of its own', () => {
    const msgs = [
      ...bulk(6, 200, T0), // six on DAY1
      makeMsg({ id: 'd2', timestamp: T0 + DAY, push_name: 'Ana', body: 'w'.repeat(200) }),
    ];
    const full = renderConversation(msgs, BASE);

    const out = renderConversation(msgs, { ...BASE, budget: Math.floor(full.length / 2) });

    // The trim cut into the middle of DAY1, so its header must be re-emitted.
    expect(out).not.toContain('msg-0 ');
    expect(out).toContain('msg-5 ');
    expect(out).toContain(`## ${DAY1}`);
    expect(out).toContain(`## ${DAY2}`);

    // Every message line is preceded by some `## date` header.
    const lines = out.split('\n');
    const firstMsg = lines.findIndex((l) => /^\*\*\d\d:\d\d\*\*/.test(l));
    const firstHeader = lines.findIndex((l) => l.startsWith('## '));
    expect(firstHeader).toBeGreaterThanOrEqual(0);
    expect(firstHeader).toBeLessThan(firstMsg);
    // ...and the header directly above the first survivor is its own date.
    expect(lines[firstHeader]).toBe(`## ${DAY1}`);
  });
});

describe('renderConversation — the truncation note', () => {
  const msgs = bulk(12);
  const budget = Math.floor(renderConversation(msgs, BASE).length / 3);
  const hint = 'get_conversation(chat="Família", last_n=100)';

  it('quotes the caller-supplied continuation call verbatim', () => {
    const out = renderConversation(msgs, { ...BASE, budget, truncation_hint: hint });
    expect(out).toContain(hint);
    expect(out).toMatch(NOTE_RE);
  });

  it('still says something useful when no hint is supplied', () => {
    const out = renderConversation(msgs, { ...BASE, budget });
    expect(out).toMatch(NOTE_RE);
    expect(out).toMatch(/larger budget/);
    expect(out).not.toContain('undefined');
  });

  it('never invents a continuation call the caller did not give it', () => {
    const out = renderConversation(msgs, { ...BASE, budget });
    expect(out).not.toMatch(/get_conversation\(/);
    expect(out).not.toMatch(/get_thread\(/);
  });

  it('counts the note against the budget alongside the chat title', () => {
    const out = renderConversation(msgs, { ...BASE, budget, truncation_hint: hint });
    expect(out).toContain(hint);
    expect(out.length).toBeLessThanOrEqual(budget);
  });

  it('places the note above the surviving transcript, newest message last', () => {
    const out = renderConversation(msgs, { ...BASE, budget });
    const noteIdx = out.search(NOTE_RE);
    expect(noteIdx).toBeGreaterThanOrEqual(0);
    expect(noteIdx).toBeLessThan(out.indexOf('## '));
    expect(out.trimEnd().endsWith('msg-11 ' + 'x'.repeat(180))).toBe(true);
  });
});

describe('renderConversation — messages are never split at the boundary', () => {
  // A message whose rendered form is three lines: quote, message, reactions.
  const target = makeMsg({
    id: 'target', timestamp: T0 + 3 * 60, push_name: 'Ana',
    body: 'alvo ' + 'k'.repeat(150),
    quoted_id: 'prev', quoted_body: 'pergunta anterior',
  });
  const msgs: MessageRow[] = [
    ...bulk(3, 150, T0),
    target,
    makeMsg({
      id: 'rx', timestamp: T0 + 3 * 60 + 5, message_type: 'reaction',
      from_jid: '999@s.whatsapp.net', reaction_target_id: 'target', reaction_emoji: '👍',
    }),
    ...bulk(3, 150, T0 + 4 * 60).map((m, i) => ({ ...m, id: `late${i}`, body: `late-${i} ` + 'x'.repeat(150) })),
  ];

  const QUOTE_LINE = '> ↩ pergunta anterior';
  const REACTION_LINE = '> 👍 +999';

  it('keeps a quote line, its message and its reactions together at every budget', () => {
    const full = renderConversation(msgs, BASE);

    for (let budget = 50; budget <= full.length + 50; budget += 13) {
      const out = renderConversation(msgs, { ...BASE, budget });
      const hasBody = out.includes('alvo ');

      expect(out.includes(QUOTE_LINE)).toBe(hasBody);
      expect(out.includes(REACTION_LINE)).toBe(hasBody);
      // The newest message always survives, so the transcript is never empty.
      expect(out).toContain('late-2 ');
      // Output exceeds the budget only in the one sanctioned case: a single
      // surviving message that alone does not fit.
      const kept = (out.match(/^\*\*\d\d:\d\d\*\*/gm) || []).length;
      expect(kept).toBeGreaterThanOrEqual(1);
      if (kept > 1) expect(out.length).toBeLessThanOrEqual(budget);
    }
  });

  it('does not count reaction rows as messages when trimming', () => {
    const out = renderConversation(msgs, { ...BASE, budget: 100_000 });
    // 7 real messages (3 bulk + target + 3 late); the reaction row is inline.
    expect(out.match(/^\*\*\d\d:\d\d\*\*/gm)).toHaveLength(7);
    expect(out).not.toMatch(NOTE_RE);
  });
});
