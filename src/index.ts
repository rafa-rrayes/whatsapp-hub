import { config, configErrors } from './config.js';
import { initDb, closeDb } from './database/index.js';
import { connectionManager } from './connection/manager.js';
import { registerEventHandlers } from './events/handler.js';
import { webhookDispatcher } from './webhooks/dispatcher.js';
import { createServer } from './api/server.js';
import { closeWebSockets } from './websocket/server.js';
import { loadJidAliases, migrateExistingJids } from './utils/jid.js';
import { initSettings } from './settings.js';
import { log } from './utils/logger.js';
import { startErrorServer } from './error-server.js';

async function main() {
  log.boot.info('WhatsApp Hub — Personal WhatsApp API');

  // 1. Initialize database
  log.boot.info('Initializing database...');
  initDb();

  // 1a. Load runtime settings from DB (uses .env as defaults)
  log.boot.info('Loading runtime settings...');
  initSettings();

  // 1b. Load JID aliases and migrate existing LID data
  log.boot.info('Loading JID aliases...');
  loadJidAliases();
  migrateExistingJids();

  // 2. Register event handlers (DB writes)
  log.boot.info('Registering event handlers...');
  registerEventHandlers();

  // 3. Start webhook dispatcher
  log.boot.info('Starting webhook dispatcher...');
  webhookDispatcher.start();

  // 4. Start API server
  log.boot.info('Starting API server...');
  const app = createServer();
  const server = app.listen(config.port, config.host, () => {
    log.boot.info({ host: config.host, port: config.port }, 'Server listening');
  });

  // 5. Connect to WhatsApp
  log.boot.info('Connecting to WhatsApp...');
  await connectionManager.connect();

  // Graceful shutdown
  const shutdown = async () => {
    log.boot.info('Shutting down...');

    // 1. Stop accepting new connections
    server.close();

    // 2. Close WebSocket connections
    closeWebSockets();

    // 3. Disconnect WhatsApp cleanly
    await connectionManager.disconnect();

    // 4. Flush webhook queue
    await webhookDispatcher.drain();

    // 5. Close database
    closeDb();

    log.boot.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Catch unhandled errors to prevent silent crashes
  process.on('unhandledRejection', (reason) => {
    log.boot.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    log.boot.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  log.boot.info({
    apiKeyLength: config.apiKey.length,
    dataDir: config.dataDir,
  }, 'WhatsApp Hub is running! Scan the QR code with WhatsApp to connect.');
}

if (configErrors.length > 0) {
  const server = startErrorServer(config.port, config.host, configErrors);
  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  main().catch((err) => {
    log.boot.fatal({ err }, 'Fatal error');
    const message = err instanceof Error ? err.message : String(err);
    const server = startErrorServer(config.port, config.host, [message]);
    const shutdown = () => {
      server.close();
      process.exit(1);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
