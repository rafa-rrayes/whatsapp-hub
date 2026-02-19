import { getDb } from '../index.js';

export interface GroupRow {
  jid: string;
  name?: string;
  description?: string;
  owner_jid?: string;
  creation_time?: number;
  participant_count: number;
  is_announce: number;
  is_restrict: number;
  profile_pic_url?: string;
  invite_code?: string;
  first_seen_at: string;
  updated_at: string;
}

export interface GroupParticipantRow {
  group_jid: string;
  participant_jid: string;
  role: string;
  added_at: string;
}

export const groupsRepo = {
  upsert(group: Partial<GroupRow>): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO groups (jid, name, description, owner_jid, creation_time, participant_count, is_announce, is_restrict, profile_pic_url, invite_code)
      VALUES (@jid, @name, @description, @owner_jid, @creation_time, @participant_count, @is_announce, @is_restrict, @profile_pic_url, @invite_code)
      ON CONFLICT(jid) DO UPDATE SET
        name = COALESCE(excluded.name, groups.name),
        description = COALESCE(excluded.description, groups.description),
        owner_jid = COALESCE(excluded.owner_jid, groups.owner_jid),
        participant_count = COALESCE(excluded.participant_count, groups.participant_count),
        is_announce = COALESCE(excluded.is_announce, groups.is_announce),
        is_restrict = COALESCE(excluded.is_restrict, groups.is_restrict),
        profile_pic_url = COALESCE(excluded.profile_pic_url, groups.profile_pic_url),
        invite_code = COALESCE(excluded.invite_code, groups.invite_code),
        updated_at = datetime('now')
    `).run({
      jid: group.jid,
      name: group.name || null,
      description: group.description || null,
      owner_jid: group.owner_jid || null,
      creation_time: group.creation_time || null,
      participant_count: group.participant_count ?? 0,
      is_announce: group.is_announce ?? 0,
      is_restrict: group.is_restrict ?? 0,
      profile_pic_url: group.profile_pic_url || null,
      invite_code: group.invite_code || null,
    });
  },

  setParticipants(groupJid: string, participants: Array<{ jid: string; role: string }>): void {
    const db = getDb();
    const deleteStmt = db.prepare('DELETE FROM group_participants WHERE group_jid = ?');
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO group_participants (group_jid, participant_jid, role)
      VALUES (?, ?, ?)
    `);

    const tx = db.transaction(() => {
      deleteStmt.run(groupJid);
      for (const p of participants) {
        insertStmt.run(groupJid, p.jid, p.role);
      }
    });
    tx();
  },

  getByJid(jid: string): GroupRow | undefined {
    return getDb().prepare('SELECT * FROM groups WHERE jid = ?').get(jid) as GroupRow | undefined;
  },

  getAll(search?: string): GroupRow[] {
    const db = getDb();
    if (search) {
      return db.prepare(
        `SELECT * FROM groups WHERE name LIKE @s OR jid LIKE @s ORDER BY name`
      ).all({ s: `%${search}%` }) as GroupRow[];
    }
    return db.prepare('SELECT * FROM groups ORDER BY name').all() as GroupRow[];
  },

  getParticipants(groupJid: string): GroupParticipantRow[] {
    return getDb()
      .prepare('SELECT * FROM group_participants WHERE group_jid = ? ORDER BY role, participant_jid')
      .all(groupJid) as GroupParticipantRow[];
  },

  getCount(): number {
    return (getDb().prepare('SELECT COUNT(*) as c FROM groups').get() as { c: number }).c;
  },
};
