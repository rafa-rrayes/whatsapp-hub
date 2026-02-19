import { getDb } from '../index.js';

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export const settingsRepo = {
  get(key: string): SettingRow | undefined {
    return getDb()
      .prepare('SELECT * FROM settings WHERE key = ?')
      .get(key) as SettingRow | undefined;
  },

  getAll(): SettingRow[] {
    return getDb()
      .prepare('SELECT * FROM settings ORDER BY key')
      .all() as SettingRow[];
  },

  set(key: string, value: string): void {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value);
  },

  delete(key: string): void {
    getDb()
      .prepare('DELETE FROM settings WHERE key = ?')
      .run(key);
  },
};
