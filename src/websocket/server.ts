import { Application } from 'express';
import expressWs from 'express-ws';
import { WebSocket } from 'ws';
import { eventBus, HubEvent } from '../events/bus.js';
import { config } from '../config.js';
import { timingSafeEqual } from '../utils/security.js';
import { log } from '../utils/logger.js';

const MAX_CONNECTIONS = 20;
const activeConnections = new Set<WebSocket>();

export function setupWebSocket(app: Application): void {
  const wsInstance = expressWs(app);

  wsInstance.app.ws('/ws', (ws, req) => {
    // Connection limit
    if (activeConnections.size >= MAX_CONNECTIONS) {
      ws.close(4029, 'Too many connections');
      return;
    }

    // Authenticate with timing-safe comparison
    const apiKey =
      req.query.api_key as string ||
      req.headers['x-api-key'] as string;

    if (!apiKey || !timingSafeEqual(apiKey, config.apiKey)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    activeConnections.add(ws);

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

    ws.on('close', () => {
      activeConnections.delete(ws);
      eventBus.removeListener('*', handler);
      log.ws.info({ active: activeConnections.size }, 'Client disconnected');
    });

    ws.on('error', () => {
      activeConnections.delete(ws);
      eventBus.removeListener('*', handler);
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
