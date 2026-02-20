import Database from 'better-sqlite3-multiple-ciphers';
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

function migrateToEncrypted(dbPath: string, keyHex: string): void {
  log.db.info('Migrating unencrypted database to encrypted format...');

  // 1. Create backup before any modification
  const backupPath = dbPath + '.pre-encryption-backup';
  log.db.info({ backupPath }, 'Creating backup of unencrypted database');
  fs.copyFileSync(dbPath, backupPath);

  // 2. Open unencrypted DB, switch out of WAL (rekey requires DELETE journal mode), then encrypt
  const database = new Database(dbPath);
  database.pragma('wal_checkpoint(TRUNCATE)');
  database.pragma('journal_mode = DELETE');

  try {
    database.pragma(`rekey="x'${keyHex}'"`);
    database.close();
  } catch (err) {
    database.close();
    // Restore from backup
    fs.copyFileSync(backupPath, dbPath);
    throw new Error(`Database encryption migration failed: ${err instanceof Error ? err.message : String(err)}. Original database restored from backup.`);
  }

  // 3. Verify the now-encrypted DB can be opened with the key
  const verifyDb = new Database(dbPath);
  applyEncryptionKey(verifyDb, keyHex);
  if (!testDbAccess(verifyDb)) {
    verifyDb.close();
    // Restore from backup
    fs.copyFileSync(backupPath, dbPath);
    throw new Error('Database encryption migration failed: verification failed. Original database restored from backup.');
  }
  verifyDb.close();

  log.db.info('Database encryption migration completed successfully');
}

export function initDb(): Database.Database {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  }

  const keyHex = deriveDbKey();

  if (keyHex) {
    // Try opening with key first
    db = new Database(config.dbPath);
    fs.chmodSync(config.dbPath, 0o640);
    applyEncryptionKey(db, keyHex);

    if (!testDbAccess(db)) {
      // Key didn't work — check if DB is unencrypted and needs migration
      db.close();

      const plainDb = new Database(config.dbPath);
      const isPlaintext = testDbAccess(plainDb);
      plainDb.close();

      if (isPlaintext) {
        // Unencrypted DB needs migration
        migrateToEncrypted(config.dbPath, keyHex);

        // Reopen the now-encrypted DB
        db = new Database(config.dbPath);
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
    db = new Database(config.dbPath);
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
