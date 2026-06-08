import { describe, it, expect, vi } from 'vitest';
import { awaitHistoryBatch, resolveHistoryBatch } from './history-waiter.js';

describe('history-waiter', () => {
  it('resolves with the batch count when resolved before the timeout', async () => {
    const p = awaitHistoryBatch('a@s.whatsapp.net', 1000);
    resolveHistoryBatch('a@s.whatsapp.net', 42);
    await expect(p).resolves.toBe(42);
  });

  it('resolves null after the timeout elapses with no reply', async () => {
    vi.useFakeTimers();
    try {
      const p = awaitHistoryBatch('b@s.whatsapp.net', 5000);
      const seen = vi.fn();
      void p.then(seen);
      await vi.advanceTimersByTimeAsync(4999);
      expect(seen).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is FIFO for repeated requests on the same jid', async () => {
    const p1 = awaitHistoryBatch('c@s.whatsapp.net', 1000);
    const p2 = awaitHistoryBatch('c@s.whatsapp.net', 1000);
    resolveHistoryBatch('c@s.whatsapp.net', 1);
    resolveHistoryBatch('c@s.whatsapp.net', 2);
    await expect(p1).resolves.toBe(1);
    await expect(p2).resolves.toBe(2);
  });

  it('keeps waiters independent across jids', async () => {
    const pa = awaitHistoryBatch('d@s.whatsapp.net', 1000);
    const pb = awaitHistoryBatch('e@s.whatsapp.net', 1000);
    resolveHistoryBatch('e@s.whatsapp.net', 9);
    await expect(pb).resolves.toBe(9);
    resolveHistoryBatch('d@s.whatsapp.net', 7);
    await expect(pa).resolves.toBe(7);
  });

  it('ignores a resolve with no pending waiter (stray reply)', () => {
    expect(() => resolveHistoryBatch('nobody@s.whatsapp.net', 5)).not.toThrow();
  });

  it('does not fire the timeout once resolved', async () => {
    vi.useFakeTimers();
    try {
      const p = awaitHistoryBatch('f@s.whatsapp.net', 1000);
      resolveHistoryBatch('f@s.whatsapp.net', 3);
      await expect(p).resolves.toBe(3);
      // Advancing past the timeout must not flip the already-resolved value.
      await vi.advanceTimersByTimeAsync(2000);
      await expect(p).resolves.toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
