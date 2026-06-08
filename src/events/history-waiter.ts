/**
 * In-process correlator between an on-demand history request (sent via
 * connectionManager.requestHistorySync → Baileys fetchMessageHistory) and the
 * asynchronous `messaging-history.set` reply that carries the older messages.
 *
 * The depth-first sync runner (src/sync/history-sync.ts) issues ONE request at a
 * time per chat and needs to know how many messages came back before deciding
 * whether to walk further back or move on. WhatsApp delivers the reply
 * asynchronously with no request id we can rely on, so we correlate by the
 * (normalized) chat jid: the messaging-history.set handler calls
 * resolveHistoryBatch(jid, count) when an ON_DEMAND batch for that jid lands.
 */

interface Waiter {
  resolve: (count: number | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

// jid → FIFO queue of pending waiters. Normally length 0 or 1: the runner is
// depth-first, so at most one request is outstanding for a given jid at a time.
const waiters = new Map<string, Waiter[]>();

/**
 * Wait for the next on-demand history batch for `jid`. Resolves with the number
 * of messages stored from that batch, or `null` if `timeoutMs` elapses with no
 * reply (treat as "no response — give up on this chat").
 */
export function awaitHistoryBatch(jid: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const queue = waiters.get(jid);
      if (queue) {
        const idx = queue.indexOf(waiter);
        if (idx !== -1) queue.splice(idx, 1);
        if (queue.length === 0) waiters.delete(jid);
      }
      resolve(null);
    }, timeoutMs);

    const waiter: Waiter = { resolve, timer };
    const queue = waiters.get(jid);
    if (queue) queue.push(waiter);
    else waiters.set(jid, [waiter]);
  });
}

/**
 * Wake the oldest pending waiter for `jid` with the batch's message count.
 * No-op when nothing is waiting (e.g. an MCP-triggered or stray on-demand reply).
 */
export function resolveHistoryBatch(jid: string, count: number): void {
  const queue = waiters.get(jid);
  if (!queue || queue.length === 0) return;
  const waiter = queue.shift()!;
  if (queue.length === 0) waiters.delete(jid);
  clearTimeout(waiter.timer);
  waiter.resolve(count);
}
