import { getDb } from '../database/index.js';
import { log } from './logger.js';

// In-memory bidirectional cache for fast lookups
const lidToPhone = new Map<string, string>();
const phoneToLid = new Map<string, string>();

/**
 * Register a LID ↔ phone JID mapping. Persists to DB and caches in memory.
 */
export function registerJidAlias(lid: string, phoneJid: string): void {
  if (!lid || !phoneJid) return;
  if (!lid.endsWith('@lid') || !phoneJid.endsWith('@s.whatsapp.net')) return;

  // Skip if already cached with the same mapping
  if (lidToPhone.get(lid) === phoneJid) return;

  lidToPhone.set(lid, phoneJid);
  phoneToLid.set(phoneJid, lid);

  const db = getDb();
  db.prepare(`
    INSERT INTO jid_aliases (lid, phone_jid) VALUES (?, ?)
    ON CONFLICT(lid) DO UPDATE SET phone_jid = excluded.phone_jid
  `).run(lid, phoneJid);
}

/**
 * Normalize a JID to prefer @s.whatsapp.net over @lid.
 * If remoteJidAlt is provided, registers the mapping.
 */
export function normalizeJid(remoteJid: string, remoteJidAlt?: string | null): string {
  if (!remoteJid) return remoteJid;

  // If we have both JIDs, register the mapping and return the phone JID
  if (remoteJidAlt) {
    if (remoteJid.endsWith('@lid') && remoteJidAlt.endsWith('@s.whatsapp.net')) {
      registerJidAlias(remoteJid, remoteJidAlt);
      return remoteJidAlt;
    }
    if (remoteJid.endsWith('@s.whatsapp.net') && remoteJidAlt.endsWith('@lid')) {
      registerJidAlias(remoteJidAlt, remoteJid);
      return remoteJid;
    }
  }

  // If it's a LID, try to resolve it from cache
  if (remoteJid.endsWith('@lid')) {
    return lidToPhone.get(remoteJid) || remoteJid;
  }

  return remoteJid;
}

/**
 * Resolve a single JID — if it's a LID, return the phone JID if known.
 */
export function resolveToPhoneJid(jid: string): string {
  if (!jid) return jid;
  if (jid.endsWith('@lid')) {
    return lidToPhone.get(jid) || jid;
  }
  return jid;
}

/**
 * Load all JID aliases from DB into in-memory cache. Call on startup.
 */
export function loadJidAliases(): void {
  const db = getDb();
  const rows = db.prepare('SELECT lid, phone_jid FROM jid_aliases').all() as Array<{
    lid: string;
    phone_jid: string;
  }>;
  for (const row of rows) {
    lidToPhone.set(row.lid, row.phone_jid);
    phoneToLid.set(row.phone_jid, row.lid);
  }
  log.jid.info({ count: rows.length }, 'Loaded JID aliases');
}

/**
 * One-time migration: scan existing messages for remoteJidAlt, build alias map,
 * then update remote_jid / from_jid / chats / contacts to use phone JIDs.
 */
export function migrateExistingJids(): void {
  const db = getDb();

  // 1. Extract aliases from raw_message JSON for ALL messages that have a LID
  //    somewhere (either remote_jid is LID, or the raw JSON contains remoteJidAlt)
  const messages = db
    .prepare(
      `SELECT id, remote_jid, from_jid, raw_message FROM messages
       WHERE raw_message IS NOT NULL
         AND (remote_jid LIKE '%@lid' OR raw_message LIKE '%remoteJidAlt%')`
    )
    .all() as Array<{
    id: string;
    remote_jid: string;
    from_jid: string | null;
    raw_message: string;
  }>;

  let aliasCount = 0;

  for (const msg of messages) {
    try {
      const raw = JSON.parse(msg.raw_message);
      const key = raw?.key;
      if (!key) continue;

      const jid = key.remoteJid;
      const alt = key.remoteJidAlt;

      if (jid && alt) {
        if (jid.endsWith('@lid') && alt.endsWith('@s.whatsapp.net')) {
          if (!lidToPhone.has(jid)) aliasCount++;
          registerJidAlias(jid, alt);
        } else if (jid.endsWith('@s.whatsapp.net') && alt.endsWith('@lid')) {
          if (!lidToPhone.has(alt)) aliasCount++;
          registerJidAlias(alt, jid);
        }
      }
    } catch {
      // Skip unparseable messages
    }
  }

  if (aliasCount === 0 && lidToPhone.size === 0) {
    log.jid.info('No LID aliases found, skipping migration');
    return;
  }

  log.jid.info({ newAliases: aliasCount, total: lidToPhone.size }, 'Discovered JID aliases');

  // 2. Update messages: remote_jid and from_jid
  const updateRemoteJid = db.prepare(
    'UPDATE messages SET remote_jid = ? WHERE remote_jid = ?'
  );
  const updateFromJid = db.prepare(
    'UPDATE messages SET from_jid = ? WHERE from_jid = ?'
  );

  let msgUpdated = 0;
  const updateTx = db.transaction(() => {
    for (const [lid, phoneJid] of lidToPhone) {
      msgUpdated += updateRemoteJid.run(phoneJid, lid).changes;
      updateFromJid.run(phoneJid, lid);
    }
  });
  updateTx();

  // 3. Merge chats: LID → phone JID
  for (const [lid, phoneJid] of lidToPhone) {
    const phoneChat = db
      .prepare('SELECT * FROM chats WHERE jid = ?')
      .get(phoneJid);
    const lidChat = db.prepare('SELECT * FROM chats WHERE jid = ?').get(lid);

    if (lidChat && phoneChat) {
      // Both exist — delete the LID one (messages now point to phone JID)
      db.prepare('DELETE FROM chats WHERE jid = ?').run(lid);
    } else if (lidChat && !phoneChat) {
      // Only LID exists — rename it
      db.prepare('UPDATE chats SET jid = ? WHERE jid = ?').run(phoneJid, lid);
    }
  }

  // 4. Merge contacts: LID → phone JID
  for (const [lid, phoneJid] of lidToPhone) {
    const phoneContact = db
      .prepare('SELECT * FROM contacts WHERE jid = ?')
      .get(phoneJid);
    const lidContact = db
      .prepare('SELECT * FROM contacts WHERE jid = ?')
      .get(lid) as { name: string | null; notify_name: string | null; short_name: string | null } | undefined;

    if (lidContact && phoneContact) {
      // Merge: fill any blanks in the phone contact from the LID contact, then delete LID
      db.prepare(
        `UPDATE contacts SET
           name = COALESCE(contacts.name, ?),
           notify_name = COALESCE(contacts.notify_name, ?),
           short_name = COALESCE(contacts.short_name, ?),
           phone_number = COALESCE(contacts.phone_number, ?),
           updated_at = datetime('now')
         WHERE jid = ?`
      ).run(
        lidContact.name,
        lidContact.notify_name,
        lidContact.short_name,
        phoneJid.replace('@s.whatsapp.net', ''),
        phoneJid
      );
      db.prepare('DELETE FROM contacts WHERE jid = ?').run(lid);
    } else if (lidContact && !phoneContact) {
      // Only LID exists — rename it and set phone number
      db.prepare(
        'UPDATE contacts SET jid = ?, phone_number = COALESCE(phone_number, ?) WHERE jid = ?'
      ).run(phoneJid, phoneJid.replace('@s.whatsapp.net', ''), lid);
    }
  }

  log.jid.info({ messagesUpdated: msgUpdated }, 'Migration complete — merged chats and contacts');
}
