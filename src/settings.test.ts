import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config defaults before importing settings.
vi.mock('./config.js', () => ({
  config: {
    logLevel: 'info',
    autoDownloadMedia: true,
    maxMediaSizeMB: 100,
    transcriptionMode: 'off',
    transcriptionLanguage: 'en',
    crisperWhisperPython: 'python3',
    crisperWhisperCacheDir: '/tmp/whatsapp-hub-test-models',
    crisperWhisperComputeType: 'float32',
    crisperWhisperCpuThreads: 0,
    crisperWhisperTimeoutMs: 1_000,
    security: { encryptionKey: 'test-encryption-key-at-least-16-chars' },
  },
}));

// In-memory settings store standing in for the SQLite-backed repo.
const store = new Map<string, string>();
vi.mock('./database/repositories/settings.js', () => ({
  settingsRepo: {
    get: (k: string) => (store.has(k) ? { key: k, value: store.get(k), updated_at: '' } : undefined),
    getAll: () => [...store.entries()].map(([key, value]) => ({ key, value, updated_at: '' })),
    set: (k: string, v: string) => void store.set(k, v),
    delete: (k: string) => void store.delete(k),
  },
}));

vi.mock('./utils/logger.js', () => ({
  logger: { level: 'info', warn: vi.fn() },
}));

const settings = await import('./settings.js');
describe('local transcription settings', () => {
  beforeEach(() => {
    store.clear();
    settings.initSettings();
  });

  it('stores and reads the selected mode', () => {
    settings.updateSettings({ transcriptionMode: 'best' });
    expect(store.get('transcriptionMode')).toBe('best');
    expect(settings.getSettings().transcriptionMode).toBe('best');
  });

  it('stores the explicit speech language', () => {
    settings.updateSettings({ transcriptionLanguage: 'pt' });
    expect(settings.getSettings().transcriptionLanguage).toBe('pt');
  });

  it('maps the legacy enabled boolean to Medium', () => {
    store.set('transcribeMedia', 'true');
    settings.initSettings();
    expect(settings.getSettings().transcriptionMode).toBe('medium');
  });

  it('keeps a legacy disabled override off', () => {
    store.set('transcribeMedia', 'false');
    settings.initSettings();
    expect(settings.getSettings().transcriptionMode).toBe('off');
  });

  it('exposes mode and language through the settings API', () => {
    const items = settings.getSettingsForApi();
    expect(items.find((i) => i.key === 'transcriptionMode')?.value).toBe('off');
    expect(items.find((i) => i.key === 'transcriptionLanguage')?.value).toBe('en');
  });
});
