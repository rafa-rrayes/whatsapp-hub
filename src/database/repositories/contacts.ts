import { getDb } from '../index.js';

export interface ContactRow {
  jid: string;
  name?: string;
  notify_name?: string;
  short_name?: string;
  phone_number?: string;
  is_business: number;
  is_group: number;
  profile_pic_url?: string;
  status_text?: string;
  first_seen_at: string;
  updated_at: string;
}

export const contactsRepo = {
  upsert(contact: Partial<ContactRow>): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO contacts (jid, name, notify_name, short_name, phone_number, is_business, is_group, profile_pic_url, status_text)
      VALUES (@jid, @name, @notify_name, @short_name, @phone_number, @is_business, @is_group, @profile_pic_url, @status_text)
      ON CONFLICT(jid) DO UPDATE SET
        name = COALESCE(excluded.name, contacts.name),
        notify_name = COALESCE(excluded.notify_name, contacts.notify_name),
        short_name = COALESCE(excluded.short_name, contacts.short_name),
        phone_number = COALESCE(excluded.phone_number, contacts.phone_number),
        is_business = COALESCE(excluded.is_business, contacts.is_business),
        profile_pic_url = COALESCE(excluded.profile_pic_url, contacts.profile_pic_url),
        status_text = COALESCE(excluded.status_text, contacts.status_text),
        updated_at = datetime('now')
    `).run({
      jid: contact.jid,
      name: contact.name || null,
      notify_name: contact.notify_name || null,
      short_name: contact.short_name || null,
      phone_number: contact.phone_number || null,
      is_business: contact.is_business ?? 0,
      is_group: contact.is_group ?? 0,
      profile_pic_url: contact.profile_pic_url || null,
      status_text: contact.status_text || null,
    });
  },

  getByJid(jid: string): ContactRow | undefined {
    return getDb().prepare('SELECT * FROM contacts WHERE jid = ?').get(jid) as ContactRow | undefined;
  },

  getAll(search?: string): ContactRow[] {
    const db = getDb();
    if (search) {
      return db.prepare(
        `SELECT * FROM contacts WHERE is_group = 0 AND (
          name LIKE @s OR notify_name LIKE @s OR phone_number LIKE @s OR jid LIKE @s
        ) ORDER BY name`
      ).all({ s: `%${search}%` }) as ContactRow[];
    }
    return db.prepare('SELECT * FROM contacts WHERE is_group = 0 ORDER BY name').all() as ContactRow[];
  },

  getCount(): number {
    return (getDb().prepare('SELECT COUNT(*) as c FROM contacts WHERE is_group = 0').get() as { c: number }).c;
  },
};
