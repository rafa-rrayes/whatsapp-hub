import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config (provides an encryption key + env defaults) before importing settings.
vi.mock('./config.js', () => ({
  config: {
    logLevel: 'info',
    autoDownloadMedia: true,
    maxMediaSizeMB: 100,
    transcribeMedia: false,
    geminiApiKey: '',
    geminiModel: 'gemini-3.1-flash-lite',
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
const { isEncrypted } = await import('./utils/encryption.js');

describe('settings secret handling (geminiApiKey)', () => {
  beforeEach(() => {
    store.clear();
    settings.initSettings();
  });

  it('encrypts the API key at rest', () => {
    settings.updateSettings({ geminiApiKey: 'sk-secret-123' });
    const stored = store.get('geminiApiKey')!;
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain('sk-secret-123');
  });

  it('decrypts the API key when reading runtime settings', () => {
    settings.updateSettings({ geminiApiKey: 'sk-secret-123' });
    expect(settings.getSettings().geminiApiKey).toBe('sk-secret-123');
  });

  it('masks the API key value in the API output but reports isSet', () => {
    settings.updateSettings({ geminiApiKey: 'sk-secret-123' });
    const item = settings.getSettingsForApi().find((i) => i.key === 'geminiApiKey')!;
    expect(item.isSecret).toBe(true);
    expect(item.isSet).toBe(true);
    expect(item.value).toBe('');
  });

  it('reports isSet=false when no key is configured', () => {
    const item = settings.getSettingsForApi().find((i) => i.key === 'geminiApiKey')!;
    expect(item.isSet).toBe(false);
  });

  it('stores non-secret settings as plaintext', () => {
    settings.updateSettings({ transcribeMedia: true });
    expect(store.get('transcribeMedia')).toBe('true');
    expect(settings.getSettings().transcribeMedia).toBe(true);
  });
});
