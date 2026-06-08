import { v4 as uuid } from 'uuid';
import { connectionManager } from '../connection/manager.js';
import { messagesRepo } from '../database/repositories/messages.js';
import { awaitHistoryBatch } from '../events/history-waiter.js';
import {
  emitSyncStarted,
  emitSyncRequested,
  emitSyncReceived,
  emitSyncFinished,
} from '../events/sync-progress.js';
import type { SyncScope } from '../events/sync-progress.js';
import { normalizeJid } from '../utils/jid.js';
import { log } from '../utils/logger.js';

/** Max older messages per single on-demand request (WhatsApp serves up to ~50). */
const BATCH_SIZE = 50;
/** How long to wait for a reply before treating the chat as exhausted. */
const REQUEST_TIMEOUT_MS = 20000;
/** Pause between successive requests so we don't flood WhatsApp. */
const THROTTLE_MS = 800;

/** Default per-chat message target when the caller doesn't specify one. */
export const DEFAULT_TARGET = 200;
/** Upper bound for the per-chat target (matches syncHistorySchema's max). */
export const MAX_TARGET = 500;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface RunHistorySyncOpts {
  scope: SyncScope;
  /** Chats to sync, in processing order. */
  jids: string[];
  /** Older messages to fetch per chat before moving on. */
  target: number;
}

export interface StartResult {
  started: boolean;
  sessionId: string;
  total: number;
}

// Only one sync may run at a time: a run keeps the socket busy with throttled
// on-demand requests, and overlapping runs would interleave their progress
// events and confuse the dashboard's per-chat tallies.
let running = false;

export function isHistorySyncRunning(): boolean {
  return running;
}

/**
 * Kick off a depth-first history sync in the background and return immediately.
 * Progress is delivered to the dashboard via `history.sync.*` WebSocket events,
 * so the HTTP caller never holds a (potentially many-minute) request open.
 * Returns `started: false` when a run is already in progress.
 */
export function startHistorySync(opts: RunHistorySyncOpts): StartResult {
  const sessionId = uuid();
  if (running) {
    return { started: false, sessionId, total: opts.jids.length };
  }
  running = true;
  void runHistorySync(sessionId, opts)
    .catch((err) => log.event.error({ err, sessionId }, 'history sync run failed'))
    .finally(() => {
      running = false;
    });
  return { started: true, sessionId, total: opts.jids.length };
}

/**
 * Fetch up to `target` older messages for a single chat, walking the cursor
 * backwards one batch at a time. Returns the number of messages fetched.
 *
 * The per-batch message counts are emitted by the messaging-history.set handler
 * as the replies land; here we only drive the request loop and use each batch's
 * size (via the history waiter) to decide whether to keep walking back.
 */
async function syncOneChatDeep(storeJid: string, target: number): Promise<number> {
  let fetched = 0;
  let oldest = messagesRepo.getOldestForChat(storeJid);
  if (!oldest) return 0;

  while (fetched < target) {
    const want = Math.min(BATCH_SIZE, target - fetched);
    const cursorKey = {
      remoteJid: storeJid,
      id: oldest.id,
      fromMe: !!oldest.from_me,
      participant: oldest.participant || undefined,
    };

    // Register the waiter BEFORE sending so a fast reply can't be missed.
    const batch = awaitHistoryBatch(storeJid, REQUEST_TIMEOUT_MS);
    try {
      await connectionManager.requestHistorySync(cursorKey, oldest.timestamp, want);
    } catch (err) {
      log.event.warn({ err, jid: storeJid }, 'history request failed — stopping chat');
      break;
    }

    const gained = await batch;
    if (gained === null || gained === 0) break; // no reply / nothing came back
    fetched += gained;
    if (gained < want) break; // WhatsApp returned fewer than asked — exhausted

    const next = messagesRepo.getOldestForChat(storeJid);
    if (!next || next.id === oldest.id) break; // cursor didn't move — exhausted
    oldest = next;
    await delay(THROTTLE_MS);
  }

  return fetched;
}

async function runHistorySync(sessionId: string, opts: RunHistorySyncOpts): Promise<void> {
  const { scope, jids, target } = opts;
  const total = jids.length;

  emitSyncStarted({ sessionId, scope, total, count: target });

  let requested = 0;
  let skipped = 0;
  let processed = 0;

  for (const rawJid of jids) {
    // Abort cleanly if the socket dropped mid-run.
    if (connectionManager.getStatus() !== 'connected') {
      log.event.warn({ sessionId, processed, total }, 'history sync aborted — not connected');
      break;
    }

    const storeJid = normalizeJid(rawJid);
    const didRequest = !!messagesRepo.getOldestForChat(storeJid);
    processed++;
    if (didRequest) requested++;
    else skipped++;

    // Open the per-chat row (pending) and advance the request counter.
    emitSyncRequested({ sessionId, jid: storeJid, didRequest, processed, total, requested, skipped });

    if (!didRequest) continue;

    try {
      await syncOneChatDeep(storeJid, target);
    } catch (err) {
      log.event.error({ err, jid: storeJid }, 'history sync chat failed');
    }

    // Settle this chat's row. The incremental message counts were already
    // emitted by the messaging-history.set handler as each batch arrived.
    emitSyncReceived({ jid: storeJid, count: 0, done: true });
  }

  emitSyncFinished({ sessionId, requested, skipped, total });
}
