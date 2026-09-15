import { Router } from 'express';
import { config } from '../../config.js';
import { getMcpToolCatalog } from '../../mcp/catalog.js';

interface SetupConfig {
  publicBaseUrl: string;
  publicBaseUrlConfigured: boolean;
  mcpOauthPassword: string;
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function describeMcpSetup(settings: SetupConfig, requestOrigin: string, oauthMounted: boolean) {
  const configured = httpUrl(settings.publicBaseUrl);
  const useConfigured = settings.publicBaseUrlConfigured && configured !== null;
  const base = useConfigured ? configured : httpUrl(requestOrigin);
  if (!base) throw new Error('Unable to determine the MCP endpoint URL');

  const mcpUrl = new URL('/mcp', base).href;
  const warnings: string[] = [];
  if (!useConfigured) {
    warnings.push('PUBLIC_BASE_URL is not configured with a valid public URL. This endpoint uses the dashboard request address; remote agents must be able to reach it.');
  }
  if (base.protocol !== 'https:') {
    warnings.push('This endpoint uses HTTP. Use HTTPS before sharing an API key over an untrusted network.');
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.hostname.endsWith('.localhost')) {
    warnings.push('This is a loopback address. It only works for agents running on the same computer as WhatsApp Hub.');
  }

  let reason: string | null = null;
  if (!oauthMounted || !configured) reason = 'The OAuth authorization endpoints are unavailable. Check PUBLIC_BASE_URL and server configuration.';
  else if (!settings.mcpOauthPassword) reason = 'Set MCP_OAUTH_PASSWORD on the server to enable OAuth authorization.';
  else if (new URL('/mcp', configured).href !== mcpUrl) reason = 'Set PUBLIC_BASE_URL to this externally reachable address so OAuth discovery advertises the correct MCP resource.';

  const enabled = reason === null;
  return {
    mcpUrl,
    transport: 'streamable-http' as const,
    urlSource: useConfigured ? 'configured' as const : 'request' as const,
    warnings,
    auth: {
      apiKey: { enabled: true as const, header: 'x-api-key' as const },
      oauth: {
        enabled,
        issuerUrl: configured?.href.replace(/\/$/, '') ?? null,
        discoveryUrl: enabled ? new URL('/.well-known/oauth-protected-resource/mcp', configured!).href : null,
        reason,
      },
    },
  };
}

export function createMcpSetupRouter(oauthMounted: boolean): Router {
  const router = Router();
  router.get('/setup', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      // req.protocol honors forwarded headers only under the app's configured
      // trust-proxy policy. Never accept an arbitrary Origin as the public URL.
      const setup = describeMcpSetup(config, `${req.protocol}://${req.get('host') ?? ''}`, oauthMounted);
      const tools = await getMcpToolCatalog();
      res.json({ ...setup, tools });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
