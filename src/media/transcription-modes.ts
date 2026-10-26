export const TRANSCRIPTION_MODES = ['off', 'on'] as const;

export type TranscriptionMode = (typeof TRANSCRIPTION_MODES)[number];

// Quality levels from the former local CrisperWhisper backend. Stored settings
// and env files may still hold them; any of them means transcription is on.
const LEGACY_ENABLED_MODES = ['fast', 'medium', 'best'];

export function normalizeTranscriptionMode(
  value: string | undefined,
  fallback: TranscriptionMode = 'off'
): TranscriptionMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized && LEGACY_ENABLED_MODES.includes(normalized)) return 'on';
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
