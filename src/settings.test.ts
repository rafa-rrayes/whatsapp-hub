import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config defaults before importing settings.
vi.mock('./config.js', () => ({
  config: {
    logLevel: 'info',
    autoDownloadMedia: true,
    maxMediaSizeMB: 100,
    transcriptionMode: 'off',
    transcriptionLanguage: 'en',
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
describe('transcription settings', () => {
  beforeEach(() => {
    store.clear();
    settings.initSettings();
  });

  it('stores and reads the selected mode', () => {
    settings.updateSettings({ transcriptionMode: 'on' });
    expect(store.get('transcriptionMode')).toBe('on');
    expect(settings.getSettings().transcriptionMode).toBe('on');
  });

  it('turns the former local quality levels into on', () => {
    for (const legacy of ['fast', 'medium', 'best']) {
      store.set('transcriptionMode', legacy);
      settings.initSettings();
      expect(settings.getSettings().transcriptionMode).toBe('on');
    }
  });

  it('stores the explicit speech language', () => {
    settings.updateSettings({ transcriptionLanguage: 'pt' });
    expect(settings.getSettings().transcriptionLanguage).toBe('pt');
  });

  it('maps the legacy enabled boolean to on', () => {
    store.set('transcribeMedia', 'true');
    settings.initSettings();
    expect(settings.getSettings().transcriptionMode).toBe('on');
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
