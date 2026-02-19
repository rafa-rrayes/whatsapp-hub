import { Application } from 'express';
import expressWs from 'express-ws';
import { WebSocket } from 'ws';
import { eventBus, HubEvent } from '../events/bus.js';
import { config } from '../config.js';
import { timingSafeEqual } from '../utils/security.js';
import { log } from '../utils/logger.js';

const MAX_CONNECTIONS = 20;
const PING_INTERVAL_MS = 30_000;
const activeConnections = new Set<WebSocket>();

// Ticket store for secure WebSocket auth (populated by ws-ticket route)
const ticketStore = new Map<string, number>(); // ticket → expiresAt
let ticketCleanupTimer: ReturnType<typeof setInterval> | undefined;

export function consumeTicket(ticket: string): boolean {
  const expiresAt = ticketStore.get(ticket);
  if (!expiresAt) return false;
  ticketStore.delete(ticket);
  return Date.now() < expiresAt;
}

export function storeTicket(ticket: string, ttlMs: number): void {
  ticketStore.set(ticket, Date.now() + ttlMs);
  // Start cleanup timer if not running
  if (!ticketCleanupTimer) {
    ticketCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [t, exp] of ticketStore) {
        if (now >= exp) ticketStore.delete(t);
      }
    }, 60_000);
    ticketCleanupTimer.unref();
  }
}

export function setupWebSocket(app: Application): void {
  const wsInstance = expressWs(app);

  wsInstance.app.ws('/ws', (ws, req) => {
    // Connection limit
    if (activeConnections.size >= MAX_CONNECTIONS) {
      ws.close(4029, 'Too many connections');
      return;
    }

    // Authenticate
    let authenticated = false;

    if (config.security.wsTicketAuth) {
      // Ticket mode: accept ?ticket= (one-time) or x-api-key header (non-browser clients)
      const ticket = req.query.ticket as string;
      const headerKey = req.headers['x-api-key'] as string;

      if (ticket) {
        authenticated = consumeTicket(ticket);
      } else if (headerKey) {
        authenticated = timingSafeEqual(headerKey, config.apiKey);
      }
      // Reject ?api_key= in ticket mode
    } else {
      // Legacy mode: accept api_key query param and header
      const apiKey =
        req.query.api_key as string ||
        req.headers['x-api-key'] as string;
      authenticated = !!apiKey && timingSafeEqual(apiKey, config.apiKey);
    }

    if (!authenticated) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    activeConnections.add(ws);

    // Ping/pong heartbeat to detect stale connections
    let isAlive = true;
    const pingTimer = setInterval(() => {
      if (!isAlive) {
        ws.terminate();
        return;
      }
      isAlive = false;
      ws.ping();
    }, PING_INTERVAL_MS);

    ws.on('pong', () => { isAlive = true; });

    // Optional event filter
    const filterEvents = req.query.events
      ? (req.query.events as string).split(',').map((e) => e.trim())
      : null;

    log.ws.info(
      { filter: filterEvents, active: activeConnections.size },
      'Client connected'
    );

    const handler = (event: HubEvent) => {
      if (ws.readyState !== ws.OPEN) return;

      // Apply event filter
      if (filterEvents) {
        if (!filterEvents.some((f) => event.type.startsWith(f))) return;
      }

      try {
        ws.send(JSON.stringify(event));
      } catch (err) {
        log.ws.error({ err }, 'Error sending message');
      }
    };

    eventBus.on('*', handler);

    // Discard unsolicited messages to prevent memory buildup
    ws.on('message', () => { /* discard */ });

    const cleanup = () => {
      clearInterval(pingTimer);
      activeConnections.delete(ws);
      eventBus.removeListener('*', handler);
    };

    ws.on('close', () => {
      cleanup();
      log.ws.info({ active: activeConnections.size }, 'Client disconnected');
    });

    ws.on('error', () => {
      cleanup();
    });

    // Send current connection status on connect
    ws.send(
      JSON.stringify({
        type: 'connection.status',
        timestamp: Date.now(),
        data: { status: 'ws_connected', message: 'WebSocket connected to WhatsApp Hub' },
      })
    );
  });

  log.ws.info('WebSocket server ready at /ws');
}

export function closeWebSockets(): void {
  for (const ws of activeConnections) {
    ws.close(1001, 'Server shutting down');
  }
  activeConnections.clear();
}
