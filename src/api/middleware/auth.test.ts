import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock config module — default: query auth enabled
const mockConfig = {
  apiKey: 'test-api-key-that-is-long-enough',
  security: {
    disableHttpQueryAuth: false,
  },
};

vi.mock('../../config.js', () => ({
  config: mockConfig,
}));

const { authMiddleware } = await import('./auth.js');

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/api/test',
    headers: {},
    query: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response & { _status: number; _json: unknown } {
  const res: { _status: number; _json: unknown; status: (code: number) => typeof res; json: (data: unknown) => typeof res } = {
    _status: 0,
    _json: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
  };
  return res as unknown as Response & { _status: number; _json: unknown };
}

describe('authMiddleware', () => {
  let nextCalled: boolean;
  const next: NextFunction = () => { nextCalled = true; };

  beforeEach(() => {
    nextCalled = false;
    mockConfig.apiKey = 'test-api-key-that-is-long-enough';
    mockConfig.security.disableHttpQueryAuth = false;
  });

  it('allows health check without auth', () => {
    const req = createMockReq({ path: '/health' });
    const res = createMockRes();
    authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
  });

  it('allows /api/health without auth', () => {
    const req = createMockReq({ path: '/api/health' });
    const res = createMockRes();
    authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
  });

  it('authenticates via x-api-key header', () => {
    const req = createMockReq({
      headers: { 'x-api-key': 'test-api-key-that-is-long-enough' } as any,
    });
    const res = createMockRes();
    authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
  });

  it('authenticates via Authorization: Bearer header', () => {
    const req = createMockReq({
      headers: { authorization: 'Bearer test-api-key-that-is-long-enough' } as any,
    });
    const res = createMockRes();
    authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
  });

  it('authenticates via api_key query param when enabled', () => {
    const req = createMockReq({
      query: { api_key: 'test-api-key-that-is-long-enough' },
    });
    const res = createMockRes();
    authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
  });

  it('rejects api_key query param when disableHttpQueryAuth is true', () => {
    mockConfig.security.disableHttpQueryAuth = true;
    const req = createMockReq({
      query: { api_key: 'test-api-key-that-is-long-enough' },
    });
    const res = createMockRes();
    authMiddleware(req, res, next);
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
  });

  it('returns 401 for missing API key', () => {
    const req = createMockReq();
    const res = createMockRes();
    authMiddleware(req, res, next);
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as any).error).toBe('Unauthorized');
  });

  it('returns 401 for wrong API key', () => {
    const req = createMockReq({
      headers: { 'x-api-key': 'wrong-key-goes-here!' } as any,
    });
    const res = createMockRes();
    authMiddleware(req, res, next);
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
  });

  it('prefers x-api-key header over query param', () => {
    const req = createMockReq({
      headers: { 'x-api-key': 'test-api-key-that-is-long-enough' } as any,
      query: { api_key: 'wrong-key' },
    });
    const res = createMockRes();
    authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
  });
});
