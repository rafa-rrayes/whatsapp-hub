import { config } from './config.js';
import { settingsRepo } from './database/repositories/settings.js';
import { logger } from './utils/logger.js';

export interface RuntimeSettings {
  logLevel: string;
  autoDownloadMedia: boolean;
  maxMediaSizeMB: number;
}

export interface SettingItem {
  key: string;
  value: unknown;
  defaultValue: unknown;
  isOverridden: boolean;
}

interface SettingDef<T> {
  envDefault: () => T;
  parse: (raw: string) => T;
  serialize: (val: T) => string;
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
};

let cache: RuntimeSettings = {
  logLevel: config.logLevel,
  autoDownloadMedia: config.autoDownloadMedia,
  maxMediaSizeMB: config.maxMediaSizeMB,
};

function buildCache(): RuntimeSettings {
  const rows = settingsRepo.getAll();
  const dbMap = new Map(rows.map((r) => [r.key, r.value]));

  const settings: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    const dbVal = dbMap.get(key);
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
    settingsRepo.set(key, def.serialize(value));
  }
  cache = buildCache();
  applySideEffects(cache);
}

export function getSettingsForApi(): SettingItem[] {
  return Object.entries(SETTING_DEFS).map(([key, def]) => {
    const defaultValue = def.envDefault();
    const currentValue = cache[key as keyof RuntimeSettings];
    return {
      key,
      value: currentValue,
      defaultValue,
      isOverridden: settingsRepo.get(key) !== undefined,
    };
  });
}

export function resetSetting(key: string): void {
  settingsRepo.delete(key);
  cache = buildCache();
  applySideEffects(cache);
}
