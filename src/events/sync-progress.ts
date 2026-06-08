import { eventBus } from './bus.js';

/**
 * Lightweight, dashboard-only progress events for on-demand history sync
 * ("Sync older chats"). Published on the event bus so the WebSocket `*`
 * forwarder relays them to the dashboard in real time.
 *
 * These are intentionally NOT `wa.*` / `message.*` / `call*`, so the webhook
 * dispatcher (src/webhooks/dispatcher.ts) and the events-DB logger
 * (src/events/handler.ts) both skip them — they never reach webhooks or the DB.
 */

export const SYNC_PROGRESS_EVENTS = {
  started: 'history.sync.started',
  requested: 'history.sync.requested',
  received: 'history.sync.received',
  finished: 'history.sync.finished',
} as const;

export type SyncScope = 'all' | 'chat';

/** Sync run begun — one per button click. */
export interface SyncStartedPayload {
  sessionId: string;
  scope: SyncScope;
  /** Chats targeted by this run. */
  total: number;
  /** Older messages requested per chat. */
  count: number;
}

/** A single chat has been processed in the (throttled) request loop. */
export interface SyncRequestedPayload {
  sessionId: string;
  jid: string;
  /** false when the chat had no stored anchor message and was skipped. */
  didRequest: boolean;
  /** Chats processed so far (requested + skipped). */
  processed: number;
  total: number;
  /** Cumulative chats actually requested. */
  requested: number;
  /** Cumulative chats skipped. */
  skipped: number;
}

/** Older messages for a chat have arrived and been stored. */
export interface SyncReceivedPayload {
  jid: string;
  /** Messages stored from this on-demand batch for the jid. */
  count: number;
  /**
   * Terminal marker: the chat's request loop has finished (reached its target
   * or exhausted its history). Sent with `count: 0` so it settles the row to
   * "done" without changing the tally.
   */
  done?: boolean;
}

/** The request loop has finished (all requests fired). */
export interface SyncFinishedPayload {
  sessionId: string;
  requested: number;
  skipped: number;
  total: number;
}

export function emitSyncStarted(payload: SyncStartedPayload): void {
  eventBus.publish(SYNC_PROGRESS_EVENTS.started, payload);
}

export function emitSyncRequested(payload: SyncRequestedPayload): void {
  eventBus.publish(SYNC_PROGRESS_EVENTS.requested, payload);
}

export function emitSyncReceived(payload: SyncReceivedPayload): void {
  eventBus.publish(SYNC_PROGRESS_EVENTS.received, payload);
}

export function emitSyncFinished(payload: SyncFinishedPayload): void {
  eventBus.publish(SYNC_PROGRESS_EVENTS.finished, payload);
}
