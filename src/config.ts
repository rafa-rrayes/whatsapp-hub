import dotenv from 'dotenv';
import path from 'path';
import { isInsecureDefaultKey, generateSecureKey } from './utils/security.js';

dotenv.config();

// Validate API key at import time
const rawApiKey = process.env.API_KEY || '';

if (!rawApiKey || isInsecureDefaultKey(rawApiKey)) {
  const generated = generateSecureKey();
  console.error('='.repeat(60));
  console.error('  SECURITY ERROR: API_KEY is not set or uses an insecure default.');
  console.error('  Set a strong, random API_KEY in your .env file or environment.');
  console.error('');
  console.error('  Here is a generated key you can use:');
  console.error(`  API_KEY=${generated}`);
  console.error('='.repeat(60));
  process.exit(1);
}

if (rawApiKey.length < 16) {
  console.error('SECURITY ERROR: API_KEY must be at least 16 characters long.');
  process.exit(1);
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

  logLevel: (process.env.LOG_LEVEL || 'info') as string,
  sessionName: process.env.SESSION_NAME || 'default',

  get authDir() {
    return path.join(this.dataDir, 'auth', this.sessionName);
  },
};

// Warn if webhook URLs are configured but no secret is set
if (config.webhookUrls.length > 0 && !config.webhookSecret) {
  console.warn('[Security] WARNING: Webhook URLs configured without WEBHOOK_SECRET. Payloads will be unsigned.');
}
