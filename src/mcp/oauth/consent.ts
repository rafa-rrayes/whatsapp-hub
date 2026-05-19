import express, { type RequestHandler, type Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';
import { log } from '../../utils/logger.js';
import { clientsRepo, consentRepo } from './store.js';
import { mintAuthCodeForConsent } from './provider.js';
import { timingSafeEqualStr, verifyCid } from './hash.js';

const MAX_PASSWORD_ATTEMPTS = 5;

interface StoredParams {
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes?: string[];
  resource?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

interface RenderInput {
  signedCid: string;
  clientName: string;
  redirectUri: string;
  scopes: string[];
  error?: string;
}

function renderForm({ signedCid, clientName, redirectUri, scopes, error }: RenderInput): string {
  const scopeText = scopes.length ? scopes.join(', ') : '(none requested)';
  const errBlock = error
    ? `<p class="err">${escapeHtml(error)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Authorize MCP client — WhatsApp Hub</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
  body { max-width: 480px; margin: 60px auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.4em; margin-bottom: 0.5em; }
  dl { background: rgba(127,127,127,0.08); padding: 12px 16px; border-radius: 6px; }
  dt { font-size: 0.85em; opacity: 0.7; margin-top: 8px; }
  dt:first-child { margin-top: 0; }
  dd { margin: 0 0 4px; word-break: break-all; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
  label { display: block; margin: 18px 0 6px; font-weight: 600; }
  input[type=password] { width: 100%; padding: 9px 11px; border-radius: 6px; border: 1px solid rgba(127,127,127,0.4); font-size: 1em; box-sizing: border-box; }
  .row { display: flex; gap: 10px; margin-top: 18px; }
  button { flex: 1; padding: 10px 14px; border-radius: 6px; border: 0; font-size: 1em; cursor: pointer; }
  button.allow { background: #2563eb; color: white; }
  button.cancel { background: rgba(127,127,127,0.15); color: inherit; }
  .err { color: #b91c1c; background: rgba(185,28,28,0.08); padding: 10px 12px; border-radius: 6px; font-size: 0.9em; }
  .note { font-size: 0.85em; opacity: 0.7; margin-top: 24px; }
</style>
</head>
<body>
<h1>Authorize new MCP client</h1>
<p>An MCP client is requesting access to your WhatsApp Hub data. Verify the details, then enter the MCP authorization password to allow.</p>
<dl>
  <dt>Application</dt><dd>${escapeHtml(clientName)}</dd>
  <dt>Will redirect to</dt><dd><code>${escapeHtml(redirectUri)}</code></dd>
  <dt>Requested scopes</dt><dd>${escapeHtml(scopeText)}</dd>
</dl>
${errBlock}
<form method="POST" action="/oauth/consent" autocomplete="off">
  <input type="hidden" name="cid" value="${escapeHtml(signedCid)}">
  <label for="password">MCP authorization password</label>
  <input type="password" id="password" name="password" autocomplete="off" autofocus required>
  <div class="row">
    <button class="allow" type="submit" name="action" value="allow">Allow</button>
    <button class="cancel" type="submit" name="action" value="cancel">Cancel</button>
  </div>
</form>
<p class="note">If you didn't initiate this, click Cancel. The redirect URL is part of the client's registration; verify it points to a service you trust.</p>
</body>
</html>`;
}

function renderError(message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Authorization error</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;line-height:1.5}.err{color:#b91c1c;background:rgba(185,28,28,0.08);padding:12px 16px;border-radius:6px}</style>
</head><body><h1>Authorization error</h1><p class="err">${escapeHtml(message)}</p><p>Restart the connection from your MCP client to try again.</p></body></html>`;
}

function loadConsent(signedCid: string | undefined): { cid: string; client_id: string; params: StoredParams; clientName: string } | { error: string } {
  if (!signedCid) return { error: 'Missing or invalid consent identifier.' };
  const cid = verifyCid(signedCid);
  if (!cid) return { error: 'Invalid or tampered consent identifier.' };
  const row = consentRepo.get(cid);
  if (!row) return { error: 'Consent session not found (it may have expired). Restart from your MCP client.' };
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    consentRepo.delete(cid);
    return { error: 'Consent session expired. Restart from your MCP client.' };
  }
  const clientRow = clientsRepo.getRow(row.client_id);
  if (!clientRow) return { error: 'Client no longer registered.' };
  const params = JSON.parse(row.params_json) as StoredParams;
  const clientName = clientRow.client_name || row.client_id;
  return { cid, client_id: row.client_id, params, clientName };
}

const consentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many consent attempts; slow down.',
});

const get: RequestHandler = (req, res) => {
  const signedCid = typeof req.query.cid === 'string' ? req.query.cid : undefined;
  const loaded = loadConsent(signedCid);
  if ('error' in loaded) {
    res.status(400).type('html').send(renderError(loaded.error));
    return;
  }
  res.type('html').send(renderForm({
    signedCid: signedCid!,
    clientName: loaded.clientName,
    redirectUri: loaded.params.redirectUri,
    scopes: loaded.params.scopes ?? [],
  }));
};

const post: RequestHandler = (req, res) => {
  const body = req.body as Record<string, string> | undefined;
  const signedCid = body?.cid;
  const action = body?.action;
  const password = body?.password ?? '';

  const loaded = loadConsent(signedCid);
  if ('error' in loaded) {
    res.status(400).type('html').send(renderError(loaded.error));
    return;
  }
  const { cid, client_id, params, clientName } = loaded;

  if (action === 'cancel') {
    consentRepo.delete(cid);
    const url = new URL(params.redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (params.state) url.searchParams.set('state', params.state);
    res.redirect(303, url.href);
    return;
  }

  if (!config.mcpOauthPassword) {
    // Misconfiguration — shouldn't reach here because config validation rejects boot.
    res.status(500).type('html').send(renderError('Server misconfigured: MCP_OAUTH_PASSWORD not set.'));
    return;
  }

  const correct = timingSafeEqualStr(password, config.mcpOauthPassword);
  if (!correct) {
    const attempts = consentRepo.incrementAttempts(cid);
    if (attempts >= MAX_PASSWORD_ATTEMPTS) {
      consentRepo.delete(cid);
      log.api.warn({ client_id, ip: req.ip }, 'OAuth consent locked after too many wrong passwords');
      res.status(429).type('html').send(renderError('Too many failed attempts. Restart from your MCP client.'));
      return;
    }
    res.status(401).type('html').send(renderForm({
      signedCid: signedCid!,
      clientName,
      redirectUri: params.redirectUri,
      scopes: params.scopes ?? [],
      error: `Wrong password. ${MAX_PASSWORD_ATTEMPTS - attempts} attempt${MAX_PASSWORD_ATTEMPTS - attempts === 1 ? '' : 's'} remaining.`,
    }));
    return;
  }

  const code = mintAuthCodeForConsent(cid, client_id, params);
  log.api.info({ client_id }, 'OAuth consent approved; auth code issued');

  const url = new URL(params.redirectUri);
  url.searchParams.set('code', code);
  if (params.state) url.searchParams.set('state', params.state);
  res.redirect(303, url.href);
};

export function createConsentRouter(): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '32kb' }));
  router.get('/consent', get);
  router.post('/consent', consentLimiter, post);
  return router;
}
