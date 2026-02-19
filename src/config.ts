import dotenv from 'dotenv';
import path from 'path';
import { isInsecureDefaultKey, generateSecureKey } from './utils/security.js';

dotenv.config();

export const configErrors: string[] = [];

// Validate API key at import time
let rawApiKey = process.env.API_KEY || '';

if (!rawApiKey || isInsecureDefaultKey(rawApiKey)) {
  const generated = generateSecureKey();
  const sep = '='.repeat(60);
  const msg =
    `${sep}\n` +
    '  SECURITY ERROR: API_KEY is not set or uses an insecure default.\n' +
    '  Set a strong, random API_KEY in your .env file or environment.\n\n' +
    '  Here is a generated key you can use:\n' +
    `  API_KEY=${generated}\n` +
    `${sep}\n`;
  process.stderr.write(msg);
  configErrors.push(
    'API_KEY is not set or uses an insecure default. ' +
    'Set a strong, random API_KEY in your .env file or environment. ' +
    `Here is a generated key you can use: ${generated}`
  );
  rawApiKey = 'invalid-placeholder';
} else if (rawApiKey.length < 16) {
  process.stderr.write('SECURITY ERROR: API_KEY must be at least 16 characters long.\n');
  configErrors.push('API_KEY must be at least 16 characters long.');
  rawApiKey = 'invalid-placeholder';
}

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  host: process.env.HOST || '0.0.0.0',
  apiKey: rawApiKey,

  // Configurable CORS origin (comma-separated list, or * for all)
  corsOrigins: process.env.CORS_ORIGINS || '',

  dataDir: process.env.DATA_DIR || './data',
  get dbPath() {
    return path.join(this.dataDir, 'whatsapp-hub.db');
  },

  mediaDir: process.env.MEDIA_DIR || './data/media',
  maxMediaSizeMB: parseInt(process.env.MAX_MEDIA_SIZE_MB || '100', 10),
  autoDownloadMedia: process.env.AUTO_DOWNLOAD_MEDIA !== 'false',

  webhookUrls: (process.env.WEBHOOK_URLS || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean),
  webhookSecret: process.env.WEBHOOK_SECRET || '',

  behindProxy: process.env.BEHIND_PROXY === 'true',

  logLevel: (process.env.LOG_LEVEL || 'info') as string,
  sessionName: process.env.SESSION_NAME || 'default',

  get authDir() {
    return path.join(this.dataDir, 'auth', this.sessionName);
  },

  // Security settings — all toggleable, defaults to off (backward-compatible)
  security: {
    wsTicketAuth: process.env.SECURITY_WS_TICKET_AUTH === 'true',
    disableHttpQueryAuth: process.env.SECURITY_DISABLE_HTTP_QUERY_AUTH === 'true',
    stripRawMessages: process.env.SECURITY_STRIP_RAW_MESSAGES === 'true',
    encryptWebhookSecrets: process.env.SECURITY_ENCRYPT_WEBHOOK_SECRETS === 'true',
    encryptDatabase: process.env.SECURITY_ENCRYPT_DATABASE === 'true',
    encryptionKey: process.env.ENCRYPTION_KEY || '',
    autoPrune: process.env.SECURITY_AUTO_PRUNE === 'true',
    presenceRetentionDays: parseInt(process.env.PRESENCE_RETENTION_DAYS || '7', 10),
    eventRetentionDays: parseInt(process.env.EVENT_RETENTION_DAYS || '30', 10),
    hashEventJids: process.env.SECURITY_HASH_EVENT_JIDS === 'true',
    secFetchCheck: process.env.SECURITY_SEC_FETCH_CHECK === 'true',
  },
};

// Validate encryption key when encryption features are enabled
const needsEncryptionKey = config.security.encryptWebhookSecrets || config.security.encryptDatabase;
if (needsEncryptionKey && !config.security.encryptionKey) {
  process.stderr.write('[Security] ERROR: ENCRYPTION_KEY is required when encryption features are enabled.\n');
  configErrors.push('ENCRYPTION_KEY is required when SECURITY_ENCRYPT_WEBHOOK_SECRETS or SECURITY_ENCRYPT_DATABASE is enabled.');
} else if (config.security.encryptionKey && config.security.encryptionKey.length < 16) {
  process.stderr.write('[Security] ERROR: ENCRYPTION_KEY must be at least 16 characters long.\n');
  configErrors.push('ENCRYPTION_KEY must be at least 16 characters long.');
}

// Nudge toward secure setup when serving plain HTTP
if (!config.behindProxy) {
  process.stderr.write('[Security] WARNING: Running without HTTPS — consider using a reverse proxy for production. Set BEHIND_PROXY=true once configured.\n');
}

// Warn if webhook URLs are configured but no secret is set
if (config.webhookUrls.length > 0 && !config.webhookSecret) {
  // Logger may not be initialized yet at config load time, use stderr
  process.stderr.write('[Security] WARNING: Webhook URLs configured without WEBHOOK_SECRET. Payloads will be unsigned.\n');
}
