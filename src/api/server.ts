import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { authMiddleware } from './middleware/auth.js';
import { setupWebSocket } from '../websocket/server.js';
import { ApiError } from './errors.js';
import { log } from '../utils/logger.js';

import messagesRouter from './routes/messages.js';
import contactsRouter from './routes/contacts.js';
import groupsRouter from './routes/groups.js';
import mediaRouter from './routes/media.js';
import actionsRouter from './routes/actions.js';
import connectionRouter from './routes/connection.js';
import chatsRouter from './routes/chats.js';
import webhooksRouter from './routes/webhooks.js';
import statsRouter from './routes/stats.js';
import settingsRouter from './routes/settings.js';

/**
 * Returns true if `origin` is a loopback or RFC-1918 private address on the given port.
 * Used as the default CORS policy so the dashboard works from LAN IPs without configuration.
 */
function isLocalOrPrivateOrigin(origin: string, port: number): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  const originPort = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (Number(originPort) !== port) return false;

  const host = url.hostname;

  // localhost / loopback
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.localhost')) return true;

  // IPv4 private ranges
  const ipv4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
    if (a === 192 && b === 168) return true;             // 192.168.0.0/16
  }

  return false;
}

export function createServer() {
  const app = express();

  // Trust proxy only when explicitly behind a reverse proxy (Caddy, nginx, Cloudflare, etc.)
  if (config.behindProxy) {
    app.set('trust proxy', 1);
  }

  // Security headers
  const cspDirectives: Record<string, string[]> = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
  };
  // upgrade-insecure-requests tells browsers to load all sub-resources over HTTPS.
  // Only enable when a TLS-terminating reverse proxy sits in front of the app.
  if (config.behindProxy) {
    cspDirectives.upgradeInsecureRequests = [];
  }

  app.use(helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    crossOriginEmbedderPolicy: false, // Allow loading external images
    // HSTS forces browsers to use HTTPS for this host. Disable when serving plain HTTP.
    strictTransportSecurity: config.behindProxy,
  }));

  // Body parsing with safe limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // CORS — configurable origins
  app.use((_req, res, next) => {
    const reqOrigin = _req.headers.origin;
    const origins = config.corsOrigins;

    let allowed = false;

    if (origins === '*') {
      res.header('Access-Control-Allow-Origin', '*');
      allowed = true;
    } else if (origins) {
      const list = origins.split(',').map((o) => o.trim());
      if (reqOrigin && list.includes(reqOrigin)) {
        res.header('Access-Control-Allow-Origin', reqOrigin);
        res.header('Vary', 'Origin');
        allowed = true;
      }
    } else if (reqOrigin) {
      // Default: allow localhost and private-network origins on the configured port
      if (isLocalOrPrivateOrigin(reqOrigin, config.port)) {
        res.header('Access-Control-Allow-Origin', reqOrigin);
        res.header('Vary', 'Origin');
        allowed = true;
      }
    }

    if (!allowed && reqOrigin) {
      log.api.warn(
        { origin: reqOrigin },
        'CORS request blocked — set CORS_ORIGINS in .env to allow this origin',
      );
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Global rate limiter
  app.use(rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 200,             // 200 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  }));

  // Serve static dashboard (no auth — dashboard handles its own API key)
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Health check (no auth, no sensitive info)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Auth middleware for all /api routes
  app.use('/api', authMiddleware);

  // Stricter rate limit on action endpoints (message sending, connection management)
  const actionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many action requests, please slow down.' },
  });
  app.use('/api/actions', actionLimiter);
  app.use('/api/connection', actionLimiter);

  // Higher body limit only for action routes that accept base64 media
  const mediaBodyParser = express.json({ limit: '15mb' });
  app.use('/api/actions/send/image', mediaBodyParser);
  app.use('/api/actions/send/document', mediaBodyParser);
  app.use('/api/actions/send/audio', mediaBodyParser);
  app.use('/api/actions/send/video', mediaBodyParser);
  app.use('/api/actions/send/sticker', mediaBodyParser);

  // Register routes
  app.use('/api/messages', messagesRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/actions', actionsRouter);
  app.use('/api/connection', connectionRouter);
  app.use('/api/chats', chatsRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/settings', settingsRouter);

  // API docs summary
  app.get('/api', (_req, res) => {
    res.json({
      name: 'WhatsApp Hub API',
      version: '1.0.0',
      endpoints: {
        connection: {
          'GET /api/connection/status': 'Connection status',
          'GET /api/connection/qr': 'QR code for authentication',
          'GET /api/connection/qr/image': 'QR code as PNG image',
          'POST /api/connection/restart': 'Restart connection',
          'POST /api/connection/logout': 'Logout and disconnect',
        },
        messages: {
          'GET /api/messages': 'Query messages (params: chat, from, from_me, type, search, before, after, has_media, limit, offset, order)',
          'GET /api/messages/search?q=': 'Full-text search',
          'GET /api/messages/stats': 'Message statistics',
          'GET /api/messages/:id': 'Get message by ID',
        },
        chats: {
          'GET /api/chats': 'List all chats',
          'GET /api/chats/:jid': 'Chat details with recent messages',
        },
        contacts: {
          'GET /api/contacts': 'List contacts (param: search)',
          'GET /api/contacts/:jid': 'Get contact by JID',
          'GET /api/contacts/:jid/profile-pic': 'Get profile picture URL',
        },
        groups: {
          'GET /api/groups': 'List groups (param: search)',
          'GET /api/groups/:jid': 'Group details with participants',
          'GET /api/groups/:jid/metadata': 'Fresh group metadata from WhatsApp',
          'GET /api/groups/:jid/invite-code': 'Get group invite code',
          'PUT /api/groups/:jid/subject': 'Update group subject',
          'PUT /api/groups/:jid/description': 'Update group description',
          'POST /api/groups/:jid/participants': 'Manage participants (add/remove/promote/demote)',
        },
        actions: {
          'POST /api/actions/send/text': 'Send text message { jid, text, quoted_id? }',
          'POST /api/actions/send/image': 'Send image { jid, base64|url, caption?, mime_type? }',
          'POST /api/actions/send/document': 'Send document { jid, base64|url, filename, mime_type, caption? }',
          'POST /api/actions/send/audio': 'Send audio { jid, base64|url, ptt? }',
          'POST /api/actions/send/video': 'Send video { jid, base64|url, caption? }',
          'POST /api/actions/send/sticker': 'Send sticker { jid, base64|url }',
          'POST /api/actions/send/location': 'Send location { jid, latitude, longitude, name?, address? }',
          'POST /api/actions/send/contact': 'Send contact { jid, contact_jid, name }',
          'POST /api/actions/react': 'React to message { jid, message_id, emoji }',
          'POST /api/actions/read': 'Mark as read { jid, message_ids[] }',
          'POST /api/actions/presence': 'Send presence { type, jid? }',
          'PUT /api/actions/profile-status': 'Update profile status { status }',
        },
        media: {
          'GET /api/media/stats': 'Media statistics',
          'GET /api/media/:id': 'Media metadata',
          'GET /api/media/:id/download': 'Download media file',
          'GET /api/media/by-message/:messageId': 'Get media by message ID',
        },
        webhooks: {
          'GET /api/webhooks': 'List webhook subscriptions',
          'POST /api/webhooks': 'Create subscription { url, secret?, events? }',
          'DELETE /api/webhooks/:id': 'Delete subscription',
          'PUT /api/webhooks/:id/toggle': 'Toggle active/inactive',
        },
        stats: {
          'GET /api/stats': 'Dashboard overview',
          'GET /api/stats/events': 'Query event log',
          'GET /api/stats/events/types': 'Event type counts',
          'DELETE /api/stats/events/prune?days=': 'Prune old events',
        },
        settings: {
          'GET /api/settings': 'List runtime settings with defaults',
          'PUT /api/settings': 'Update runtime settings { logLevel?, autoDownloadMedia?, maxMediaSizeMB? }',
        },
        websocket: {
          'WS /ws?token=&events=': 'Real-time event stream (events param is optional comma-separated filter)',
        },
      },
    });
  });

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
  });

  // Global error handler — prevents stack traces from leaking to clients
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ApiError) {
      if (err.statusCode >= 500) log.api.error({ err }, 'Server error');
      else log.api.warn({ err, statusCode: err.statusCode }, err.message);
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.api.error({ err }, 'Unhandled error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Setup WebSocket
  setupWebSocket(app);

  return app;
}
