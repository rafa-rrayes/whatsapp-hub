export const TRANSCRIPTION_MODES = ['off', 'fast', 'medium', 'best'] as const;

export type TranscriptionMode = (typeof TRANSCRIPTION_MODES)[number];
export type EnabledTranscriptionMode = Exclude<TranscriptionMode, 'off'>;

export const CRISPER_WHISPER_MODEL_BY_MODE: Record<EnabledTranscriptionMode, string> = {
  fast: 'turbo',
  medium: 'medium',
  best: 'large',
};

export function normalizeTranscriptionMode(
  value: string | undefined,
  fallback: TranscriptionMode = 'off'
): TranscriptionMode {
  const normalized = value?.trim().toLowerCase();
  return TRANSCRIPTION_MODES.includes(normalized as TranscriptionMode)
    ? (normalized as TranscriptionMode)
    : fallback;
}

export function normalizeTranscriptionLanguage(
  value: string | undefined,
  fallback = 'en'
): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-z]{2}$/.test(normalized) ? normalized : fallback;
}
