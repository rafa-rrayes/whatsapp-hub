import { describe, it, expect, vi, afterEach } from 'vitest';

// Provide a fake configured Gemini key/model without loading the real settings stack.
vi.mock('../settings.js', () => ({
  getSettings: () => ({ geminiApiKey: 'test-key', geminiModel: 'gemini-3.1-flash-lite' }),
}));

import { transcribeMedia, transcriptionKindFor } from './transcribe.js';

describe('transcriptionKindFor', () => {
  it('transcribes audio (ignoring codec params)', () => {
    expect(transcriptionKindFor('audio/ogg; codecs=opus')).toBe('audio');
    expect(transcriptionKindFor('audio/mpeg')).toBe('audio');
  });

  it('describes images but skips stickers', () => {
    expect(transcriptionKindFor('image/jpeg')).toBe('image');
    expect(transcriptionKindFor('image/png')).toBe('image');
    expect(transcriptionKindFor('image/webp')).toBeNull();
  });

  it('skips video and documents', () => {
    expect(transcriptionKindFor('video/mp4')).toBeNull();
    expect(transcriptionKindFor('application/pdf')).toBeNull();
  });
});

describe('transcribeMedia', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the Gemini request and parses the response', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '  hello world  ' }] } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await transcribeMedia({
      buffer: Buffer.from('abc'),
      mimeType: 'audio/ogg; codecs=opus',
      kind: 'audio',
    });

    expect(out).toBe('hello world'); // trimmed

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('gemini-3.1-flash-lite:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');

    const body = JSON.parse(init.body as string);
    const parts = body.contents[0].parts;
    expect(parts[0].inline_data.mime_type).toBe('audio/ogg'); // codec param stripped
    expect(parts[0].inline_data.data).toBe(Buffer.from('abc').toString('base64'));
    expect(parts[1].text).toMatch(/transcribe/i);
  });

  it('uses the image prompt for images', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a cat' }] } }] }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await transcribeMedia({ buffer: Buffer.from('x'), mimeType: 'image/jpeg', kind: 'image' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.contents[0].parts[1].text).toMatch(/describe/i);
  });

  it('throws with the API error message on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 400 })
      )
    );
    await expect(
      transcribeMedia({ buffer: Buffer.from('x'), mimeType: 'image/jpeg', kind: 'image' })
    ).rejects.toThrow('invalid api key');
  });

  it('rejects oversize input before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const big = Buffer.alloc(19 * 1024 * 1024);
    await expect(
      transcribeMedia({ buffer: big, mimeType: 'image/jpeg', kind: 'image' })
    ).rejects.toThrow(/too large/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
