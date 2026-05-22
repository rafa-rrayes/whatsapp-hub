# MCP OAuth 2.1 — Implementation Plan (v2)

## Goal

Make the `/mcp` endpoint compatible with claude.ai's custom-connector flow (which only accepts OAuth 2.1). Keep `x-api-key` working for Claude Code CLI so nothing breaks.

> **v2 changelog (post-review):** Added fixes for HTTPS issuer enforcement, `WWW-Authenticate` header, token hashing at rest, CSRF/rate-limit on consent, refresh-token family detection, RFC 8707 resource validation, DCR cap, and a handful of smaller corrections. See section "Issues addressed in v2" at the bottom.

## Threat model

- **What we authorize:** a remote MCP client (claude.ai, Cursor, etc.) gaining persistent access to your WhatsApp data.
- **Who can authorize:** only someone who knows `MCP_OAUTH_PASSWORD`. Consent gates this. Random visitors hitting `/authorize` see a password prompt; without the password, no auth code is issued.
- **`MCP_OAUTH_PASSWORD` MUST be set separately from `API_KEY`.** Boot fails (or logs a loud security warning matching the existing `printSecurityWarnings()` pattern) if it's missing or equal to `API_KEY`. Shoulder-surfing the consent screen must not leak the REST API key.
- **Dynamic Client Registration is open** (claude.ai requires it) but server-side capped: max 100 registered clients in `oauth_clients`; clients with no successful authorization within 24 h are auto-pruned by a periodic sweep. New registrations beyond the cap return `400 invalid_client_metadata`.
- **Tokens & client secrets are hashed (SHA-256) at rest.** Lookup is by hash. Plaintext is never persisted. `client_secret` either hashed (forces us to wrap SDK client-auth comparison) — OR — encrypted at rest using the same envelope as webhook secrets when `SECURITY_ENCRYPT_WEBHOOK_SECRETS=true`. **Decision: hash both.** We override the SDK's client auth middleware to compare against the hash.
- **PKCE S256 enforced** by SDK. Auth codes single-use, 10 min TTL.
- **Refresh tokens are rotated on every use** and grouped by `family_id`. Re-use of a rotated token revokes the whole family.
- **RFC 8707 resource validation:** every `/authorize` and `/token` request whose `resource` parameter doesn't match `${publicBaseUrl}/mcp` is rejected. Stored on auth codes and tokens, re-checked at verify time.

What this does NOT defend against:
- Someone with `MCP_OAUTH_PASSWORD` → they can authorize their own claude.ai (same threat model as anyone holding the REST API key).
- Anthropic's claude.ai infrastructure being compromised → bearer token leak. Mitigation: hashed at rest, revoke from dashboard later, rotate password.

## SDK pieces we'll use

- `mcpAuthRouter` from `@modelcontextprotocol/sdk/server/auth/router.js` — mounts `/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`.
- `requireBearerAuth` from `@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js` — validates `Authorization: Bearer ...`. **Must be passed `resourceMetadataUrl`** so 401s emit the spec-mandated `WWW-Authenticate: Bearer realm="mcp", resource_metadata="..."`.
- `checkResourceAllowed` from `@modelcontextprotocol/sdk/shared/auth-utils.js` — used to validate `resource` parameter (RFC 8707).
- `OAuthServerProvider` interface — we implement: `clientsStore`, `authorize`, `challengeForAuthorizationCode`, `exchangeAuthorizationCode`, `exchangeRefreshToken`, `verifyAccessToken`, `revokeToken`.
- **Action item before coding `provider.ts`:** open `node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/provider.d.ts` to confirm the exact method shapes — the interface changes between SDK versions.

## Files to create

| Path | Purpose |
|------|---------|
| `src/database/migrations/004-oauth.ts` | Schema: `oauth_clients`, `oauth_auth_codes`, `oauth_tokens`, `oauth_consent_state` |
| `src/mcp/oauth/store.ts` | Thin repo over the tables: `clientsStore`, `authCodesStore`, `tokensStore`, `consentStore` |
| `src/mcp/oauth/provider.ts` | `OAuthServerProvider` impl — glues SDK to our store, runs resource-indicator validation |
| `src/mcp/oauth/consent.ts` | Express router: `GET /oauth/consent` form + `POST /oauth/consent` validates password, rate-limited |
| `src/mcp/oauth/hash.ts` | Tiny helpers: `sha256(token)`, `randomToken(bytes=32)`, `hmacSign(cid)`, `hmacVerify(cid, sig)` |

## Files to modify

| Path | Change |
|------|--------|
| `src/database/migrations/index.ts` | Register migration 004 |
| `src/config.ts` | Add `mcpOauthPassword`, `publicBaseUrl`, `allowInsecureIssuerUrl`. Validate HTTPS at boot. |
| `src/utils/security-warnings.ts` | Warn when `MCP_OAUTH_PASSWORD` is unset/equals `API_KEY`/equals webhook secret. |
| `src/mcp/index.ts` | Combined auth (x-api-key strict OR bearer) on `/mcp`. Mount consent router. Body parser BEFORE auth. |
| `src/api/server.ts` | Mount `mcpAuthRouter` at app root, BEFORE rate limiters and BEFORE the global `/api` auth. Pass `resourceServerUrl`. |
| `.env.example` | Document `MCP_OAUTH_PASSWORD`, `PUBLIC_BASE_URL`, HTTPS requirement, and the `Authorization: Bearer <API_KEY>` → `x-api-key` migration. |

## Database schema (migration 004)

```sql
CREATE TABLE oauth_clients (
  client_id              TEXT PRIMARY KEY,
  client_secret_hash     TEXT,              -- SHA-256(secret). NULL for public clients.
  client_name            TEXT,
  metadata_json          TEXT NOT NULL,     -- full OAuthClientInformationFull round-trip
  client_id_issued_at    INTEGER NOT NULL,
  client_secret_expires_at INTEGER,
  first_authorized_at    INTEGER             -- NULL until first successful authorize; used for the 24h pruning sweep
);
-- Decision: store only the round-trip JSON + the columns we actually filter on (PK,
-- name for display, issued_at/expires_at for SDK contract, secret_hash for auth,
-- first_authorized_at for pruning). No redundancy.

CREATE TABLE oauth_auth_codes (
  code_hash       TEXT PRIMARY KEY,         -- SHA-256(code). We never store plaintext.
  client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,            -- PKCE; method is S256 only (SDK constraint)
  scopes_json     TEXT,                     -- JSON array
  resource        TEXT,                     -- RFC 8707 — already validated == publicBaseUrl/mcp before insert
  expires_at      INTEGER NOT NULL,         -- unix seconds, 10 min TTL
  used            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE oauth_tokens (
  token_hash      TEXT PRIMARY KEY,         -- SHA-256(access_token)
  refresh_hash    TEXT UNIQUE,              -- SHA-256(refresh_token), NULL once rotated
  family_id       TEXT NOT NULL,            -- shared across the rotation chain
  client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scopes_json     TEXT,                     -- JSON array
  resource        TEXT NOT NULL,            -- RFC 8707, must match publicBaseUrl/mcp
  expires_at      INTEGER,                  -- unix seconds; NULL for refresh tokens (refresh lifetime tracked separately)
  refresh_expires_at INTEGER,
  revoked         INTEGER NOT NULL DEFAULT 0,
  rotated_at      INTEGER,                  -- when this refresh token was rotated (replaced by a new one); attempting to reuse it must revoke the family
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_oauth_tokens_refresh ON oauth_tokens(refresh_hash);
CREATE INDEX idx_oauth_tokens_client  ON oauth_tokens(client_id, revoked);
CREATE INDEX idx_oauth_tokens_family  ON oauth_tokens(family_id);

CREATE TABLE oauth_consent_state (
  cid         TEXT PRIMARY KEY,             -- random opaque id; HMAC-signed value carried to browser as cid.sig
  client_id   TEXT NOT NULL,
  params_json TEXT NOT NULL,                -- AuthorizationParams (redirect_uri, code_challenge, state, scopes, resource)
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL              -- 5 min TTL
);
-- Persisting consent state in SQLite (instead of an in-memory map) survives restarts
-- and keeps a single source of truth. The browser cookie/query carries cid+HMAC sig,
-- so neither cid nor the row alone is sufficient to forge a consent submission.
```

## Configuration

```ts
// src/config.ts
mcpOauthPassword:        process.env.MCP_OAUTH_PASSWORD,        // REQUIRED. No silent fallback to API_KEY.
publicBaseUrl:           process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
allowInsecureIssuerUrl:  process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL === '1',
```

Boot-time validation (added to the existing `configErrors` collection):

```ts
const issuer = new URL(config.publicBaseUrl);
const isLoopback = issuer.hostname === 'localhost' || issuer.hostname === '127.0.0.1';
if (issuer.protocol !== 'https:' && !isLoopback && !config.allowInsecureIssuerUrl) {
  configErrors.push(
    'PUBLIC_BASE_URL must be HTTPS (or set MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL=1 for trusted private networks). ' +
    'OAuth 2.1 requires HTTPS for the issuer URL.'
  );
}
if (!config.mcpOauthPassword) {
  configErrors.push('MCP_OAUTH_PASSWORD is required when /mcp is exposed. Generate a strong, separate password.');
}
if (config.mcpOauthPassword && config.mcpOauthPassword === config.apiKey) {
  configErrors.push('MCP_OAUTH_PASSWORD must be different from API_KEY (avoids one leak compromising both).');
}
```

`publicBaseUrl` is the OAuth `issuer`. For the deployed instance, set `PUBLIC_BASE_URL=https://zapzaphub.rrayes.com.br` in Dokploy env.

## Mount points & ordering (`src/api/server.ts`)

Ordering matters. The new layout, top-to-bottom:

```ts
app.use(helmet({ /* keep existing CSP; consent page uses inline <style> which 'unsafe-inline' already permits in styleSrc */ }));

// 1. mcpAuthRouter FIRST — owns its own CORS + Cache-Control, must not be wrapped by ours
app.use(mcpAuthRouter({
  provider,
  issuerUrl: new URL(config.publicBaseUrl),
  baseUrl: new URL(config.publicBaseUrl),
  resourceServerUrl: new URL(`${config.publicBaseUrl}/mcp`),  // ensures /.well-known/oauth-protected-resource/mcp
  serviceDocumentationUrl: new URL('https://github.com/...'),
  scopesSupported: ['mcp'],
  allowInsecureIssuerUrl: config.allowInsecureIssuerUrl,
}));

// 2. Consent router (our HTML form) — mounted under /oauth/, NOT under the SDK's root paths
app.use('/oauth', consentRouter);

// 3. Existing CORS + rate limiters + sec-fetch + /api routes
app.use(corsMiddleware);
app.use(globalLimiter);
// ...

// 4. /mcp (own body parser, own auth middleware) — mounted by registerMcp(app, ...)
```

Why this order:
- The SDK token/register handlers set `Cache-Control: no-store` and their own CORS. Mounting them before our CORS layer prevents duplicate `Access-Control-Allow-Origin` headers.
- The 20/hour `/register` rate limit lives inside `mcpAuthRouter`; our global limiter shouldn't double-count.
- Sec-Fetch middleware is scoped to `/api` only — it won't fire on `/authorize`, `/token`, `/oauth/consent`. The consent POST gets its own per-IP rate limit (see "Consent page").

Smoke check post-mount: `curl -si $BASE/.well-known/oauth-authorization-server` should show `code_challenge_methods_supported: ["S256"]`. If the SDK doesn't populate this by default, set it explicitly in the router options.

## Combined auth middleware on `/mcp`

Strict: `x-api-key` present → it must be valid. No silent fallthrough to bearer.

```ts
const bearer = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: `${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp`,
  // The SDK emits the spec-mandated WWW-Authenticate header on 401 only when this is set.
});

export const mcpAuth: RequestHandler = (req, res, next) => {
  const apiKey = req.header('x-api-key');
  if (apiKey !== undefined) {
    // CLI path: present-but-wrong → 401, do NOT fall through to bearer.
    if (timingSafeEqual(apiKey, config.apiKey)) return next();
    return res.status(401).json({
      error: 'invalid_api_key',
      hint: 'For CLI, use header `x-api-key: <key>`. For claude.ai-style connectors, omit x-api-key and use OAuth.',
    });
  }
  // claude.ai path: Authorization: Bearer <oauth_token>
  return bearer(req, res, next);
};
```

`Authorization: Bearer <API_KEY>` is DROPPED on `/mcp`. That header slot belongs to OAuth tokens now. The REST API at `/api` is unchanged — it keeps the existing auth middleware (`x-api-key` OR `Authorization: Bearer <API_KEY>` OR `?api_key=...`). This is a breaking change for any CLI user that was using the `Authorization: Bearer` form on `/mcp`; the migration note in `.env.example` and the 401 hint above cover it.

Rate-limiter key after this lands:

```ts
keyGenerator: (req) => req.auth?.clientId ?? (req.headers['x-api-key'] as string) ?? req.ip ?? 'unknown',
```

So per-OAuth-client buckets exist instead of all OAuth traffic sharing one IP bucket.

## End-to-end flow (claude.ai)

1. **User adds connector** with URL `https://zapzaphub.rrayes.com.br/mcp`.
2. **claude.ai hits `/mcp`** with no auth → server returns **`401`** with `WWW-Authenticate: Bearer realm="mcp", resource_metadata="https://zapzaphub.rrayes.com.br/.well-known/oauth-protected-resource/mcp"`.
3. **claude.ai discovers** auth metadata: `GET /.well-known/oauth-protected-resource/mcp` → tells it the AS is the same host. Then `GET /.well-known/oauth-authorization-server` → returns endpoint URLs and `code_challenge_methods_supported: ["S256"]`.
4. **claude.ai registers** via DCR: `POST /register` with `redirect_uris` (one of `https://claude.ai/api/mcp/auth_callback` or `https://claude.com/api/mcp/auth_callback`), `client_name`, etc. SDK calls our `clientsStore.registerClient()`. We generate `client_id`, hash a fresh `client_secret`, persist, return the full client info with the plaintext secret in the response (one shot — never readable again).
5. **claude.ai opens browser** to `/authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256&state=...&scope=...&resource=https://zapzaphub.rrayes.com.br/mcp`.
6. **SDK validates** PKCE params, then calls our `provider.authorize(client, params, res)`.
7. **Our `authorize`** first validates `params.resource` via `checkResourceAllowed(params.resource, '${publicBaseUrl}/mcp')`. If mismatched → throw `InvalidRequest`. Otherwise: generate `cid` (32 bytes), HMAC-sign as `cid.sig` using a server-side secret derived from `API_KEY`, persist `{client_id, params}` to `oauth_consent_state` with 5 min TTL, redirect (303) to `/oauth/consent?cid=<cid>.<sig>`.
8. **User sees consent page**: shows `client_name`, **the FULL `redirect_uri`** (not just the domain — so the user can verify the destination), and a password field. Inline CSS, no JS. Marks up the redirect URI as a `<code>` block so it can't be confused with surrounding text.
9. **User submits password** → `POST /oauth/consent` with `cid` + password. Rate-limited to 10/min per IP via `express-rate-limit`. HMAC sig on `cid` is verified before any DB read.
10. **Server validates** password against `config.mcpOauthPassword` using `timingSafeEqual`. If wrong → re-render form with error, leave the consent row alive (still 5 min TTL).
11. **On valid password**: generate auth code (32 bytes), hash it, persist `oauth_auth_codes` row with `client_id`, `redirect_uri`, `code_challenge`, `scopes_json`, `resource` (re-validated), 10-min TTL. Delete the `oauth_consent_state` row. Update `oauth_clients.first_authorized_at` if NULL. Redirect (303) the browser to `params.redirect_uri?code=<plaintext-code>&state=<state>` — using the redirect URI from the *server-side* params, not from the form.
12. **Cancel** button posts `cid` + `cancel=1` → server reads `params.redirect_uri` from the stored consent row and 303s to `redirect_uri?error=access_denied&state=...`.
13. **claude.ai callback** receives the code; POSTs `/token` with `grant_type=authorization_code`, `code=...`, `code_verifier=...`, `redirect_uri=...`, `client_id=...`, `client_secret=...`.
14. **SDK token handler** validates client auth (we override the comparator to use the secret hash), validates PKCE via our `challengeForAuthorizationCode()`, then calls our `exchangeAuthorizationCode()`.
15. **Our `exchangeAuthorizationCode`** does:
    - Look up `oauth_auth_codes` by `sha256(code)`. If missing → reject.
    - If `used = 1` → mark all tokens in any family ever issued from this `client_id` (within a short window) as revoked, then reject. (Spec: auth-code reuse signals compromise; revoke aggressively for the offending client.)
    - If `expires_at < now` → reject.
    - Re-validate `resource` against `${publicBaseUrl}/mcp`.
    - Mark `used = 1`. Generate access token (24 h) + refresh token (90 d), hash both, create a new `family_id` (UUID), persist.
    - Return `{ access_token, token_type: 'bearer', expires_in: 86400, refresh_token, scope }`.
16. **claude.ai** uses `Authorization: Bearer <access_token>` for `/mcp`.
17. **Verify path** (`provider.verifyAccessToken(token)`):
    - Look up by `sha256(token)`. If missing or `revoked=1` or `expires_at < now` → throw.
    - Validate `row.resource === ${publicBaseUrl}/mcp`.
    - Return `AuthInfo { token, clientId, scopes, expiresAt, resource }`.
18. **Refresh flow** (`exchangeRefreshToken`):
    - Look up by `sha256(refresh_token)`. If missing → reject.
    - If `revoked=1` → revoke entire `family_id` (reuse of rotated token = compromise), reject.
    - If `rotated_at IS NOT NULL` → same: revoke family, reject.
    - Re-validate `resource`.
    - Mint new access + refresh, same `family_id`. On the old row: set `rotated_at = now`, `revoked = 1`, clear `refresh_hash`. Insert new row.
19. **Revocation** (`POST /revoke` → `revokeToken`):
    - Hash the presented token, find by `token_hash` or `refresh_hash`, mark `revoked=1`.

## Consent page

Minimal vanilla HTML, no JS, inline CSS (helmet's existing CSP allows `'unsafe-inline'` on `styleSrc`). Renders:

- Header: "Authorize new MCP client"
- App name from `oauth_clients.client_name` (escaped)
- `<dl>` row "Will redirect to:" with the **full registered redirect URI** in a `<code>` block (escaped). This is the only honest CSRF/phishing defence — let the human verify the URL.
- `<dl>` row "Scopes:" (escaped, comma-separated)
- Password field (`<input type="password" autocomplete="off" name="password">`)
- Hidden `cid` (`<input type="hidden" name="cid" value="...">`)
- "Allow" submit button (POST `/oauth/consent`)
- "Cancel" submit button (POST `/oauth/consent`, name="cancel", value="1")
- On wrong password: same form with `<p class="err">` rendered above the password field

Server-side rate limit: 10 POST/min per IP. After 5 wrong passwords on the same `cid`, the consent row is deleted (user has to restart the flow). No retry message that distinguishes "wrong password" from "expired cid" to outsiders (both → "Could not authorize, try again from your client").

## Edge cases handled

- **Wrong password** → re-render form, error shown, consent row preserved (TTL still counting).
- **5 wrong passwords on same cid** → delete row, generic error.
- **Expired consent_id (5 min)** → row purged by lookup-time check; show "session expired, retry from your client".
- **Expired auth code (10 min)** → `exchangeAuthorizationCode` rejects.
- **Reused auth code** → all tokens for that `client_id` issued in the last 24 h revoked; reject the exchange.
- **Mismatched `redirect_uri` at token exchange** → SDK rejects (it compares `params.redirect_uri` to the value bound to the code).
- **PKCE mismatch** → SDK rejects before our handler runs.
- **Refresh token reused after rotation** → revoke whole `family_id`; reject.
- **Resource mismatch** → reject at authorize, exchange, and verify time (defence in depth).
- **`x-api-key` present but wrong** → 401 immediately, no bearer fallback.
- **`/register` flood** → reject when `oauth_clients` count > 100 with `invalid_client_metadata`. Pruning sweep on boot + every 6 h deletes any client with `first_authorized_at IS NULL AND client_id_issued_at < now - 24h`.

## Smoke test plan

```bash
BASE=http://localhost:3100   # or https://zapzaphub.rrayes.com.br in prod
PASS=$MCP_OAUTH_PASSWORD

# 0. Unauthenticated /mcp must 401 with correct WWW-Authenticate
curl -si $BASE/mcp -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | head -20
# → HTTP/1.1 401
# → WWW-Authenticate: Bearer realm="mcp", resource_metadata="$BASE/.well-known/oauth-protected-resource/mcp"

# 1. Discovery
curl -s $BASE/.well-known/oauth-authorization-server | jq .
# → expect issuer, authorization_endpoint, token_endpoint, registration_endpoint, code_challenge_methods_supported: ["S256"]

curl -s $BASE/.well-known/oauth-protected-resource/mcp | jq .
# → expect resource, authorization_servers

# 2. DCR
REG=$(curl -s -X POST $BASE/register \
  -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["http://localhost:9999/callback"],"client_name":"smoke-client","token_endpoint_auth_method":"client_secret_post"}')
echo "$REG" | jq .
CLIENT_ID=$(echo "$REG" | jq -r .client_id)
CLIENT_SECRET=$(echo "$REG" | jq -r .client_secret)

# 3. /authorize → expect 303 to /oauth/consent?cid=...
#    (Pre-compute PKCE challenge:)
VERIFIER=$(openssl rand -base64 64 | tr -d '=+/' | head -c 64)
CHALLENGE=$(printf "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr -d '=+/' | tr '/+' '_-')
curl -si "$BASE/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=http://localhost:9999/callback&code_challenge=$CHALLENGE&code_challenge_method=S256&state=xyz&resource=$BASE/mcp"
# Extract CID from Location header

# 3a. /authorize with wrong resource → 400
curl -si "$BASE/authorize?...&resource=https://evil.example/mcp"
# → 400 invalid_request

# 4. Consent POST (correct password)
CID=<from step 3>
curl -si -X POST $BASE/oauth/consent \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "cid=$CID&password=$PASS"
# → 303 to http://localhost:9999/callback?code=...&state=xyz

# 4a. Consent POST (wrong password) — re-renders form
curl -si -X POST $BASE/oauth/consent -d "cid=$CID&password=wrong"
# → 200 HTML with error

# 5. Token exchange
CODE=<from step 4>
TOK=$(curl -s -X POST $BASE/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=authorization_code&code=$CODE&redirect_uri=http://localhost:9999/callback&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&code_verifier=$VERIFIER&resource=$BASE/mcp")
echo "$TOK" | jq .
ACCESS=$(echo "$TOK" | jq -r .access_token)
REFRESH=$(echo "$TOK" | jq -r .refresh_token)

# 5a. Reuse the same code → must fail AND revoke any token already issued
curl -si -X POST $BASE/token -d "grant_type=authorization_code&code=$CODE&..."
# → 400 invalid_grant. ACCESS token from step 5 should now also be rejected on /mcp.

# 6. /mcp with bearer
curl -s -X POST $BASE/mcp \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
# → 13

# 7. /mcp with x-api-key still works (CLI path)
curl -s -X POST $BASE/mcp \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '.result.tools | length'
# → 13

# 7a. /mcp with wrong x-api-key → 401, no bearer fallback
curl -si -X POST $BASE/mcp -H "x-api-key: wrong" -d '...' | head -3
# → 401 invalid_api_key

# 8. Refresh rotation
TOK2=$(curl -s -X POST $BASE/token \
  -d "grant_type=refresh_token&refresh_token=$REFRESH&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET")
echo "$TOK2" | jq .
NEW_REFRESH=$(echo "$TOK2" | jq -r .refresh_token)

# 8a. Reuse the OLD refresh → family revoked
curl -si -X POST $BASE/token -d "grant_type=refresh_token&refresh_token=$REFRESH&..."
# → 400 invalid_grant
curl -si -X POST $BASE/mcp -H "Authorization: Bearer $ACCESS" ...
# → 401 (the previously-rotated chain is killed)

# 9. Revocation
curl -si -X POST $BASE/revoke -d "token=$NEW_REFRESH&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET"
# → 200; subsequent calls 401
```

## Out of scope (later if needed)

- Dashboard UI for revoking tokens / listing connected clients.
- Per-scope authorization (we accept whatever scope claude.ai sends; could refine to `read` / `write` / `send`).
- Audit log of which tools each client called.
- DPoP / mTLS sender-constrained tokens.
- Allowlist of redirect URI hosts (currently any host the user trusts on the consent screen is allowed).

> **Removed from "out of scope":**
> - Refresh token rotation enforcement — **now implemented from day one** (OAuth 2.1 mandates it for public clients).
> - CSRF protection on consent — **now in scope** (HMAC-signed `cid`).

## Issues addressed in v2 (from the two reviews)

| # | Issue | Fix |
|---|-------|-----|
| Review 1 #2 | SDK throws on non-HTTPS issuer | Boot-time validation, `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL` escape hatch, surfaced via `configErrors` |
| Review 1 #3 | Open DCR can be spammed | 100-client cap; auto-prune unused regs after 24 h |
| Review 1 #4 | Auth code reuse scope + missing index | Restricted to 24 h of the offending client's tokens; added `(client_id, revoked)` index |
| Review 1 #5 | Refresh rotation without chain tracking | Added `family_id`, `rotated_at`; reuse revokes family |
| Review 1 #6 | No CSRF/rate limit on consent | 10/min per-IP rate limit; HMAC-signed `cid`; max 5 wrong passwords per cid; persisted state in DB |
| Review 1 #7 | Open redirect via attacker-registered client | Consent page now shows the FULL `redirect_uri`, not just domain |
| Review 1 #8 | `MCP_OAUTH_PASSWORD` defaulting to `API_KEY` | No fallback. Boot fails if unset; warns if equal to `API_KEY` |
| Review 1 #9 | Plaintext tokens & secrets at rest | SHA-256 hashes; override SDK client-auth comparator to use hash |
| Review 1 #10 | Encryption interaction unverified | Hashes don't need encryption; migration is plain DDL, works on encrypted DB |
| Review 1 #11 | Rate-limiter key doesn't know OAuth client | `keyGenerator` now reads `req.auth?.clientId` first |
| Review 1 #12 | Body parser / auth ordering | Documented: body parser before auth middleware in `/mcp` mount |
| Review 1 #13 | Wrong API key falls through to bearer | Strict path: present-but-wrong → 401, no fallback |
| Review 1 nit | Schema column redundancy | Kept `metadata_json` + only the columns we filter on |
| Review 1 nit | `code_challenge_method` not stored | Documented as S256-only via SDK constraint; comment in migration |
| Review 1 nit | scope JSON parsing | `store.ts` parses on read |
| Review 1 nit | Cancel button redirect | Reads `redirect_uri` from server-side stored params, not form |
| Review 1 nit | `.env.example` updates | Added explicitly to "Files to modify" |
| Review 1 nit | `error-server.ts` wiring | Wired through `configErrors` |
| Review 2 #1 | claude.com vs claude.ai redirect URI | Consent page reads from client; never hardcode |
| Review 2 #2 | Missing `WWW-Authenticate` on 401 | `requireBearerAuth({ resourceMetadataUrl })` set |
| Review 2 #3 | Well-known protected-resource path | Pass `resourceServerUrl: new URL('${publicBaseUrl}/mcp')` |
| Review 2 #4 | RFC 8707 resource validation | `checkResourceAllowed` at authorize, exchange, and verify |
| Review 2 #5 | `mcpAuthRouter` root-mount constraint | Documented; no path collisions verified |
| Review 2 #6 | Consent state restart fragility | Persisted in `oauth_consent_state` table |
| Review 2 #7 | Refresh rotation in "out of scope" | Moved to in-scope, mandatory |
| Review 2 #9 | Bearer drop on /mcp is breaking | `.env.example` migration note + 401 body hint |
| Review 2 #10 | PKCE method advertised in metadata | Smoke test verifies `code_challenge_methods_supported: ["S256"]` |
| Review 2 #11 | SDK interface drift | New step: open provider.d.ts before coding `provider.ts` |
| Review 2 #12 | Smoke test missing 401 baseline | Step 0 added |

## Sequence

1. **Migration 004** (`src/database/migrations/004-oauth.ts`) — schema above, plus pragma-safe DDL (no FK on/off toggle needed).
2. **`oauth/hash.ts`** — sha256, randomToken, HMAC sign/verify (key = `sha256('mcp-oauth-cid|' + config.apiKey)` — single-process, regenerated per boot is fine since consent rows have 5 min TTL).
3. **`oauth/store.ts`** — clientsStore (with SDK-shaped `OAuthRegisteredClientsStore` impl), authCodesStore, tokensStore (always hash before lookup; never store plaintext), consentStore. Auto-prune sweep helper.
4. **Read SDK interface**: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/provider.d.ts` — confirm method names/shapes.
5. **`oauth/provider.ts`** — implements `OAuthServerProvider`. Includes `checkResourceAllowed` at every entry point. Overrides client-auth comparator to use the secret hash.
6. **`oauth/consent.ts`** — Express router. GET renders form (reads client + params from store). POST is rate-limited, validates HMAC-signed cid, timing-safe password compare, mints auth code on success, redirects.
7. **`src/config.ts`** — add fields, wire HTTPS validation into `configErrors`.
8. **`src/utils/security-warnings.ts`** — warn on `MCP_OAUTH_PASSWORD` issues.
9. **`src/api/server.ts`** — mount `mcpAuthRouter` at root (before CORS, rate limit), `/oauth` consent router, fix mount ordering.
10. **`src/mcp/index.ts`** — combined auth middleware (strict x-api-key), `requireBearerAuth` with `resourceMetadataUrl`, body parser before auth.
11. **`src/database/migrations/index.ts`** — register migration 004.
12. **Prune sweep** — call once at boot from `src/index.ts`; schedule a 6-hour `setInterval`.
13. **`.env.example`** — add `MCP_OAUTH_PASSWORD`, `PUBLIC_BASE_URL`, `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL`. CHANGELOG note for the `Bearer <API_KEY>` → `x-api-key` migration.
14. **`npm run build`**.
15. **Local smoke test** — start with step 0 (401 challenge), then run the full curl flow.
16. **Deploy note** — set `PUBLIC_BASE_URL=https://zapzaphub.rrayes.com.br` and `MCP_OAUTH_PASSWORD=<fresh>` in Dokploy before redeploy.

## Estimated change size

- Was: ~600-800 LOC across new files.
- Now: ~1000-1200 LOC (token hashing, family tracking, HMAC cid, resource validation, prune sweep, security warning, consent CSRF, full redirect-URI display, rate limits all add code).
- ~50 LOC modified across existing files.
- Migration runs automatically on next start.
