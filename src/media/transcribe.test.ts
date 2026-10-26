import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  openaiApiKey: 'sk-test',
  transcriptionModel: 'gpt-transcribe',
  transcriptionTimeoutMs: 1_000,
}));
vi.mock('../config.js', () => ({ config }));

// Stand-in for ffmpeg: writes a small file at the output path (last argument).
const execFile = vi.hoisted(() =>
  vi.fn((_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: unknown) => void) => {
    fs.writeFileSync(args[args.length - 1], 'mp3');
    cb(null, { stdout: '', stderr: '' });
  })
);
vi.mock('node:child_process', () => ({ execFile }));

import { isAudioMimeType, needsConversion, transcribeAudio } from './transcribe.js';

let dir: string;
const fetchMock = vi.fn();

function writeAudio(name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'audio');
  return file;
}

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-test-'));
  config.openaiApiKey = 'sk-test';
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fetchMock.mockReset();
  execFile.mockClear();
  vi.unstubAllGlobals();
});

describe('transcription helpers', () => {
  it('recognizes audio mime types and ignores codec parameters', () => {
    expect(isAudioMimeType('audio/ogg; codecs=opus')).toBe(true);
    expect(isAudioMimeType('audio/mpeg')).toBe(true);
    expect(isAudioMimeType('image/png')).toBe(false);
    expect(isAudioMimeType('video/mp4')).toBe(false);
  });

  it('converts formats the API rejects and files over 25 MB', () => {
    expect(needsConversion('/m/voice.oga', 1_000)).toBe(true);
    expect(needsConversion('/m/voice.ogg', 1_000)).toBe(true);
    expect(needsConversion('/m/song.mp3', 1_000)).toBe(false);
    expect(needsConversion('/m/memo.M4A', 1_000)).toBe(false);
    expect(needsConversion('/m/long.mp3', 26 * 1024 * 1024)).toBe(true);
  });
});

describe('transcribeAudio', () => {
  it('uploads supported audio directly with the model and language hint', async () => {
    respond(200, { text: '  oi tudo bem  ', languages: [{ code: 'pt' }] });

    await expect(transcribeAudio({ audioPath: writeAudio('memo.mp3'), language: 'pt' })).resolves.toBe('oi tudo bem');

    expect(execFile).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test' });
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.getAll('languages[]')).toEqual(['pt']);
    expect((form.get('file') as File).name).toBe('memo.mp3');
  });

  it('converts Ogg voice notes to mp3 and cleans up the temp file', async () => {
    respond(200, { text: 'hello' });

    await expect(transcribeAudio({ audioPath: writeAudio('voice.oga'), language: 'en' })).resolves.toBe('hello');

    expect(execFile).toHaveBeenCalledOnce();
    const args = execFile.mock.calls[0][1];
    const output = args[args.length - 1];
    expect(path.basename(output)).toBe('audio.mp3');
    expect(fs.existsSync(path.dirname(output))).toBe(false);
    expect(((fetchMock.mock.calls[0][1].body as FormData).get('file') as File).name).toBe('audio.mp3');
  });

  it('surfaces API errors with the status and message', async () => {
    respond(429, { error: { message: 'You have no credits remaining.' } });

    await expect(transcribeAudio({ audioPath: writeAudio('memo.mp3'), language: 'en' })).rejects.toThrow(
      'OpenAI transcription failed (429): You have no credits remaining.'
    );
  });

  it('fails fast without an API key', async () => {
    config.openaiApiKey = '';

    await expect(transcribeAudio({ audioPath: writeAudio('memo.mp3'), language: 'en' })).rejects.toThrow(
      'OPENAI_API_KEY is not set'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
