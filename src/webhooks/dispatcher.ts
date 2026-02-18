import { eventBus, HubEvent } from '../events/bus.js';
import { getDb } from '../database/index.js';
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

  start(): void {
    eventBus.on('*', (event: HubEvent) => {
      // Don't forward internal connection events or audit log events
      if (!event.type.startsWith('wa.') && !event.type.startsWith('message.') && !event.type.startsWith('call')) return;

      try {
        const db = getDb();
        const subs = db
          .prepare('SELECT * FROM webhook_subscriptions WHERE is_active = 1')
          .all() as WebhookSub[];

        for (const sub of subs) {
          // Filter by event type
          if (sub.events !== '*') {
            const allowedEvents = sub.events.split(',').map((e) => e.trim());
            if (!allowedEvents.some((e) => event.type.startsWith(e))) continue;
          }
          if (this.queue.length >= this.MAX_QUEUE_SIZE) {
            console.warn(`[Webhook] Queue full (${this.MAX_QUEUE_SIZE}), dropping event ${event.type}`);
            continue;
          }
          this.queue.push({ sub, event });
        }

        this.processQueue();
      } catch {
        // DB might not be ready yet
      }
    });

    console.log('[Webhooks] Dispatcher started.');
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
        console.warn(`[Webhook] ${sub.url} returned ${resp.status} for ${event.type}`);
      }
    } catch (err) {
      console.warn(`[Webhook] Failed to send to ${sub.url}: ${err}`);
    }
  }
}

export const webhookDispatcher = new WebhookDispatcher();
