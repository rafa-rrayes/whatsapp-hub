import type { Response, RequestHandler } from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidClientError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
  InvalidTargetError,
  InvalidClientMetadataError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';

import { config } from '../../config.js';
import { log } from '../../utils/logger.js';
import {
  authCodesRepo,
  clientRowToInfo,
  clientsRepo,
  consentRepo,
  MAX_REGISTERED_CLIENTS,
  tokensRepo,
} from './store.js';
import { randomToken, sha256, signCid, timingSafeEqualStr } from './hash.js';

const ACCESS_TTL_SEC = 24 * 60 * 60; // 24h
const REFRESH_TTL_SEC = 90 * 24 * 60 * 60; // 90d
const AUTH_CODE_TTL_SEC = 10 * 60; // 10 min
const CONSENT_TTL_SEC = 5 * 60; // 5 min
/** Window in which auth-code reuse revokes tokens issued for the same client. */
const AUTH_CODE_REUSE_REVOKE_WINDOW_SEC = 24 * 60 * 60;

/** The resource identifier this MCP server accepts in `resource` parameters. */
function configuredResource(): URL {
  return new URL('/mcp', config.publicBaseUrl);
}

function validateResource(requested: URL | string | undefined, where: string): URL {
  const cfg = configuredResource();
  if (!requested) {
    // RFC 8707: resource is REQUIRED for MCP per 2025-06-18 spec. We accept missing
    // for backwards compatibility but still bind the token to our configured resource.
    return cfg;
  }
  if (!checkResourceAllowed({ requestedResource: requested, configuredResource: cfg })) {
    log.api.warn({ requested: String(requested), configured: cfg.href, where }, 'OAuth resource mismatch');
    throw new InvalidTargetError(
      `resource parameter does not match this MCP server's identifier (${cfg.href})`,
    );
  }
  // Return the canonical (configured) URL so tokens always store the same string.
  return cfg;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/* ─────────────────────────── clients store ─────────────────────────── */

const clientsStoreImpl: OAuthRegisteredClientsStore = {
  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = clientsRepo.getRow(clientId);
    if (!row) return undefined;
    // client_secret intentionally undefined — see preAuthClient middleware below.
    return clientRowToInfo(row);
  },

  registerClient(client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>): OAuthClientInformationFull {
    if (clientsRepo.count() >= MAX_REGISTERED_CLIENTS) {
      throw new InvalidClientMetadataError(
        `Maximum registered clients reached (${MAX_REGISTERED_CLIENTS}). ` +
        'Unused registrations are pruned automatically after 24h.',
      );
    }

    const client_id = randomToken(16);
    const issued = nowSec();
    // Generate a client_secret for confidential clients. Public clients
    // (token_endpoint_auth_method=none) get no secret.
    const isPublic = client.token_endpoint_auth_method === 'none';
    const plainSecret = isPublic ? undefined : randomToken(32);
    const secretHash = plainSecret ? sha256(plainSecret) : null;

    const fullInfo: OAuthClientInformationFull = {
      ...client,
      client_id,
      client_secret: plainSecret,
      client_id_issued_at: issued,
      client_secret_expires_at: 0, // 0 = never expires per RFC 7591
    };

    clientsRepo.insert({
      client_id,
      client_secret_hash: secretHash,
      client_name: client.client_name ?? null,
      // Strip the plaintext secret from stored metadata — we only ever return it once.
      metadata_json: JSON.stringify({ ...fullInfo, client_secret: undefined }),
      client_id_issued_at: issued,
      client_secret_expires_at: null,
    });

    log.api.info({ client_id, client_name: client.client_name }, 'OAuth client registered (DCR)');
    return fullInfo;
  },
};

/* ───────────────── pre-auth middleware for /token & /revoke ───────────────── */

/**
 * Authenticates the client BEFORE the SDK's handlers run. The SDK's built-in
 * comparator does plaintext compare; we don't store plaintext secrets, so we
 * verify the hash here. On success we let the SDK's `getClient()` return
 * `client_secret: undefined` and the SDK's secret check is a no-op.
 *
 * Mount this with the urlencoded body parser BEFORE mcpAuthRouter for paths
 * `/token` and `/revoke`.
 */
export const preAuthClient: RequestHandler = (req, res, next) => {
  // Don't authenticate for non-POSTs; SDK will reject those at its own layer.
  if (req.method !== 'POST') return next();

  const body = req.body as Record<string, unknown> | undefined;
  const client_id = typeof body?.client_id === 'string' ? body.client_id : undefined;
  const client_secret = typeof body?.client_secret === 'string' ? body.client_secret : undefined;

  if (!client_id) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
  }

  const row = clientsRepo.getRow(client_id);
  if (!row) {
    return res.status(401).json({ error: 'invalid_client', error_description: 'Unknown client' });
  }

  if (row.client_secret_hash) {
    if (!client_secret) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'client_secret is required' });
    }
    if (!timingSafeEqualStr(sha256(client_secret), row.client_secret_hash)) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client_secret' });
    }
    if (row.client_secret_expires_at && row.client_secret_expires_at < nowSec()) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Client secret has expired' });
    }
  }
  next();
};

/* ───────────────────────────── provider ───────────────────────────── */

class WhatsAppHubOAuthProvider implements OAuthServerProvider {
  get clientsStore(): OAuthRegisteredClientsStore {
    return clientsStoreImpl;
  }

  /** Generate a consent_id, persist the auth params, redirect to the consent page. */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Validate redirect_uri belongs to this client (SDK does this before calling us,
    // but defence in depth).
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError('redirect_uri not registered for this client');
    }
    // Validate resource indicator.
    validateResource(params.resource, 'authorize');

    const cid = randomToken(24);
    const created = nowSec();
    consentRepo.insert({
      cid,
      client_id: client.client_id,
      params_json: JSON.stringify({
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        scopes: params.scopes,
        resource: params.resource?.href,
      }),
      attempts: 0,
      created_at: created,
      expires_at: created + CONSENT_TTL_SEC,
    });

    const signed = signCid(cid);
    res.redirect(303, `/oauth/consent?cid=${encodeURIComponent(signed)}`);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const row = authCodesRepo.getByHash(sha256(authorizationCode));
    if (!row) throw new InvalidGrantError('Invalid authorization code');
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const codeHash = sha256(authorizationCode);
    const row = authCodesRepo.getByHash(codeHash);
    if (!row) throw new InvalidGrantError('Invalid authorization code');
    if (row.client_id !== client.client_id) {
      // Code was issued to a different client.
      throw new InvalidGrantError('Authorization code does not match client');
    }
    if (row.expires_at < nowSec()) {
      throw new InvalidGrantError('Authorization code has expired');
    }
    if (row.used) {
      // Reuse signals compromise. RFC 6749 §10.5 / RFC 9700.
      const killed = tokensRepo.revokeClientWithin(client.client_id, AUTH_CODE_REUSE_REVOKE_WINDOW_SEC);
      log.api.warn({ client_id: client.client_id, killed }, 'OAuth auth-code reuse detected; revoked recent tokens');
      throw new InvalidGrantError('Authorization code already used');
    }
    if (redirectUri && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError('redirect_uri mismatch');
    }
    const canonResource = validateResource(resource ?? row.resource ?? undefined, 'exchange');

    // Mark used. If this throws below, we still want the code marked.
    authCodesRepo.markUsed(codeHash);

    const access = randomToken(32);
    const refresh = randomToken(32);
    const created = nowSec();
    tokensRepo.insert({
      token_hash: sha256(access),
      refresh_hash: sha256(refresh),
      family_id: randomToken(16),
      client_id: client.client_id,
      scopes_json: row.scopes_json,
      resource: canonResource.href,
      expires_at: created + ACCESS_TTL_SEC,
      refresh_expires_at: created + REFRESH_TTL_SEC,
      revoked: 0,
      rotated_at: null,
      created_at: created,
    });

    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: ACCESS_TTL_SEC,
      refresh_token: refresh,
      scope: row.scopes_json ? (JSON.parse(row.scopes_json) as string[]).join(' ') : undefined,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const refreshHash = sha256(refreshToken);
    const row = tokensRepo.getByRefreshHash(refreshHash);
    if (!row) {
      // Either never existed or was already rotated (we null refresh_hash on rotation).
      // Treat as compromise — best we can do without storing the chain — but only if
      // we can identify the offending family later. For now: reject.
      throw new InvalidGrantError('Invalid refresh token');
    }
    if (row.client_id !== client.client_id) {
      throw new InvalidGrantError('Refresh token does not match client');
    }
    if (row.revoked) {
      // Reuse of a revoked refresh token → revoke whole family (defence in depth).
      tokensRepo.revokeFamily(row.family_id);
      log.api.warn({ family_id: row.family_id }, 'Refresh token reuse on revoked row; family killed');
      throw new InvalidGrantError('Refresh token revoked');
    }
    if (row.rotated_at !== null) {
      tokensRepo.revokeFamily(row.family_id);
      log.api.warn({ family_id: row.family_id }, 'Refresh token reuse after rotation; family killed');
      throw new InvalidGrantError('Refresh token has been rotated');
    }
    if (row.refresh_expires_at && row.refresh_expires_at < nowSec()) {
      throw new InvalidGrantError('Refresh token expired');
    }
    const canonResource = validateResource(resource ?? row.resource, 'refresh');

    const now = nowSec();
    tokensRepo.markRotated(row.token_hash, now);

    const access = randomToken(32);
    const refresh = randomToken(32);
    tokensRepo.insert({
      token_hash: sha256(access),
      refresh_hash: sha256(refresh),
      family_id: row.family_id,
      client_id: row.client_id,
      scopes_json: row.scopes_json,
      resource: canonResource.href,
      expires_at: now + ACCESS_TTL_SEC,
      refresh_expires_at: now + REFRESH_TTL_SEC,
      revoked: 0,
      rotated_at: null,
      created_at: now,
    });

    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: ACCESS_TTL_SEC,
      refresh_token: refresh,
      scope: row.scopes_json ? (JSON.parse(row.scopes_json) as string[]).join(' ') : undefined,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = tokensRepo.getByTokenHash(sha256(token));
    if (!row) throw new InvalidTokenError('Invalid token');
    if (row.revoked) throw new InvalidTokenError('Token revoked');
    if (row.expires_at && row.expires_at < nowSec()) {
      throw new InvalidTokenError('Token expired');
    }
    // RFC 8707 defence in depth: ensure the token is bound to this RS.
    const canon = configuredResource();
    if (!checkResourceAllowed({ requestedResource: row.resource, configuredResource: canon })) {
      throw new InvalidTokenError('Token bound to a different resource');
    }
    const scopes = row.scopes_json ? (JSON.parse(row.scopes_json) as string[]) : [];
    return {
      token,
      clientId: row.client_id,
      scopes,
      expiresAt: row.expires_at ?? undefined,
      resource: new URL(row.resource),
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    // Try token_hash first, then refresh_hash.
    const hash = sha256(request.token);
    const byAccess = tokensRepo.getByTokenHash(hash);
    if (byAccess) {
      if (byAccess.client_id !== client.client_id) throw new InvalidClientError('Token belongs to another client');
      tokensRepo.revoke(byAccess.token_hash);
      return;
    }
    const byRefresh = tokensRepo.getByRefreshHash(hash);
    if (byRefresh) {
      if (byRefresh.client_id !== client.client_id) throw new InvalidClientError('Token belongs to another client');
      tokensRepo.revoke(byRefresh.token_hash);
      return;
    }
    // RFC 7009: revocation of an invalid token is not an error.
  }
}

export const provider = new WhatsAppHubOAuthProvider();

/* ───────────────────────────── auth-code minting (used by consent) ───────────────────────────── */

/**
 * Called by the consent POST handler after the user proves they know the
 * password. Mints a fresh auth code bound to the params previously stashed
 * in oauth_consent_state.
 */
export function mintAuthCodeForConsent(
  cid: string,
  client_id: string,
  params: {
    redirectUri: string;
    codeChallenge: string;
    state?: string;
    scopes?: string[];
    resource?: string;
  },
): string {
  const code = randomToken(32);
  const created = nowSec();
  authCodesRepo.insert({
    code_hash: sha256(code),
    client_id,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    scopes_json: params.scopes ? JSON.stringify(params.scopes) : null,
    resource: params.resource ?? null,
    expires_at: created + AUTH_CODE_TTL_SEC,
    used: 0,
  });
  clientsRepo.markFirstAuthorized(client_id, created);
  consentRepo.delete(cid);
  return code;
}
