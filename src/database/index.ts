import Database from 'better-sqlite3';
import { createRequire } from 'module';
import crypto from 'crypto';
import { config } from '../config.js';
import { applySchema } from './schema.js';
import { migrateWebhookSecrets } from '../utils/encryption.js';
import { log } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Load the database constructor. When encryption is enabled, dynamically load
 * @journeyapps/sqlcipher (API-compatible with better-sqlite3) so the Docker
 * image doesn't depend on a native module that only ships pre-built binaries
 * for a subset of platforms.
 */
function getDatabaseConstructor(): typeof Database {
  if (!config.security.encryptDatabase) return Database;

  const esmRequire = createRequire(import.meta.url);
  try {
    return esmRequire('@journeyapps/sqlcipher') as typeof Database;
  } catch {
    throw new Error(
      'Database encryption requires the @journeyapps/sqlcipher package.\n' +
      'Install it: npm install @journeyapps/sqlcipher\n' +
      'Pre-built binaries may not be available for all platforms (e.g. Alpine ARM64).',
    );
  }
}

function applyEncryptionKey(database: Database.Database, derivedKeyHex: string): void {
  // Use hex-encoded key to prevent SQL injection (hex only contains [0-9a-f])
  database.pragma(`key="x'${derivedKeyHex}'"`);
}

function deriveDbKey(): string | null {
  if (!config.security.encryptDatabase || !config.security.encryptionKey) return null;

  const derived = crypto.hkdfSync('sha256', config.security.encryptionKey, '', 'whatsapp-hub-db', 32);
  return Buffer.from(derived).toString('hex');
}

function testDbAccess(database: Database.Database): boolean {
  try {
    database.prepare('SELECT count(*) FROM sqlite_master').get();
    return true;
  } catch {
    return false;
  }
}

function migrateToEncrypted(dbPath: string, keyHex: string, DbConstructor: typeof Database): void {
  log.db.info('Migrating unencrypted database to encrypted format...');

  // 1. Open unencrypted DB and checkpoint WAL
  const unencryptedDb = new DbConstructor(dbPath);
  unencryptedDb.pragma('wal_checkpoint(TRUNCATE)');

  // 2. Create backup
  const backupPath = dbPath + '.pre-encryption-backup';
  log.db.info({ backupPath }, 'Creating backup of unencrypted database');
  fs.copyFileSync(dbPath, backupPath);

  // 3. Export to encrypted DB
  const encryptedPath = dbPath + '.encrypted-tmp';
  try {
    unencryptedDb.exec(`ATTACH DATABASE '${encryptedPath}' AS encrypted KEY "x'${keyHex}'"`)
    unencryptedDb.exec(`SELECT sqlcipher_export('encrypted')`);
    unencryptedDb.exec(`DETACH DATABASE encrypted`);
    unencryptedDb.close();
  } catch (err) {
    unencryptedDb.close();
    // Clean up temp file
    try { fs.unlinkSync(encryptedPath); } catch {}
    throw new Error(`Database encryption migration failed: ${err instanceof Error ? err.message : String(err)}. Original database is untouched.`);
  }

  // 4. Verify the encrypted DB
  const verifyDb = new DbConstructor(encryptedPath);
  applyEncryptionKey(verifyDb, keyHex);
  if (!testDbAccess(verifyDb)) {
    verifyDb.close();
    try { fs.unlinkSync(encryptedPath); } catch {}
    throw new Error('Database encryption migration failed: verification of encrypted database failed. Original database is untouched.');
  }
  verifyDb.close();

  // 5. Atomic swap
  fs.renameSync(encryptedPath, dbPath);
  log.db.info('Database encryption migration completed successfully');
}

export function initDb(): Database.Database {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  }

  const DbConstructor = getDatabaseConstructor();
  const keyHex = deriveDbKey();

  if (keyHex) {
    // Encryption enabled — try opening with key first
    db = new DbConstructor(config.dbPath);
    fs.chmodSync(config.dbPath, 0o640);
    applyEncryptionKey(db, keyHex);

    if (!testDbAccess(db)) {
      // Key didn't work — check if DB is unencrypted and needs migration
      db.close();

      const plainDb = new DbConstructor(config.dbPath);
      const isPlaintext = testDbAccess(plainDb);
      plainDb.close();

      if (isPlaintext) {
        // Unencrypted DB needs migration
        migrateToEncrypted(config.dbPath, keyHex, DbConstructor);

        // Reopen the now-encrypted DB
        db = new DbConstructor(config.dbPath);
        fs.chmodSync(config.dbPath, 0o640);
        applyEncryptionKey(db, keyHex);

        if (!testDbAccess(db)) {
          throw new Error('Failed to open database after encryption migration');
        }
      } else {
        throw new Error('Cannot open database: wrong encryption key or corrupt database file');
      }
    }
  } else {
    // No encryption — standard open
    db = new DbConstructor(config.dbPath);
    fs.chmodSync(config.dbPath, 0o640);
  }

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  applySchema(db);

  // Migrate webhook secrets to encrypted form if enabled
  if (config.security.encryptWebhookSecrets && config.security.encryptionKey) {
    migrateWebhookSecrets(db);
  }

  log.db.info({ path: config.dbPath, encrypted: !!keyHex }, 'SQLite initialized');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    log.db.info('Database closed');
  }
}
