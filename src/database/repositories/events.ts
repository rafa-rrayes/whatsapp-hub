import { getDb } from '../index.js';

export interface EventRow {
  id: number;
  event_type: string;
  payload: string;
  logged_at: string;
}

export interface EventTypeCount {
  event_type: string;
  count: number;
}

export const eventsRepo = {
  log(eventType: string, payload: unknown): void {
    getDb()
      .prepare('INSERT INTO event_log (event_type, payload) VALUES (?, ?)')
      .run(eventType, JSON.stringify(payload));
  },

  query(opts: { type?: string; limit?: number; offset?: number; after?: string }): EventRow[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: Record<string, string | number> = {};

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
      .all({ ...params, limit, offset }) as EventRow[];
  },

  getEventTypes(): EventTypeCount[] {
    return getDb()
      .prepare('SELECT event_type, COUNT(*) as count FROM event_log GROUP BY event_type ORDER BY count DESC')
      .all() as EventTypeCount[];
  },

  prune(olderThanDays: number): number {
    const result = getDb()
      .prepare(`DELETE FROM event_log WHERE logged_at < datetime('now', '-' || ? || ' days')`)
      .run(olderThanDays);
    return result.changes;
  },
};
