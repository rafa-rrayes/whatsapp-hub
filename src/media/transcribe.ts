import { getSettings } from '../settings.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Gemini inline-data requests must stay under 20 MB total — keep headroom. */
const MAX_INLINE_BYTES = 18 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

export type TranscribeKind = 'audio' | 'image';

const PROMPTS: Record<TranscribeKind, string> = {
  audio:
    'Transcribe this voice message verbatim into text. ' +
    'Respond with only the transcription — no preamble, labels, or quotation marks. ' +
    'If there is no intelligible speech, respond with an empty string.',
  image:
    'Describe this image as accurately as you can, in one or two sentences for someone who cannot see it. ' +
    'Focus on the main subject and any clearly legible text. Respond with only the description and text extracted.',
};

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/** Strip parameters (e.g. "; codecs=opus") and normalize a mime type. */
function baseMime(mimeType: string): string {
  return (mimeType.split(';')[0] || '').trim().toLowerCase();
}

/**
 * Decide whether a media item should be processed and how.
 * Audio is transcribed; non-sticker images are described. Stickers (image/webp),
 * video and documents are skipped.
 */
export function transcriptionKindFor(mimeType: string): TranscribeKind | null {
  const m = baseMime(mimeType);
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/') && m !== 'image/webp') return 'image';
  return null;
}

export interface TranscribeOptions {
  buffer: Buffer;
  mimeType: string;
  kind: TranscribeKind;
}

/**
 * Send media to Google Gemini and return the transcription (audio) or
 * description (image). Throws on misconfiguration, oversize input, network/API
 * errors, or blocked content. Returns '' when the model produced no text.
 */
export async function transcribeMedia(opts: TranscribeOptions): Promise<string> {
  const { geminiApiKey, geminiModel } = getSettings();
  if (!geminiApiKey) throw new Error('Gemini API key is not configured');

  if (opts.buffer.length > MAX_INLINE_BYTES) {
    const mb = Math.round(opts.buffer.length / 1024 / 1024);
    throw new Error(`Media too large for inline transcription (${mb}MB > 18MB)`);
  }

  const requestBody = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: baseMime(opts.mimeType), data: opts.buffer.toString('base64') } },
          { text: PROMPTS[opts.kind] },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${GEMINI_ENDPOINT}/${encodeURIComponent(geminiModel)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );

    const json = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok) {
      throw new Error(`Gemini request failed: ${json.error?.message || `HTTP ${res.status}`}`);
    }
    if (json.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the request: ${json.promptFeedback.blockReason}`);
    }

    return (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();
  } finally {
    clearTimeout(timeout);
  }
}
