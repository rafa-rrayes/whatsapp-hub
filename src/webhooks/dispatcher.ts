import { eventBus, HubEvent } from '../events/bus.js';
import { getDb } from '../database/index.js';
import { log } from '../utils/logger.js';
import crypto from 'crypto';

interface WebhookSub {
  id: string;
  url: string;
  secret: string | null;
  events: string;
  is_active: number;
}

class WebhookDispatcher {
  private readonly MAX_QUEUE_SIZE = 10000;
  private queue: Array<{ sub: WebhookSub; event: HubEvent }> = [];
  private processing = false;
  private stopped = false;
  private subsCache: WebhookSub[] | null = null;

  /** Invalidate cached subscriptions — call after any webhook CRUD operation. */
  invalidateCache(): void {
    this.subsCache = null;
  }

  private getActiveSubscriptions(): WebhookSub[] {
    if (!this.subsCache) {
      const db = getDb();
      this.subsCache = db
        .prepare('SELECT * FROM webhook_subscriptions WHERE is_active = 1')
        .all() as WebhookSub[];
    }
    return this.subsCache;
  }

  start(): void {
    eventBus.on('*', (event: HubEvent) => {
      if (this.stopped) return;

      // Don't forward internal connection events or audit log events
      if (!event.type.startsWith('wa.') && !event.type.startsWith('message.') && !event.type.startsWith('call')) return;

      try {
        const subs = this.getActiveSubscriptions();

        for (const sub of subs) {
          // Filter by event type
          if (sub.events !== '*') {
            const allowedEvents = sub.events.split(',').map((e) => e.trim());
            if (!allowedEvents.some((e) => event.type.startsWith(e))) continue;
          }
          if (this.queue.length >= this.MAX_QUEUE_SIZE) {
            log.webhook.warn({ maxSize: this.MAX_QUEUE_SIZE, eventType: event.type }, 'Queue full, dropping event');
            continue;
          }
          this.queue.push({ sub, event });
        }

        this.processQueue();
      } catch {
        // DB might not be ready yet
      }
    });

    log.webhook.info('Dispatcher started');
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, 10);
      await Promise.allSettled(
        batch.map(({ sub, event }) => this.send(sub, event))
      );
    }

    this.processing = false;
  }

  private async send(sub: WebhookSub, event: HubEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hub-Event': event.type,
      'X-Hub-Timestamp': String(event.timestamp),
    };

    if (sub.secret) {
      const signature = crypto
        .createHmac('sha256', sub.secret)
        .update(payload)
        .digest('hex');
      headers['X-Hub-Signature'] = `sha256=${signature}`;
    }

    try {
      const resp = await fetch(sub.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        log.webhook.warn({ url: sub.url, status: resp.status, eventType: event.type }, 'Webhook returned non-OK status');
      }
    } catch (err) {
      log.webhook.warn({ err, url: sub.url }, 'Failed to send webhook');
    }
  }

  async drain(): Promise<void> {
    this.stopped = true;
    if (this.queue.length > 0) {
      log.webhook.info({ remaining: this.queue.length }, 'Draining webhook queue');
      await this.processQueue();
    }
  }
}

export const webhookDispatcher = new WebhookDispatcher();
