import { getDb } from '../../database/index.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { log } from '../../utils/logger.js';

/** Hard cap on registered clients — open DCR is rate-limited but also bounded. */
export const MAX_REGISTERED_CLIENTS = 100;

export interface ClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  metadata_json: string;
  client_id_issued_at: number;
  client_secret_expires_at: number | null;
  first_authorized_at: number | null;
}

export interface AuthCodeRow {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes_json: string | null;
  resource: string | null;
  expires_at: number;
  used: number;
}

export interface TokenRow {
  token_hash: string;
  refresh_hash: string | null;
  family_id: string;
  client_id: string;
  scopes_json: string | null;
  resource: string;
  expires_at: number | null;
  refresh_expires_at: number | null;
  revoked: number;
  rotated_at: number | null;
  created_at: number;
}

export interface ConsentRow {
  cid: string;
  client_id: string;
  params_json: string;
  attempts: number;
  created_at: number;
  expires_at: number;
}

/**
 * Rebuilds the SDK-shaped client info from a row. metadata_json holds the
 * full OAuthClientInformationFull at registration time so we don't have to
 * redundantly column-ify every RFC 7591 field.
 *
 * client_secret is intentionally omitted: see provider.ts preAuthClient
 * middleware — we authenticate via hash there, then the SDK's plaintext
 * compare is bypassed (it skips when client_secret is undefined).
 */
export function clientRowToInfo(row: ClientRow): OAuthClientInformationFull {
  const meta = JSON.parse(row.metadata_json) as OAuthClientInformationFull;
  return {
    ...meta,
    client_id: row.client_id,
    client_secret: undefined,
    client_id_issued_at: row.client_id_issued_at,
    client_secret_expires_at: row.client_secret_expires_at ?? undefined,
  };
}

export const clientsRepo = {
  count(): number {
    return (getDb().prepare('SELECT COUNT(*) as c FROM oauth_clients').get() as { c: number }).c;
  },

  getRow(client_id: string): ClientRow | undefined {
    return getDb()
      .prepare('SELECT * FROM oauth_clients WHERE client_id = ?')
      .get(client_id) as ClientRow | undefined;
  },

  insert(row: Omit<ClientRow, 'first_authorized_at'>): void {
    getDb()
      .prepare(`
        INSERT INTO oauth_clients
          (client_id, client_secret_hash, client_name, metadata_json,
           client_id_issued_at, client_secret_expires_at, first_authorized_at)
        VALUES
          (@client_id, @client_secret_hash, @client_name, @metadata_json,
           @client_id_issued_at, @client_secret_expires_at, NULL)
      `)
      .run(row);
  },

  markFirstAuthorized(client_id: string, ts: number): void {
    getDb()
      .prepare('UPDATE oauth_clients SET first_authorized_at = ? WHERE client_id = ? AND first_authorized_at IS NULL')
      .run(ts, client_id);
  },

  /**
   * Auto-prune clients that registered but never completed an authorization
   * within the grace period. Counter-measure to DCR spam.
   */
  pruneUnused(graceSec: number): number {
    const cutoff = Math.floor(Date.now() / 1000) - graceSec;
    const result = getDb()
      .prepare(`
        DELETE FROM oauth_clients
        WHERE first_authorized_at IS NULL
          AND client_id_issued_at < ?
      `)
      .run(cutoff);
    return result.changes;
  },
};

export const authCodesRepo = {
  insert(row: AuthCodeRow): void {
    getDb()
      .prepare(`
        INSERT INTO oauth_auth_codes
          (code_hash, client_id, redirect_uri, code_challenge, scopes_json, resource, expires_at, used)
        VALUES
          (@code_hash, @client_id, @redirect_uri, @code_challenge, @scopes_json, @resource, @expires_at, 0)
      `)
      .run(row);
  },

  getByHash(code_hash: string): AuthCodeRow | undefined {
    return getDb()
      .prepare('SELECT * FROM oauth_auth_codes WHERE code_hash = ?')
      .get(code_hash) as AuthCodeRow | undefined;
  },

  markUsed(code_hash: string): void {
    getDb().prepare('UPDATE oauth_auth_codes SET used = 1 WHERE code_hash = ?').run(code_hash);
  },

  /** Delete codes that expired more than 1 hour ago. */
  pruneExpired(): number {
    const cutoff = Math.floor(Date.now() / 1000) - 3600;
    return getDb()
      .prepare('DELETE FROM oauth_auth_codes WHERE expires_at < ?')
      .run(cutoff).changes;
  },
};

export const tokensRepo = {
  insert(row: TokenRow): void {
    getDb()
      .prepare(`
        INSERT INTO oauth_tokens
          (token_hash, refresh_hash, family_id, client_id, scopes_json, resource,
           expires_at, refresh_expires_at, revoked, rotated_at, created_at)
        VALUES
          (@token_hash, @refresh_hash, @family_id, @client_id, @scopes_json, @resource,
           @expires_at, @refresh_expires_at, 0, NULL, @created_at)
      `)
      .run(row);
  },

  getByTokenHash(token_hash: string): TokenRow | undefined {
    return getDb()
      .prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?')
      .get(token_hash) as TokenRow | undefined;
  },

  getByRefreshHash(refresh_hash: string): TokenRow | undefined {
    return getDb()
      .prepare('SELECT * FROM oauth_tokens WHERE refresh_hash = ?')
      .get(refresh_hash) as TokenRow | undefined;
  },

  /** Mark an individual token row revoked (token + refresh on the same row). */
  revoke(token_hash: string): void {
    getDb()
      .prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?')
      .run(token_hash);
  },

  /** Mark a token row as rotated (refresh used and replaced). */
  markRotated(token_hash: string, ts: number): void {
    getDb()
      .prepare('UPDATE oauth_tokens SET rotated_at = ?, revoked = 1, refresh_hash = NULL WHERE token_hash = ?')
      .run(ts, token_hash);
  },

  /** Revoke all tokens in a refresh chain (used on refresh-token-reuse detection). */
  revokeFamily(family_id: string): number {
    return getDb()
      .prepare('UPDATE oauth_tokens SET revoked = 1, refresh_hash = NULL WHERE family_id = ? AND revoked = 0')
      .run(family_id).changes;
  },

  /** Revoke all tokens for a client issued within the last N seconds (auth-code reuse). */
  revokeClientWithin(client_id: string, sinceSec: number): number {
    const since = Math.floor(Date.now() / 1000) - sinceSec;
    return getDb()
      .prepare(`
        UPDATE oauth_tokens
        SET revoked = 1, refresh_hash = NULL
        WHERE client_id = ? AND revoked = 0 AND created_at >= ?
      `)
      .run(client_id, since).changes;
  },
};

export const consentRepo = {
  insert(row: ConsentRow): void {
    getDb()
      .prepare(`
        INSERT INTO oauth_consent_state
          (cid, client_id, params_json, attempts, created_at, expires_at)
        VALUES
          (@cid, @client_id, @params_json, 0, @created_at, @expires_at)
      `)
      .run(row);
  },

  get(cid: string): ConsentRow | undefined {
    return getDb()
      .prepare('SELECT * FROM oauth_consent_state WHERE cid = ?')
      .get(cid) as ConsentRow | undefined;
  },

  incrementAttempts(cid: string): number {
    const result = getDb()
      .prepare('UPDATE oauth_consent_state SET attempts = attempts + 1 WHERE cid = ?')
      .run(cid);
    if (result.changes === 0) return -1;
    const row = consentRepo.get(cid);
    return row?.attempts ?? -1;
  },

  delete(cid: string): void {
    getDb().prepare('DELETE FROM oauth_consent_state WHERE cid = ?').run(cid);
  },

  pruneExpired(): number {
    const now = Math.floor(Date.now() / 1000);
    return getDb()
      .prepare('DELETE FROM oauth_consent_state WHERE expires_at < ?')
      .run(now).changes;
  },
};

/**
 * Boot-time + periodic sweep. Drops:
 * - clients with no successful authorization within 24 h
 * - expired auth codes (older than 1 h past TTL)
 * - expired consent rows
 */
export function pruneOAuthState(): void {
  try {
    const c = clientsRepo.pruneUnused(24 * 3600);
    const a = authCodesRepo.pruneExpired();
    const s = consentRepo.pruneExpired();
    if (c + a + s > 0) {
      log.db.info({ clients: c, codes: a, consent: s }, 'OAuth state pruned');
    }
  } catch (err) {
    log.db.warn({ err }, 'OAuth prune failed');
  }
}
