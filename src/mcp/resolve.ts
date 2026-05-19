import { contactsRepo } from '../database/repositories/contacts.js';
import { groupsRepo } from '../database/repositories/groups.js';
import { chatsRepo } from '../database/repositories/chats.js';

const JID_REGEX = /^(\d+@(s\.whatsapp\.net|lid|broadcast)|\d+(-\d+)?@g\.us|status@broadcast)$/;

export type CandidateKind = 'contact' | 'group' | 'chat';

export interface ResolveCandidate {
  jid: string;
  name: string;
  kind: CandidateKind;
  is_group: boolean;
  score: number;
  unread_count?: number;
  last_message_ts?: number;
  last_message_preview?: string;
  phone_number?: string;
}

export interface ResolveFilter {
  groupsOnly?: boolean;
  dmsOnly?: boolean;
  limit?: number;
}

export function isJid(s: string): boolean {
  return JID_REGEX.test(s);
}

function scoreText(haystack: string | undefined, needle: string): number {
  if (!haystack) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n) return 900;
  if (h.startsWith(n)) return 700;
  if (h.includes(n)) return 500;
  return 0;
}

/**
 * Resolves a free-text query against contacts, groups, and chats. Returns
 * ranked candidates with score in [200, 1000]. JIDs that match exactly score 1000.
 */
export function resolveCandidates(rawQuery: string, filter: ResolveFilter = {}): ResolveCandidate[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const limit = filter.limit ?? 10;

  // Exact JID lookup short-circuits the search.
  if (isJid(query)) {
    const isGroup = query.endsWith('@g.us');
    if (filter.groupsOnly && !isGroup) return [];
    if (filter.dmsOnly && isGroup) return [];
    const chat = chatsRepo.getByJid(query);
    const contact = contactsRepo.getByJid(query);
    const group = isGroup ? groupsRepo.getByJid(query) : undefined;
    const name = group?.name || contact?.name || contact?.notify_name || chat?.name || query;
    return [{
      jid: query,
      name,
      kind: isGroup ? 'group' : 'contact',
      is_group: isGroup,
      score: 1000,
      last_message_ts: chat?.last_message_ts,
      unread_count: chat?.unread_count,
      last_message_preview: chat?.last_message_body,
      phone_number: contact?.phone_number,
    }];
  }

  const byJid = new Map<string, ResolveCandidate>();

  // Contacts (DMs only — getAll filters is_group=0)
  if (!filter.groupsOnly) {
    for (const c of contactsRepo.getAll(query)) {
      const score = Math.max(
        scoreText(c.name, query),
        scoreText(c.notify_name, query) - 100,
        scoreText(c.short_name, query) - 100,
        c.phone_number && c.phone_number.toLowerCase().includes(query.toLowerCase()) ? 400 : 0,
        c.jid.toLowerCase().includes(query.toLowerCase()) ? 200 : 0,
      );
      if (score === 0) continue;
      const chat = chatsRepo.getByJid(c.jid);
      byJid.set(c.jid, {
        jid: c.jid,
        name: c.name || c.notify_name || c.short_name || c.jid,
        kind: 'contact',
        is_group: false,
        score,
        last_message_ts: chat?.last_message_ts,
        unread_count: chat?.unread_count,
        last_message_preview: chat?.last_message_body,
        phone_number: c.phone_number,
      });
    }
  }

  // Groups
  if (!filter.dmsOnly) {
    for (const g of groupsRepo.getAll(query)) {
      const score = Math.max(
        scoreText(g.name, query),
        g.jid.toLowerCase().includes(query.toLowerCase()) ? 200 : 0,
      );
      if (score === 0) continue;
      const chat = chatsRepo.getByJid(g.jid);
      byJid.set(g.jid, {
        jid: g.jid,
        name: g.name || g.jid,
        kind: 'group',
        is_group: true,
        score,
        last_message_ts: chat?.last_message_ts,
        unread_count: chat?.unread_count,
        last_message_preview: chat?.last_message_body,
      });
    }
  }

  // Backfill from chats — covers chats whose names diverged from contact/group rows.
  for (const c of chatsRepo.getAll({ search: query, limit: 200 })) {
    if (filter.groupsOnly && c.is_group !== 1) continue;
    if (filter.dmsOnly && c.is_group === 1) continue;
    const score = Math.max(
      scoreText(c.name, query),
      c.jid.toLowerCase().includes(query.toLowerCase()) ? 200 : 0,
    );
    if (score === 0) continue;
    const existing = byJid.get(c.jid);
    if (existing) {
      if (score > existing.score) existing.score = score;
      continue;
    }
    byJid.set(c.jid, {
      jid: c.jid,
      name: c.name || c.jid,
      kind: 'chat',
      is_group: c.is_group === 1,
      score,
      last_message_ts: c.last_message_ts,
      unread_count: c.unread_count,
      last_message_preview: c.last_message_body,
    });
  }

  return [...byJid.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.last_message_ts || 0) - (a.last_message_ts || 0);
    })
    .slice(0, limit);
}

export type ResolveOneResult =
  | { ok: true; jid: string; name: string; is_group: boolean }
  | { ok: false; reason: 'not_found' | 'ambiguous'; message: string; candidates: ResolveCandidate[] };

/**
 * Resolves a query to a single chat. Returns `ambiguous` when the top two
 * non-JID candidates are within 100 score points — the LLM should disambiguate.
 */
export function resolveOne(query: string, filter: ResolveFilter = {}): ResolveOneResult {
  const cands = resolveCandidates(query, { ...filter, limit: 10 });
  if (cands.length === 0) {
    return { ok: false, reason: 'not_found', message: `No chat or contact matched "${query}"`, candidates: [] };
  }
  if (!isJid(query) && cands.length >= 2 && cands[0].score - cands[1].score < 100) {
    return {
      ok: false,
      reason: 'ambiguous',
      message: `"${query}" matched multiple chats; pass a JID or a more specific name.`,
      candidates: cands,
    };
  }
  const top = cands[0];
  return { ok: true, jid: top.jid, name: top.name, is_group: top.is_group };
}
