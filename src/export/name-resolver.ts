import { contactsRepo } from '../database/repositories/contacts.js';
import { groupsRepo } from '../database/repositories/groups.js';
import { chatsRepo } from '../database/repositories/chats.js';
import { hashJid } from '../utils/security.js';
import type { ExportOptions } from './types.js';

export interface NameResolver {
  /** Resolve a JID to a human label for use in chat headings or sender prefixes. */
  resolveName(jid: string | undefined, fallbackPushName?: string): string;
  /** Resolve a JID to a chat label (groups use their name, DMs use the contact). */
  resolveChatLabel(jid: string): string;
  /** Resolve a JID to a stable display key for grouping (preferred name, falls back to short jid). */
  resolveBareName(jid: string | undefined): string;
}

const SHORT_JID_RE = /^(\d+)(@.+)?$/;

function shortJid(jid: string): string {
  const m = jid.match(SHORT_JID_RE);
  return m ? `+${m[1]}` : jid;
}

function applyAnonymisation(jid: string, anonymize: boolean): string {
  return anonymize ? hashJid(jid, true) : jid;
}

export function buildNameResolver(opts: ExportOptions, meJid?: string): NameResolver {
  // Preload contacts and groups once so we don't hit the DB per-message.
  const contacts = new Map<string, { name?: string; notify_name?: string; short_name?: string }>();
  for (const c of contactsRepo.getAll()) {
    contacts.set(c.jid, { name: c.name, notify_name: c.notify_name, short_name: c.short_name });
  }
  const groups = new Map<string, { name?: string }>();
  for (const g of groupsRepo.getAll()) {
    groups.set(g.jid, { name: g.name });
  }
  // Chats can also have a name (e.g. group chats keep `name` in chats table)
  const chats = new Map<string, { name?: string; is_group: number }>();
  for (const c of chatsRepo.getAll({ limit: 100_000 })) {
    chats.set(c.jid, { name: c.name, is_group: c.is_group });
  }

  const anonymize = opts.anonymize_jids;
  const meAlias = opts.me_alias;

  function pickContactName(jid: string, fallbackPushName?: string): string {
    if (meJid && jid === meJid) return meAlias;
    const contact = contacts.get(jid);
    if (opts.prefer_saved_names) {
      if (contact?.name) return contact.name;
      if (contact?.notify_name) return contact.notify_name;
      if (contact?.short_name) return contact.short_name;
    } else {
      if (fallbackPushName) return fallbackPushName;
      if (contact?.name) return contact.name;
      if (contact?.notify_name) return contact.notify_name;
    }
    if (fallbackPushName) return fallbackPushName;
    return shortJid(applyAnonymisation(jid, anonymize));
  }

  return {
    resolveName(jid, fallbackPushName) {
      if (!jid) return fallbackPushName || 'Unknown';
      return pickContactName(jid, fallbackPushName);
    },
    resolveChatLabel(jid) {
      if (jid.endsWith('@g.us')) {
        const g = groups.get(jid);
        if (g?.name) return g.name;
        const c = chats.get(jid);
        if (c?.name) return c.name;
        return `Group ${shortJid(applyAnonymisation(jid, anonymize))}`;
      }
      if (jid === 'status@broadcast') return 'WhatsApp Status';
      if (jid.endsWith('@broadcast')) return 'Broadcast list';
      // DM or @lid
      const c = chats.get(jid);
      if (c?.name) return c.name;
      return pickContactName(jid);
    },
    resolveBareName(jid) {
      if (!jid) return 'Unknown';
      return pickContactName(jid);
    },
  };
}
