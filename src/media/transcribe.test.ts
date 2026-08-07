import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    crisperWhisperPython: 'python3',
    crisperWhisperCacheDir: '/tmp/whatsapp-hub-test-models',
    crisperWhisperComputeType: 'float32',
    crisperWhisperCpuThreads: 0,
    crisperWhisperTimeoutMs: 1_000,
  },
}));

import {
  isAudioMimeType,
  LocalTranscriber,
  type LocalTranscriberOptions,
} from './transcribe.js';
import { CRISPER_WHISPER_MODEL_BY_MODE } from './transcription-modes.js';

const clients: LocalTranscriber[] = [];

function testClient(workerSource: string, timeoutMs = 1_000): LocalTranscriber {
  const options: LocalTranscriberOptions = {
    command: process.execPath,
    args: ['--input-type=module', '--eval', workerSource],
    timeoutMs,
  };
  const client = new LocalTranscriber(options);
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) client.stop('test cleanup');
});

describe('local transcription configuration', () => {
  it('recognizes audio mime types and ignores codec parameters', () => {
    expect(isAudioMimeType('audio/ogg; codecs=opus')).toBe(true);
    expect(isAudioMimeType('audio/mpeg')).toBe(true);
    expect(isAudioMimeType('image/png')).toBe(false);
    expect(isAudioMimeType('video/mp4')).toBe(false);
  });

  it('maps the quality modes to CrisperWhisper 2.0 model shorthands', () => {
    expect(CRISPER_WHISPER_MODEL_BY_MODE).toEqual({
      fast: 'turbo',
      medium: 'medium',
      best: 'large',
    });
  });
});

describe('LocalTranscriber', () => {
  it('uses a persistent JSON-lines worker and trims its response', async () => {
    const client = testClient(`
      import readline from 'node:readline';
      const lines = readline.createInterface({ input: process.stdin });
      lines.on('line', (line) => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({
          id: request.id,
          text: '  ' + request.model + ':' + request.language + '  '
        }) + '\\n');
      });
    `);

    await expect(client.transcribe({
      audioPath: '/tmp/voice.ogg',
      mode: 'fast',
      language: 'pt',
    })).resolves.toBe('turbo:pt');

    await expect(client.transcribe({
      audioPath: '/tmp/voice-2.ogg',
      mode: 'best',
      language: 'en',
    })).resolves.toBe('large:en');
  });

  it('surfaces a worker transcription error', async () => {
    const client = testClient(`
      import readline from 'node:readline';
      const lines = readline.createInterface({ input: process.stdin });
      lines.on('line', (line) => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({ id: request.id, error: 'decode failed' }) + '\\n');
      });
    `);

    await expect(client.transcribe({
      audioPath: '/tmp/broken.ogg',
      mode: 'medium',
      language: 'en',
    })).rejects.toThrow('decode failed');
  });

  it('stops a worker that exceeds the configured timeout', async () => {
    const client = testClient(`process.stdin.resume();`, 25);

    await expect(client.transcribe({
      audioPath: '/tmp/slow.ogg',
      mode: 'fast',
      language: 'en',
    })).rejects.toThrow(/timed out/i);
  });
});
