/**
 * In-memory ring buffer of recent log lines.
 *
 * Pino writes every serialized log line here (via multistream in logger.ts) in
 * addition to stdout, so the dashboard's Logs tab can show what `docker logs`
 * would show without needing access to the Docker socket or a log file.
 */

const MAX_LINES = 2000;
const lines: string[] = [];

/** Writable-like target for pino.multistream — receives one serialized line per write. */
export const logBufferStream = {
  write(chunk: string | Buffer): void {
    const text = (typeof chunk === 'string' ? chunk : chunk.toString('utf8')).replace(/\n+$/, '');
    if (!text) return;
    for (const line of text.split('\n')) {
      if (line) lines.push(line);
    }
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  },
};

/** Most recent `limit` log lines in chronological order (oldest first). */
export function getRecentLogs(limit = 500): string[] {
  if (limit <= 0) return [];
  return lines.slice(-limit);
}
