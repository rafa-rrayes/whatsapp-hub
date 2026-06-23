import pino from 'pino';
import { config } from '../config.js';
import { logBufferStream } from './log-buffer.js';

// Tee logs to stdout (the container log) AND an in-memory ring buffer that the
// dashboard's Logs tab reads. Each destination uses level 'trace' so it
// forwards everything the logger emits; the effective verbosity is still
// controlled by logger.level (config.logLevel, adjustable at runtime via
// settings) which gates emission before the records reach the streams.
export const logger = pino(
  { level: config.logLevel },
  pino.multistream([
    { level: 'trace', stream: process.stdout },
    { level: 'trace', stream: logBufferStream },
  ]),
);

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
