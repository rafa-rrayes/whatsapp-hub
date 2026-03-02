import { eventBus, HubEvent } from '../events/bus.js';
import { getDb } from '../database/index.js';
import { validateUrlForFetch } from '../utils/security.js';
import { log } from '../utils/logger.js';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';

interface WebhookSub {
  id: string;
  url: string;
  secret: string | null;
  events: string;
  is_active: number;
}

// URL validation cache: url → { validatedAt, valid }
const URL_VALIDATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const urlValidationCache = new Map<string, { validatedAt: number; valid: boolean }>();

/** Exponential backoff delays in seconds: 1, 2, 4, 8, 16 */
const BACKOFF_DELAYS = [1, 2, 4, 8, 16];
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_POLL_INTERVAL_MS = 5000;

class WebhookDispatcher {
  private readonly MAX_QUEUE_SIZE = 10000;
  private queue: Array<{ sub: WebhookSub; event: HubEvent }> = [];
  private processing = false;
  private stopped = false;
  private subsCache: WebhookSub[] | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  /** Invalidate cached subscriptions — call after any webhook CRUD operation. */
  invalidateCache(): void {
    this.subsCache = null;
    urlValidationCache.clear();
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

  private async validateUrl(url: string): Promise<boolean> {
    const cached = urlValidationCache.get(url);
    if (cached && (Date.now() - cached.validatedAt) < URL_VALIDATION_TTL_MS) {
      return cached.valid;
    }

    try {
      await validateUrlForFetch(url);
      urlValidationCache.set(url, { validatedAt: Date.now(), valid: true });
      return true;
    } catch {
      urlValidationCache.set(url, { validatedAt: Date.now(), valid: false });
      return false;
    }
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

    // Start retry polling
    this.retryTimer = setInterval(() => this.processRetries(), RETRY_POLL_INTERVAL_MS);

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

  private buildHeaders(event: HubEvent, payload: string, secret: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hub-Event': event.type,
      'X-Hub-Timestamp': String(event.timestamp),
    };

    if (secret) {
      const signature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      headers['X-Hub-Signature'] = `sha256=${signature}`;
    }

    return headers;
  }

  private async resolveSecret(sub: WebhookSub): Promise<string | null> {
    let secret = sub.secret;
    if (secret) {
      try {
        const { maybeDecrypt } = await import('../utils/encryption.js');
        secret = maybeDecrypt(secret);
      } catch {
        // encryption module not available or decryption failed — use raw secret
      }
    }
    return secret;
  }

  private async send(sub: WebhookSub, event: HubEvent): Promise<void> {
    // Re-validate webhook URL at send time (SSRF TOCTOU protection)
    const urlValid = await this.validateUrl(sub.url);
    if (!urlValid) {
      log.webhook.warn({ url: sub.url }, 'Webhook URL failed SSRF re-validation, skipping delivery');
      return;
    }

    const payload = JSON.stringify(event);
    const secret = await this.resolveSecret(sub);
    const headers = this.buildHeaders(event, payload, secret);

    try {
      const resp = await fetch(sub.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        log.webhook.warn({ url: sub.url, status: resp.status, eventType: event.type }, 'Webhook returned non-OK status');
        this.persistFailedDelivery(sub.id, event.type, payload, `HTTP ${resp.status}`);
      }
    } catch (err) {
      log.webhook.warn({ err, url: sub.url }, 'Failed to send webhook');
      this.persistFailedDelivery(sub.id, event.type, payload, String(err));
    }
  }

  private persistFailedDelivery(subscriptionId: string, eventType: string, payload: string, error: string): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO webhook_delivery_log (id, subscription_id, event_type, payload, status, attempts, max_attempts, last_error, last_attempt_at, next_retry_at)
        VALUES (?, ?, ?, ?, 'failed', 1, ?, ?, datetime('now'), datetime('now', '+1 seconds'))
      `).run(uuid(), subscriptionId, eventType, payload, MAX_RETRY_ATTEMPTS, error);
    } catch {
      // Table might not exist in older DBs without migration
    }
  }

  private async processRetries(): Promise<void> {
    if (this.stopped) return;

    try {
      const db = getDb();
      const due = db.prepare(`
        SELECT dl.*, ws.url, ws.secret, ws.is_active
        FROM webhook_delivery_log dl
        JOIN webhook_subscriptions ws ON ws.id = dl.subscription_id
        WHERE dl.status = 'failed' AND dl.next_retry_at <= datetime('now') AND dl.attempts < dl.max_attempts
        ORDER BY dl.next_retry_at ASC
        LIMIT 20
      `).all() as Array<{
        id: string; subscription_id: string; event_type: string; payload: string;
        attempts: number; max_attempts: number; url: string; secret: string | null; is_active: number;
      }>;

      for (const delivery of due) {
        if (!delivery.is_active) {
          // Subscription disabled — mark as exhausted
          db.prepare(`UPDATE webhook_delivery_log SET status = 'exhausted', next_retry_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(delivery.id);
          continue;
        }

        const urlValid = await this.validateUrl(delivery.url);
        if (!urlValid) {
          db.prepare(`UPDATE webhook_delivery_log SET status = 'exhausted', last_error = 'SSRF validation failed', next_retry_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(delivery.id);
          continue;
        }

        const sub: WebhookSub = { id: delivery.subscription_id, url: delivery.url, secret: delivery.secret, events: '*', is_active: delivery.is_active };
        const secret = await this.resolveSecret(sub);
        const event: HubEvent = JSON.parse(delivery.payload);
        const headers = this.buildHeaders(event, delivery.payload, secret);

        const newAttempts = delivery.attempts + 1;

        try {
          const resp = await fetch(delivery.url, {
            method: 'POST',
            headers,
            body: delivery.payload,
            signal: AbortSignal.timeout(10000),
          });

          if (resp.ok) {
            db.prepare(`UPDATE webhook_delivery_log SET status = 'delivered', attempts = ?, last_attempt_at = datetime('now'), next_retry_at = NULL, updated_at = datetime('now') WHERE id = ?`)
              .run(newAttempts, delivery.id);
            log.webhook.info({ deliveryId: delivery.id, url: delivery.url }, 'Retry delivery succeeded');
          } else {
            this.updateRetryAttempt(db, delivery.id, newAttempts, delivery.max_attempts, `HTTP ${resp.status}`);
          }
        } catch (err) {
          this.updateRetryAttempt(db, delivery.id, newAttempts, delivery.max_attempts, String(err));
        }
      }
    } catch {
      // Table might not exist yet
    }
  }

  private updateRetryAttempt(db: ReturnType<typeof getDb>, id: string, attempts: number, maxAttempts: number, error: string): void {
    if (attempts >= maxAttempts) {
      db.prepare(`UPDATE webhook_delivery_log SET status = 'exhausted', attempts = ?, last_error = ?, last_attempt_at = datetime('now'), next_retry_at = NULL, updated_at = datetime('now') WHERE id = ?`)
        .run(attempts, error, id);
      log.webhook.warn({ deliveryId: id, attempts }, 'Webhook delivery exhausted all retries');
    } else {
      const delaySec = BACKOFF_DELAYS[Math.min(attempts - 1, BACKOFF_DELAYS.length - 1)];
      db.prepare(`UPDATE webhook_delivery_log SET attempts = ?, last_error = ?, last_attempt_at = datetime('now'), next_retry_at = datetime('now', '+' || ? || ' seconds'), updated_at = datetime('now') WHERE id = ?`)
        .run(attempts, error, delaySec, id);
    }
  }

  /** Manually retry a specific failed delivery. */
  async retryDelivery(deliveryId: string): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    const delivery = db.prepare(`
      SELECT dl.*, ws.url, ws.secret, ws.is_active
      FROM webhook_delivery_log dl
      JOIN webhook_subscriptions ws ON ws.id = dl.subscription_id
      WHERE dl.id = ?
    `).get(deliveryId) as {
      id: string; subscription_id: string; event_type: string; payload: string;
      attempts: number; url: string; secret: string | null; is_active: number;
    } | undefined;

    if (!delivery) return { success: false, error: 'Delivery not found' };
    if (!delivery.is_active) return { success: false, error: 'Subscription is inactive' };

    const sub: WebhookSub = { id: delivery.subscription_id, url: delivery.url, secret: delivery.secret, events: '*', is_active: delivery.is_active };
    const secret = await this.resolveSecret(sub);
    const event: HubEvent = JSON.parse(delivery.payload);
    const headers = this.buildHeaders(event, delivery.payload, secret);

    try {
      const resp = await fetch(delivery.url, {
        method: 'POST',
        headers,
        body: delivery.payload,
        signal: AbortSignal.timeout(10000),
      });

      const newAttempts = delivery.attempts + 1;
      if (resp.ok) {
        db.prepare(`UPDATE webhook_delivery_log SET status = 'delivered', attempts = ?, last_attempt_at = datetime('now'), next_retry_at = NULL, updated_at = datetime('now') WHERE id = ?`)
          .run(newAttempts, delivery.id);
        return { success: true };
      } else {
        db.prepare(`UPDATE webhook_delivery_log SET attempts = ?, last_error = ?, last_attempt_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
          .run(newAttempts, `HTTP ${resp.status}`, delivery.id);
        return { success: false, error: `HTTP ${resp.status}` };
      }
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async drain(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.queue.length > 0) {
      log.webhook.info({ remaining: this.queue.length }, 'Draining webhook queue');
      await this.processQueue();
    }
  }
}

export const webhookDispatcher = new WebhookDispatcher();
