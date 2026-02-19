import crypto from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'enc:';

/**
 * Derive a purpose-specific key from the master ENCRYPTION_KEY using HKDF.
 * Each `info` string produces a unique 32-byte key.
 */
export function deriveKey(info: string): Buffer {
  const masterKey = config.security.encryptionKey;
  if (!masterKey) throw new Error('ENCRYPTION_KEY is not set');
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, '', info, 32));
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns: "enc:" + base64(iv[12] + authTag[16] + ciphertext)
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return ENCRYPTED_PREFIX + combined.toString('base64');
}

/**
 * Decrypt a value encrypted by encrypt().
 * Expects: "enc:" + base64(iv[12] + authTag[16] + ciphertext)
 */
export function decrypt(encoded: string, key: Buffer): string {
  if (!encoded.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error('Value is not encrypted');
  }
  const combined = Buffer.from(encoded.slice(ENCRYPTED_PREFIX.length), 'base64');
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Check if a value is encrypted (has the enc: prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

// Lazy-initialized webhook secret key
let webhookSecretKey: Buffer | null = null;

function getWebhookSecretKey(): Buffer {
  if (!webhookSecretKey) {
    webhookSecretKey = deriveKey('whatsapp-hub-webhook-secrets');
  }
  return webhookSecretKey;
}

/**
 * Encrypt a webhook secret for storage.
 */
export function encryptWebhookSecret(secret: string): string {
  return encrypt(secret, getWebhookSecretKey());
}

/**
 * Decrypt a webhook secret, or return as-is if not encrypted (migration support).
 */
export function maybeDecrypt(value: string): string {
  if (!isEncrypted(value)) return value;
  try {
    return decrypt(value, getWebhookSecretKey());
  } catch {
    return value;
  }
}

/**
 * Migrate all plaintext webhook secrets to encrypted form.
 * Called at startup when SECURITY_ENCRYPT_WEBHOOK_SECRETS is enabled.
 * Accepts a db instance to avoid circular imports.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateWebhookSecrets(db: any): void {
  if (!config.security.encryptWebhookSecrets || !config.security.encryptionKey) return;

  const rows = db.prepare('SELECT id, secret FROM webhook_subscriptions WHERE secret IS NOT NULL').all() as Array<{ id: string; secret: string }>;

  let migrated = 0;
  for (const row of rows) {
    if (!isEncrypted(row.secret)) {
      const encrypted = encryptWebhookSecret(row.secret);
      db.prepare('UPDATE webhook_subscriptions SET secret = ? WHERE id = ?').run(encrypted, row.id);
      migrated++;
    }
  }

  if (migrated > 0) {
    process.stderr.write(`[Security] Migrated ${migrated} webhook secret(s) to encrypted storage.\n`);
  }
}
