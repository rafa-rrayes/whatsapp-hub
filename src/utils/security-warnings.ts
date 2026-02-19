import { config } from '../config.js';

interface Warning {
  level: '!! STRONGLY RECOMMENDED' | '-- RECOMMENDED' | 'INFO';
  name: string;
  description: string;
  envVar: string;
}

export function printSecurityWarnings(): void {
  const warnings: Warning[] = [];

  if (!config.security.wsTicketAuth) {
    warnings.push({
      level: '!! STRONGLY RECOMMENDED',
      name: 'WebSocket Ticket Auth',
      description: 'API key is visible in WebSocket query string (logs, browser history)',
      envVar: 'SECURITY_WS_TICKET_AUTH=true',
    });
  }

  if (!config.security.disableHttpQueryAuth) {
    warnings.push({
      level: '!! STRONGLY RECOMMENDED',
      name: 'Disable HTTP Query Param Auth',
      description: 'api_key query parameter leaks credentials in server logs',
      envVar: 'SECURITY_DISABLE_HTTP_QUERY_AUTH=true',
    });
  }

  if (!config.security.encryptDatabase) {
    warnings.push({
      level: '-- RECOMMENDED',
      name: 'Database Encryption',
      description: 'SQLite database stores all messages, contacts, and media in plaintext',
      envVar: 'SECURITY_ENCRYPT_DATABASE=true (requires ENCRYPTION_KEY)',
    });
  }

  if (!config.security.encryptWebhookSecrets) {
    warnings.push({
      level: '-- RECOMMENDED',
      name: 'Webhook Secret Encryption',
      description: 'Webhook HMAC secrets are stored in plaintext in the database',
      envVar: 'SECURITY_ENCRYPT_WEBHOOK_SECRETS=true (requires ENCRYPTION_KEY)',
    });
  }

  if (!config.security.stripRawMessages) {
    warnings.push({
      level: '-- RECOMMENDED',
      name: 'Strip Raw Messages from API',
      description: 'raw_message field in API responses exposes full Baileys protocol data',
      envVar: 'SECURITY_STRIP_RAW_MESSAGES=true',
    });
  }

  if (config.corsOrigins === '*') {
    warnings.push({
      level: 'INFO',
      name: 'CORS Wildcard',
      description: 'CORS_ORIGINS=* allows any website to make authenticated API requests',
      envVar: 'CORS_ORIGINS=https://your-domain.com',
    });
  }

  if (!config.security.autoPrune) {
    warnings.push({
      level: 'INFO',
      name: 'Auto-Prune Old Data',
      description: 'Presence and event logs grow unbounded without periodic cleanup',
      envVar: 'SECURITY_AUTO_PRUNE=true',
    });
  }

  if (!config.security.hashEventJids) {
    warnings.push({
      level: 'INFO',
      name: 'Hash JIDs in Event Log',
      description: 'Phone numbers are stored in plaintext in the event_log table',
      envVar: 'SECURITY_HASH_EVENT_JIDS=true',
    });
  }

  if (!config.security.secFetchCheck) {
    warnings.push({
      level: 'INFO',
      name: 'Sec-Fetch Header Validation',
      description: 'API endpoints accept cross-site requests from browsers',
      envVar: 'SECURITY_SEC_FETCH_CHECK=true',
    });
  }

  if (warnings.length === 0) return;

  const sep = '='.repeat(68);
  const lines: string[] = [
    '',
    sep,
    '  SECURITY RECOMMENDATIONS',
    sep,
    '',
  ];

  for (const w of warnings) {
    lines.push(`  [${w.level}] ${w.name}`);
    lines.push(`    ${w.description}`);
    lines.push(`    Enable: ${w.envVar}`);
    lines.push('');
  }

  lines.push(sep);
  lines.push('');

  process.stderr.write(lines.join('\n'));
}
