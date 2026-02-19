import { config } from '../config.js';
import { getDb } from '../database/index.js';
import { log } from './logger.js';

const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STARTUP_DELAY_MS = 30_000; // 30s so first prune doesn't block boot

let pruneTimer: ReturnType<typeof setInterval> | undefined;
let startupTimer: ReturnType<typeof setTimeout> | undefined;

function prune(): void {
  if (!config.security.autoPrune) return;

  try {
    const db = getDb();

    const presenceResult = db.prepare(
      `DELETE FROM presence_log WHERE logged_at < datetime('now', '-' || ? || ' days')`
    ).run(config.security.presenceRetentionDays);

    const eventResult = db.prepare(
      `DELETE FROM event_log WHERE logged_at < datetime('now', '-' || ? || ' days')`
    ).run(config.security.eventRetentionDays);

    if (presenceResult.changes > 0 || eventResult.changes > 0) {
      log.db.info(
        { presenceDeleted: presenceResult.changes, eventsDeleted: eventResult.changes },
        'Auto-prune completed'
      );
    }
  } catch (err) {
    log.db.error({ err }, 'Auto-prune failed');
  }
}

export function startAutoPrune(): void {
  if (!config.security.autoPrune) return;

  log.db.info(
    { presenceRetentionDays: config.security.presenceRetentionDays, eventRetentionDays: config.security.eventRetentionDays },
    'Auto-prune enabled'
  );

  // Delayed first prune so it doesn't block startup
  startupTimer = setTimeout(prune, STARTUP_DELAY_MS);

  // Recurring prune every 6 hours
  pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);
  pruneTimer.unref();
}

export function stopAutoPrune(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (pruneTimer) clearInterval(pruneTimer);
}
