import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({ level: config.logLevel });

export const log = {
  boot: logger.child({ component: 'Boot' }),
  api: logger.child({ component: 'API' }),
  wa: logger.child({ component: 'WA' }),
  db: logger.child({ component: 'DB' }),
  ws: logger.child({ component: 'WS' }),
  webhook: logger.child({ component: 'Webhook' }),
  media: logger.child({ component: 'Media' }),
  event: logger.child({ component: 'Event' }),
  jid: logger.child({ component: 'JID' }),
};
