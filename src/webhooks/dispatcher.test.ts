import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HubEvent } from '../events/bus.js';

// Mock dependencies
const mockSubs: Array<{ id: string; url: string; secret: string | null; events: string; is_active: number }> = [];

vi.mock('../database/index.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: () => mockSubs.filter((s) => s.is_active === 1),
    }),
  }),
}));

vi.mock('../utils/logger.js', () => ({
  log: {
    webhook: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('../utils/security.js', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    // Make validateUrlForFetch always pass in tests (no DNS resolution needed)
    validateUrlForFetch: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../utils/encryption.js', () => ({
  maybeDecrypt: (v: string) => v,
}));

// Create a simple mock event bus
const handlers: Map<string, Function[]> = new Map();
vi.mock('../events/bus.js', () => ({
  eventBus: {
    on: (event: string, handler: Function) => {
      const list = handlers.get(event) || [];
      list.push(handler);
      handlers.set(event, list);
    },
  },
}));

// Mock fetch globally
const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
vi.stubGlobal('fetch', fetchMock);

// Import after mocks
const { webhookDispatcher } = await import('./dispatcher.js');

function emitEvent(event: HubEvent): void {
  const wildcardHandlers = handlers.get('*') || [];
  for (const h of wildcardHandlers) {
    h(event);
  }
}

describe('WebhookDispatcher', () => {
  beforeEach(() => {
    mockSubs.length = 0;
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    // Start the dispatcher to register event handlers
    webhookDispatcher.start();
  });

  afterEach(() => {
    handlers.clear();
  });

  it('dispatches events to matching subscriptions', async () => {
    mockSubs.push({
      id: 'sub-1',
      url: 'https://example.com/hook',
      secret: null,
      events: '*',
      is_active: 1,
    });

    webhookDispatcher.invalidateCache();

    emitEvent({ type: 'wa.message', timestamp: Date.now(), data: { text: 'hello' } });

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 100));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['X-Hub-Event']).toBe('wa.message');
  });

  it('filters events by subscription event list', async () => {
    mockSubs.push({
      id: 'sub-1',
      url: 'https://example.com/hook',
      secret: null,
      events: 'wa.message,wa.group',
      is_active: 1,
    });

    webhookDispatcher.invalidateCache();

    // Should match
    emitEvent({ type: 'wa.message', timestamp: Date.now(), data: {} });
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();

    // Should not match — "call" doesn't start with "wa.message" or "wa.group"
    emitEvent({ type: 'call.offer', timestamp: Date.now(), data: {} });
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips internal events (non wa./message./call)', async () => {
    mockSubs.push({
      id: 'sub-1',
      url: 'https://example.com/hook',
      secret: null,
      events: '*',
      is_active: 1,
    });

    webhookDispatcher.invalidateCache();

    emitEvent({ type: 'internal.connection', timestamp: Date.now(), data: {} });
    await new Promise((r) => setTimeout(r, 100));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('includes HMAC signature when secret is set', async () => {
    mockSubs.push({
      id: 'sub-1',
      url: 'https://example.com/hook',
      secret: 'my-secret',
      events: '*',
      is_active: 1,
    });

    webhookDispatcher.invalidateCache();

    emitEvent({ type: 'wa.message', timestamp: Date.now(), data: { text: 'hello' } });
    await new Promise((r) => setTimeout(r, 100));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['X-Hub-Signature']).toMatch(/^sha256=[a-f0-9]+$/);
  });

  it('skips inactive subscriptions', async () => {
    mockSubs.push({
      id: 'sub-1',
      url: 'https://example.com/hook',
      secret: null,
      events: '*',
      is_active: 0,
    });

    webhookDispatcher.invalidateCache();

    emitEvent({ type: 'wa.message', timestamp: Date.now(), data: {} });
    await new Promise((r) => setTimeout(r, 100));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
