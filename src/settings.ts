import { config } from './config.js';
import { settingsRepo } from './database/repositories/settings.js';
import { logger } from './utils/logger.js';
import { encryptSetting, maybeDecryptSetting } from './utils/encryption.js';

export interface RuntimeSettings {
  logLevel: string;
  autoDownloadMedia: boolean;
  maxMediaSizeMB: number;
  transcribeMedia: boolean;
  geminiApiKey: string;
  geminiModel: string;
}

export interface SettingItem {
  key: string;
  value: unknown;
  defaultValue: unknown;
  isOverridden: boolean;
  /** True for secret settings (e.g. API keys) — value is never returned. */
  isSecret?: boolean;
  /** For secret settings: whether a non-empty value is currently configured. */
  isSet?: boolean;
}

interface SettingDef<T> {
  envDefault: () => T;
  parse: (raw: string) => T;
  serialize: (val: T) => string;
  /** Secret values are encrypted at rest and masked in the API. */
  secret?: boolean;
}

const SETTING_DEFS: Record<string, SettingDef<unknown>> = {
  logLevel: {
    envDefault: () => config.logLevel,
    parse: (raw: string) => raw,
    serialize: (val) => val as string,
  },
  autoDownloadMedia: {
    envDefault: () => config.autoDownloadMedia,
    parse: (raw: string) => raw === 'true',
    serialize: (val) => String(val),
  },
  maxMediaSizeMB: {
    envDefault: () => config.maxMediaSizeMB,
    parse: (raw: string) => parseInt(raw, 10),
    serialize: (val) => String(val),
  },
  transcribeMedia: {
    envDefault: () => config.transcribeMedia,
    parse: (raw: string) => raw === 'true',
    serialize: (val) => String(val),
  },
  geminiApiKey: {
    envDefault: () => config.geminiApiKey,
    parse: (raw: string) => raw,
    serialize: (val) => val as string,
    secret: true,
  },
  geminiModel: {
    envDefault: () => config.geminiModel,
    parse: (raw: string) => raw,
    serialize: (val) => val as string,
  },
};

let cache: RuntimeSettings = {
  logLevel: config.logLevel,
  autoDownloadMedia: config.autoDownloadMedia,
  maxMediaSizeMB: config.maxMediaSizeMB,
  transcribeMedia: config.transcribeMedia,
  geminiApiKey: config.geminiApiKey,
  geminiModel: config.geminiModel,
};

function buildCache(): RuntimeSettings {
  const rows = settingsRepo.getAll();
  const dbMap = new Map(rows.map((r) => [r.key, r.value]));

  const settings: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    let dbVal = dbMap.get(key);
    if (dbVal !== undefined && def.secret) dbVal = maybeDecryptSetting(dbVal);
    settings[key] = dbVal !== undefined ? def.parse(dbVal) : def.envDefault();
  }
  return settings as unknown as RuntimeSettings;
}

function applySideEffects(settings: RuntimeSettings): void {
  logger.level = settings.logLevel;
}

export function initSettings(): void {
  cache = buildCache();
  applySideEffects(cache);
}

export function getSettings(): Readonly<RuntimeSettings> {
  return cache;
}

export function updateSettings(partial: Partial<RuntimeSettings>): void {
  for (const [key, value] of Object.entries(partial)) {
    const def = SETTING_DEFS[key];
    if (!def) continue;
    let serialized = def.serialize(value);
    if (def.secret && serialized) {
      if (config.security.encryptionKey) {
        serialized = encryptSetting(serialized);
      } else {
        logger.warn(
          `Storing secret setting "${key}" without ENCRYPTION_KEY set — value is kept in plaintext. ` +
          'Set ENCRYPTION_KEY to encrypt it at rest.'
        );
      }
    }
    settingsRepo.set(key, serialized);
  }
  cache = buildCache();
  applySideEffects(cache);
}

export function getSettingsForApi(): SettingItem[] {
  return Object.entries(SETTING_DEFS).map(([key, def]) => {
    const isOverridden = settingsRepo.get(key) !== undefined;
    if (def.secret) {
      // Never expose secret values; report only whether one is configured.
      const currentValue = cache[key as keyof RuntimeSettings];
      return {
        key,
        value: '',
        defaultValue: '',
        isOverridden,
        isSecret: true,
        isSet: !!currentValue,
      };
    }
    return {
      key,
      value: cache[key as keyof RuntimeSettings],
      defaultValue: def.envDefault(),
      isOverridden,
    };
  });
}

export function resetSetting(key: string): void {
  settingsRepo.delete(key);
  cache = buildCache();
  applySideEffects(cache);
}
