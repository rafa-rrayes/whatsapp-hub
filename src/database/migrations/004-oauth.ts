import type Database from 'better-sqlite3-multiple-ciphers';
import type { Migration } from './index.js';

/**
 * OAuth 2.1 tables for /mcp.
 *
 * All bearer / refresh / auth-code values are hashed (SHA-256) before insert;
 * plaintext never lives on disk. Client secrets are likewise hashed — the SDK's
 * default client-auth comparator is overridden in src/mcp/oauth/provider.ts to
 * compare against the hash.
 *
 * PKCE method is S256 only (SDK constraint), so it isn't stored — implied.
 */
export const migration: Migration = {
  id: '004-oauth',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id                TEXT PRIMARY KEY,
        client_secret_hash       TEXT,
        client_name              TEXT,
        metadata_json            TEXT NOT NULL,
        client_id_issued_at      INTEGER NOT NULL,
        client_secret_expires_at INTEGER,
        first_authorized_at      INTEGER
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_auth_codes (
        code_hash      TEXT PRIMARY KEY,
        client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        redirect_uri   TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        scopes_json    TEXT,
        resource       TEXT,
        expires_at     INTEGER NOT NULL,
        used           INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_client ON oauth_auth_codes(client_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_expires ON oauth_auth_codes(expires_at);`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash         TEXT PRIMARY KEY,
        refresh_hash       TEXT UNIQUE,
        family_id          TEXT NOT NULL,
        client_id          TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        scopes_json        TEXT,
        resource           TEXT NOT NULL,
        expires_at         INTEGER,
        refresh_expires_at INTEGER,
        revoked            INTEGER NOT NULL DEFAULT 0,
        rotated_at         INTEGER,
        created_at         INTEGER NOT NULL
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens(refresh_hash);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client ON oauth_tokens(client_id, revoked);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_family ON oauth_tokens(family_id);`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_consent_state (
        cid         TEXT PRIMARY KEY,
        client_id   TEXT NOT NULL,
        params_json TEXT NOT NULL,
        attempts    INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_consent_expires ON oauth_consent_state(expires_at);`);
  },
};
