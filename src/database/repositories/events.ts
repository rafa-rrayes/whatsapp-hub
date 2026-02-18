import { getDb } from '../index.js';

export const eventsRepo = {
  log(eventType: string, payload: any): void {
    getDb()
      .prepare('INSERT INTO event_log (event_type, payload) VALUES (?, ?)')
      .run(eventType, JSON.stringify(payload));
  },

  query(opts: { type?: string; limit?: number; offset?: number; after?: string }): any[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: any = {};

    if (opts.type) {
      conditions.push('event_type = @type');
      params.type = opts.type;
    }
    if (opts.after) {
      conditions.push('logged_at > @after');
      params.after = opts.after;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit || 50;
    const offset = opts.offset || 0;

    return db
      .prepare(`SELECT * FROM event_log ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset });
  },

  getEventTypes(): any[] {
    return getDb()
      .prepare('SELECT event_type, COUNT(*) as count FROM event_log GROUP BY event_type ORDER BY count DESC')
      .all();
  },

  prune(olderThanDays: number): number {
    const result = getDb()
      .prepare(`DELETE FROM event_log WHERE logged_at < datetime('now', '-' || ? || ' days')`)
      .run(olderThanDays);
    return result.changes;
  },
};
