import { describe, it, expect } from 'vitest';
import {
  formatStamp,
  relativeAge,
  truncateBody,
  renderChatLine,
  maskJid,
  continuation,
} from './prose.js';

/**
 * Year assertions are derived, never hardcoded — a suite that goes red on
 * January 1st is a suite nobody trusts. Mid-June at noon UTC is the reference
 * instant throughout: no timezone on earth pushes it across a year boundary,
 * and the zones used below (UTC, Asia/Tokyo) have no DST to shift the hour.
 */
const THIS_YEAR = new Date().getUTCFullYear();
const JUNE_NOON = (year: number) => Date.UTC(year, 5, 15, 12, 0, 0) / 1000;

describe('formatStamp', () => {
  it('renders MM-DD HH:MM without a year for the current year', () => {
    expect(formatStamp(JUNE_NOON(THIS_YEAR), 'UTC')).toBe('06-15 12:00');
  });

  it('prefixes the year when the timestamp is from another year', () => {
    expect(formatStamp(JUNE_NOON(THIS_YEAR - 1), 'UTC')).toBe(`${THIS_YEAR - 1}-06-15 12:00`);
  });

  it('renders in the requested timezone, not UTC', () => {
    // Tokyo is UTC+9 year-round.
    expect(formatStamp(JUNE_NOON(THIS_YEAR), 'Asia/Tokyo')).toBe('06-15 21:00');
  });

  it('defaults to UTC when no timezone is given', () => {
    expect(formatStamp(JUNE_NOON(THIS_YEAR))).toBe(formatStamp(JUNE_NOON(THIS_YEAR), 'UTC'));
  });

  it('falls back to UTC on an unknown timezone instead of throwing', () => {
    const ts = JUNE_NOON(THIS_YEAR);
    expect(() => formatStamp(ts, 'Mars/Olympus_Mons')).not.toThrow();
    expect(formatStamp(ts, 'Mars/Olympus_Mons')).toBe('06-15 12:00');
    expect(formatStamp(ts, '')).toBe('06-15 12:00');
  });

  it('zero-pads the hour past midnight', () => {
    expect(formatStamp(Date.UTC(THIS_YEAR, 5, 15, 0, 5, 0) / 1000, 'UTC')).toBe('06-15 00:05');
  });
});

describe('relativeAge', () => {
  const NOW = 1_700_000_000;
  const age = (secondsAgo: number) => relativeAge(NOW - secondsAgo, NOW);

  it('reads "just now" under a minute', () => {
    expect(age(0)).toBe('just now');
    expect(age(59)).toBe('just now');
  });

  it('switches to minutes at 60s and to hours at an hour', () => {
    expect(age(60)).toBe('1m');
    expect(age(59 * 60 + 59)).toBe('59m');
    expect(age(60 * 60)).toBe('1h');
  });

  it('switches to days at 24h', () => {
    expect(age(23 * 3600)).toBe('23h');
    expect(age(24 * 3600 - 1)).toBe('23h');
    expect(age(24 * 3600)).toBe('1d');
  });

  it('switches to weeks at a fortnight', () => {
    expect(age(4 * 86400)).toBe('4d');
    expect(age(13 * 86400)).toBe('13d');
    expect(age(14 * 86400)).toBe('2w');
    expect(age(21 * 86400)).toBe('3w');
  });

  it('reads a future timestamp as "just now" rather than a negative age', () => {
    expect(relativeAge(NOW + 5000, NOW)).toBe('just now');
  });

  it('defaults nowSec to the current clock', () => {
    expect(relativeAge(Date.now() / 1000 - 120)).toBe('2m');
  });
});

describe('truncateBody', () => {
  it('returns an empty string for undefined input', () => {
    expect(truncateBody(undefined)).toBe('');
    expect(truncateBody('   ')).toBe('');
  });

  it('collapses newlines so one message stays one line', () => {
    expect(truncateBody('milk\neggs\nbread')).toBe('milk eggs bread');
    expect(truncateBody('a\r\n\r\nb')).toBe('a b');
    expect(truncateBody('a\nb\nc')).not.toContain('\n');
  });

  it('collapses whitespace runs and trims the ends', () => {
    expect(truncateBody('  hello    there \t world  ')).toBe('hello there world');
  });

  it('leaves a body of exactly max characters untouched', () => {
    const body = 'x'.repeat(80);
    expect(truncateBody(body)).toBe(body);
    expect(truncateBody(body)).not.toContain('…');
  });

  it('ellipsizes at the boundary without exceeding max', () => {
    const out = truncateBody('x'.repeat(81));
    expect(out).toHaveLength(80);
    expect(out.endsWith('…')).toBe(true);
  });

  it('honours a custom max', () => {
    expect(truncateBody('abcdefghij', 5)).toBe('abcd…');
  });

  it('counts the collapsed length, not the raw length', () => {
    // 10 raw characters, 5 after collapsing — no ellipsis is warranted.
    expect(truncateBody('a    b    c', 5)).toBe('a b c');
  });
});

describe('maskJid', () => {
  it('keeps only the last four digits of a DM', () => {
    const jid = '5511999999999@s.whatsapp.net';
    const out = maskJid(jid);
    expect(out).toBe('…9999 (DM)');
    expect(out).not.toContain('5511999999999');
    expect(out).not.toContain('@');
  });

  it('labels a group and hides the rest of its id', () => {
    const jid = '120363021234564821@g.us';
    const out = maskJid(jid);
    expect(out).toBe('…4821 (group)');
    expect(out).not.toContain('120363021234564821');
  });

  it('treats a lid as a DM', () => {
    expect(maskJid('87654321234567@lid')).toBe('…4567 (DM)');
  });

  it('keeps a non-numeric well-known label intact', () => {
    expect(maskJid('status@broadcast')).toBe('status (broadcast)');
  });
});

describe('renderChatLine', () => {
  const NOW = 1_700_000_000;

  it('uses the resolved name and never leaks the JID', () => {
    const line = renderChatLine(
      {
        name: 'Família',
        jid: '120363021234564821@g.us',
        is_group: true,
        unread_count: 3,
        last_message_ts: NOW - 7200,
        last_message_preview: 'vc vem jantar hoje?',
      },
      { now_sec: NOW }
    );
    expect(line).toBe('Família · group · 3 unread · 2h · vc vem jantar hoje?');
    expect(line).not.toContain('@g.us');
    expect(line).not.toContain('120363021234564821');
  });

  it('falls back to a masked JID, not the raw one, when there is no name', () => {
    const line = renderChatLine(
      {
        jid: '5511999999999@s.whatsapp.net',
        last_message_ts: NOW - 300,
        last_message_preview: 'oi',
      },
      { now_sec: NOW }
    );
    expect(line).not.toContain('5511999999999');
    expect(line).not.toContain('@s.whatsapp.net');
    expect(line).toContain('…9999 (DM)');
    expect(line).toContain('5m');
  });

  it('treats a blank name as no name at all', () => {
    const line = renderChatLine({ jid: '5511999999999@s.whatsapp.net', name: '   ' });
    expect(line).toContain('…9999 (DM)');
  });

  // Rule 1 has to hold even when the layer below hands us a JID *as* the name.
  // Several do: the sync path writes whatever Baileys supplies into
  // `chats.name`, and more than one lookup falls back to `row.name || row.jid`.
  it('masks a supplied name that is really a JID', () => {
    for (const jid of [
      '5511999999999@s.whatsapp.net',
      '120363021234564821@g.us',
      '84999888777@lid',
    ]) {
      const line = renderChatLine({ name: jid, jid, last_message_ts: NOW }, { now_sec: NOW });
      expect(line).not.toContain('@');
      expect(line).toContain('…');
    }
  });

  it('still masks when the JID arrives only in the name field', () => {
    const line = renderChatLine({ name: '5511999999999@s.whatsapp.net', jid: '' });
    expect(line).toBe('…9999 (DM) · no messages');
  });

  it('keeps a name that merely contains an @', () => {
    const line = renderChatLine({ name: 'ana@work', jid: '111@s.whatsapp.net' });
    expect(line).toContain('ana@work');
  });

  it('shows the unread count only when it is greater than zero', () => {
    const base = { name: 'Mom', jid: '111@s.whatsapp.net', last_message_ts: NOW - 60 };
    expect(renderChatLine({ ...base, unread_count: 0 }, { now_sec: NOW })).not.toContain('unread');
    expect(renderChatLine(base, { now_sec: NOW })).not.toContain('unread');
    expect(renderChatLine({ ...base, unread_count: 1 }, { now_sec: NOW })).toContain('1 unread');
  });

  it('omits the kind on a DM and does not repeat "group" already in the name', () => {
    const dm = renderChatLine({ name: 'Mom', jid: '111@s.whatsapp.net', last_message_ts: NOW }, { now_sec: NOW });
    expect(dm).toBe('Mom · just now');

    const group = renderChatLine(
      { name: 'Study Group', jid: '1-2@g.us', is_group: true, last_message_ts: NOW },
      { now_sec: NOW }
    );
    expect(group).toBe('Study Group · just now');
  });

  it('says so when a chat has no messages', () => {
    expect(renderChatLine({ name: 'Mom', jid: '111@s.whatsapp.net', last_message_ts: null }))
      .toBe('Mom · no messages');
  });

  it('flattens and truncates the preview', () => {
    const line = renderChatLine(
      {
        name: 'Mom',
        jid: '111@s.whatsapp.net',
        last_message_ts: NOW,
        last_message_preview: 'buy:\nmilk\neggs',
      },
      { now_sec: NOW, preview_chars: 10 }
    );
    expect(line).toBe('Mom · just now · buy: milk…');
    expect(line).not.toContain('\n');
  });
});

describe('continuation', () => {
  it('renders a copy-pasteable call with arguments filled in', () => {
    expect(continuation('get_conversation', { chat: 'Família', last_n: 50 }))
      .toBe('get_conversation(chat="Família", last_n=50)');
  });

  it('quotes strings and leaves numbers and booleans bare', () => {
    expect(continuation('whatsapp_inbox', { limit: 20, include_read: true, unread_only: false }))
      .toBe('whatsapp_inbox(limit=20, include_read=true, unread_only=false)');
  });

  it('skips undefined arguments', () => {
    expect(continuation('search_messages', { query: 'boleto', chat: undefined, limit: 10 }))
      .toBe('search_messages(query="boleto", limit=10)');
  });

  it('escapes quotes and backslashes inside string arguments', () => {
    expect(continuation('search_messages', { query: 'say "hi"' }))
      .toBe('search_messages(query="say \\"hi\\"")');
    expect(continuation('search_messages', { query: 'C:\\temp' }))
      .toBe('search_messages(query="C:\\\\temp")');
  });

  it('renders a no-argument call as an empty pair of parentheses', () => {
    expect(continuation('whatsapp_inbox')).toBe('whatsapp_inbox()');
    expect(continuation('whatsapp_inbox', { chat: undefined })).toBe('whatsapp_inbox()');
  });
});
