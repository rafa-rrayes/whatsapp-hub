import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// Extensions the OpenAI transcription API accepts as-is. WhatsApp voice notes
// are Ogg/Opus, which it does not, so those are converted first.
const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm']);

export function isAudioMimeType(mimeType: string): boolean {
  return (mimeType.split(';')[0] || '').trim().toLowerCase().startsWith('audio/');
}

export function needsConversion(audioPath: string, sizeBytes: number): boolean {
  return !SUPPORTED_EXTENSIONS.has(path.extname(audioPath).toLowerCase()) || sizeBytes > MAX_UPLOAD_BYTES;
}

/**
 * Re-encode to mono 16 kHz 32 kbps MP3: a format the API accepts, and small
 * enough (~14 MB per hour) to stay under the upload limit.
 */
async function convertToMp3(audioPath: string, outputPath: string): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    ['-nostdin', '-loglevel', 'error', '-y', '-i', audioPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', outputPath],
    { timeout: config.transcriptionTimeoutMs }
  );
}

export interface TranscribeOptions {
  audioPath: string;
  language: string;
}

/** Transcribe one audio file with the OpenAI API. Throws on any failure. */
export async function transcribeAudio(opts: TranscribeOptions): Promise<string> {
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not set');

  let uploadPath = opts.audioPath;
  let tempDir: string | undefined;
  try {
    if (needsConversion(opts.audioPath, fs.statSync(opts.audioPath).size)) {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-'));
      uploadPath = path.join(tempDir, 'audio.mp3');
      await convertToMp3(opts.audioPath, uploadPath);
      if (fs.statSync(uploadPath).size > MAX_UPLOAD_BYTES) {
        throw new Error('Audio is too long to transcribe (over 25 MB after compression)');
      }
    }

    const form = new FormData();
    form.append('model', config.transcriptionModel);
    form.append('file', await fs.openAsBlob(uploadPath), path.basename(uploadPath));
    form.append('languages[]', opts.language);

    const res = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: form,
      signal: AbortSignal.timeout(config.transcriptionTimeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
    if (!res.ok) {
      throw new Error(`OpenAI transcription failed (${res.status}): ${body.error?.message ?? res.statusText}`);
    }
    return (body.text ?? '').trim();
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
