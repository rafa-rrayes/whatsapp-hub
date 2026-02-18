import { config } from './config.js';
import { initDb, closeDb } from './database/index.js';
import { connectionManager } from './connection/manager.js';
import { registerEventHandlers } from './events/handler.js';
import { webhookDispatcher } from './webhooks/dispatcher.js';
import { createServer } from './api/server.js';
import { loadJidAliases, migrateExistingJids } from './utils/jid.js';

async function main() {
  console.log('='.repeat(50));
  console.log('  WhatsApp Hub — Personal WhatsApp API');
  console.log('='.repeat(50));

  // 1. Initialize database
  console.log('\n[Boot] Initializing database...');
  initDb();

  // 1b. Load JID aliases and migrate existing LID data
  console.log('[Boot] Loading JID aliases...');
  loadJidAliases();
  migrateExistingJids();

  // 2. Register event handlers (DB writes)
  console.log('[Boot] Registering event handlers...');
  registerEventHandlers();

  // 3. Start webhook dispatcher
  console.log('[Boot] Starting webhook dispatcher...');
  webhookDispatcher.start();

  // 4. Start API server
  console.log('[Boot] Starting API server...');
  const app = createServer();
  app.listen(config.port, config.host, () => {
    console.log(`[API] Server listening on http://${config.host}:${config.port}`);
    console.log(`[API] API docs at http://localhost:${config.port}/api`);
  });

  // 5. Connect to WhatsApp
  console.log('[Boot] Connecting to WhatsApp...');
  await connectionManager.connect();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Shutdown] Shutting down...');
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Catch unhandled errors to prevent silent crashes
  process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught exception:', err);
    process.exit(1);
  });

  console.log('\n[Boot] WhatsApp Hub is running!');
  console.log(`[Boot] API Key: configured (${config.apiKey.length} chars)`);
  console.log(`[Boot] Data dir: ${config.dataDir}`);
  console.log('[Boot] Scan the QR code with WhatsApp to connect.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
