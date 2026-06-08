import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (installed before importing the runner) ─────────────────────────────

const getStatus = vi.fn(() => 'connected' as string);
const requestHistorySync = vi.fn();
vi.mock('../connection/manager.js', () => ({
  connectionManager: { getStatus, requestHistorySync },
}));

const getOldestForChat = vi.fn();
vi.mock('../database/repositories/messages.js', () => ({
  messagesRepo: { getOldestForChat },
}));

// Identity normalize — fixtures already use canonical jids.
vi.mock('../utils/jid.js', () => ({ normalizeJid: (j: string) => j }));

vi.mock('../utils/logger.js', () => ({
  log: { event: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

// Capture every progress event into one ordered log so we can assert sequence.
type Ev = { t: string } & Record<string, unknown>;
const events: Ev[] = [];
vi.mock('../events/sync-progress.js', () => ({
  emitSyncStarted: (p: object) => events.push({ t: 'started', ...p }),
  emitSyncRequested: (p: object) => events.push({ t: 'requested', ...p }),
  emitSyncReceived: (p: object) => events.push({ t: 'received', ...p }),
  emitSyncFinished: (p: object) => events.push({ t: 'finished', ...p }),
}));

// The waiter is REAL — the requestHistorySync mock resolves it, exactly mirroring
// how the live messaging-history.set handler wakes the runner.
const { resolveHistoryBatch } = await import('../events/history-waiter.js');
const { startHistorySync, isHistorySyncRunning } = await import('./history-sync.js');

interface ChatSpec {
  /** Older messages WhatsApp can still serve for this chat. */
  available: number;
  /** When false, the local "oldest" cursor never advances (simulates a stuck chat). */
  moveCursor?: boolean;
  /** When true, getOldestForChat returns undefined (no stored message to anchor on). */
  noAnchor?: boolean;
}

/**
 * Install a fake WhatsApp "world": requestHistorySync serves up to the requested
 * count from what's left and wakes the waiter — like a real on-demand reply —
 * while the cursor walks backwards as messages arrive.
 */
function makeWorld(chats: Record<string, ChatSpec>) {
  const state: Record<string, { remaining: number; n: number; moveCursor: boolean; noAnchor: boolean }> = {};
  for (const [jid, c] of Object.entries(chats)) {
    state[jid] = { remaining: c.available, n: 0, moveCursor: c.moveCursor ?? true, noAnchor: !!c.noAnchor };
  }
  getOldestForChat.mockImplementation((j: string) => {
    const s = state[j];
    if (!s || s.noAnchor) return undefined;
    return { id: s.moveCursor ? `${j}-m${s.n}` : `${j}-fixed`, from_me: 0, timestamp: 100000 - s.n };
  });
  requestHistorySync.mockImplementation(async (key: { remoteJid: string }, _ts: number, count: number) => {
    const s = state[key.remoteJid];
    const give = s ? Math.min(count, s.remaining) : 0;
    if (s) {
      s.remaining -= give;
      s.n++;
    }
    resolveHistoryBatch(key.remoteJid, give);
    return 'msgid';
  });
  return state;
}

/** Drive the background run to completion under fake timers. */
async function drain() {
  for (let i = 0; i < 50 && isHistorySyncRunning(); i++) {
    await vi.runAllTimersAsync();
  }
}

const reqCounts = () => requestHistorySync.mock.calls.map((c) => c[2] as number);
const byType = (t: string) => events.filter((e) => e.t === t);

beforeEach(() => {
  events.length = 0;
  getStatus.mockReturnValue('connected');
  requestHistorySync.mockReset();
  getOldestForChat.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('history-sync runner (depth-first)', () => {
  it('walks the cursor back across batches until the per-chat target is met', async () => {
    makeWorld({ 'a@s.whatsapp.net': { available: 1000 } });
    const r = startHistorySync({ scope: 'all', jids: ['a@s.whatsapp.net'], target: 120 });
    expect(r.started).toBe(true);
    await drain();

    expect(isHistorySyncRunning()).toBe(false);
    // 120 target, batch cap 50 → request sizes 50, 50, 20.
    expect(reqCounts()).toEqual([50, 50, 20]);
    expect(byType('started')[0]).toMatchObject({ scope: 'all', total: 1, count: 120 });
    expect(byType('requested')).toHaveLength(1);
    expect(byType('requested')[0]).toMatchObject({ jid: 'a@s.whatsapp.net', didRequest: true });
    // Runner emits exactly one terminal done marker per requested chat.
    expect(byType('received')).toHaveLength(1);
    expect(byType('received')[0]).toMatchObject({ jid: 'a@s.whatsapp.net', count: 0, done: true });
    expect(byType('finished')[0]).toMatchObject({ requested: 1, skipped: 0, total: 1 });
  });

  it('stops a chat early when WhatsApp returns fewer than requested (exhausted)', async () => {
    makeWorld({ 'b@s.whatsapp.net': { available: 80 } });
    startHistorySync({ scope: 'chat', jids: ['b@s.whatsapp.net'], target: 500 });
    await drain();

    // 50 served, then only 30 left (< the 50 asked) → stop. 2 requests.
    expect(reqCounts()).toEqual([50, 50]);
    expect(byType('finished')[0]).toMatchObject({ requested: 1, skipped: 0 });
  });

  it('stops when the history cursor stops moving', async () => {
    makeWorld({ 'c@s.whatsapp.net': { available: 1000, moveCursor: false } });
    startHistorySync({ scope: 'chat', jids: ['c@s.whatsapp.net'], target: 500 });
    await drain();

    // First batch fills 50 (== asked), but the cursor doesn't advance → stop.
    expect(requestHistorySync).toHaveBeenCalledTimes(1);
  });

  it('skips a chat with no stored anchor message', async () => {
    makeWorld({ 'd@s.whatsapp.net': { available: 0, noAnchor: true } });
    startHistorySync({ scope: 'all', jids: ['d@s.whatsapp.net'], target: 100 });
    await drain();

    expect(requestHistorySync).not.toHaveBeenCalled();
    expect(byType('requested')[0]).toMatchObject({ didRequest: false });
    expect(byType('received')).toHaveLength(0); // no done marker for a skipped chat
    expect(byType('finished')[0]).toMatchObject({ requested: 0, skipped: 1, total: 1 });
  });

  it('times out and settles the chat when no reply ever arrives', async () => {
    getOldestForChat.mockImplementation((j: string) =>
      j === 'e@s.whatsapp.net' ? { id: 'e0', from_me: 0, timestamp: 1 } : undefined
    );
    requestHistorySync.mockImplementation(async () => 'msgid'); // never wakes the waiter
    startHistorySync({ scope: 'chat', jids: ['e@s.whatsapp.net'], target: 200 });
    await drain();

    expect(requestHistorySync).toHaveBeenCalledTimes(1);
    expect(byType('received')[0]).toMatchObject({ jid: 'e@s.whatsapp.net', done: true });
    expect(byType('finished')).toHaveLength(1);
    expect(isHistorySyncRunning()).toBe(false);
  });

  it('rejects a second overlapping run while one is active', async () => {
    makeWorld({ 'f@s.whatsapp.net': { available: 1000 } });
    const r1 = startHistorySync({ scope: 'all', jids: ['f@s.whatsapp.net'], target: 100 });
    const r2 = startHistorySync({ scope: 'all', jids: ['f@s.whatsapp.net'], target: 100 });
    expect(r1.started).toBe(true);
    expect(r2.started).toBe(false);
    await drain();

    expect(isHistorySyncRunning()).toBe(false);
    expect(byType('started')).toHaveLength(1); // only the first run announced itself
  });

  it('finishes one chat completely before starting the next (depth-first order)', async () => {
    makeWorld({ 'g1@s.whatsapp.net': { available: 60 }, 'g2@s.whatsapp.net': { available: 60 } });
    startHistorySync({
      scope: 'all',
      jids: ['g1@s.whatsapp.net', 'g2@s.whatsapp.net'],
      target: 500,
    });
    await drain();

    // Each chat: 50 then 10 (<50) → 2 requests each, 4 total.
    expect(requestHistorySync).toHaveBeenCalledTimes(4);
    expect(byType('requested').map((e) => e.jid)).toEqual([
      'g1@s.whatsapp.net',
      'g2@s.whatsapp.net',
    ]);
    // g1's terminal "done" must come before g2 is ever requested.
    const g1Done = events.findIndex((e) => e.t === 'received' && e.jid === 'g1@s.whatsapp.net');
    const g2Req = events.findIndex((e) => e.t === 'requested' && e.jid === 'g2@s.whatsapp.net');
    expect(g1Done).toBeGreaterThanOrEqual(0);
    expect(g1Done).toBeLessThan(g2Req);
  });

  it('aborts the run when the socket drops mid-sweep', async () => {
    makeWorld({ 'h1@s.whatsapp.net': { available: 1000 }, 'h2@s.whatsapp.net': { available: 1000 } });
    // Connected for the first chat's check, then dropped before the second.
    getStatus.mockReturnValueOnce('connected').mockReturnValue('disconnected');
    startHistorySync({
      scope: 'all',
      jids: ['h1@s.whatsapp.net', 'h2@s.whatsapp.net'],
      target: 50,
    });
    await drain();

    // Only the first chat was requested; the run still emits a clean finished.
    expect(byType('requested').map((e) => e.jid)).toEqual(['h1@s.whatsapp.net']);
    expect(byType('finished')).toHaveLength(1);
    expect(isHistorySyncRunning()).toBe(false);
  });
});
