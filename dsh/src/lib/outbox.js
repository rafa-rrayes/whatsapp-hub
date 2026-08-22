/**
 * Write-ahead outbox with idempotency for every outbound WhatsApp action.
 *
 * Guarantees (see DESIGN.md §3.2):
 *   - the intent is durable BEFORE the network call (write-ahead),
 *   - a repeated send with the same key inside a short window is refused,
 *   - delivery state is tracked and pollable (pending → sent → delivered/read/failed).
 *
 * This module is import-free. It owns no timers or network of its own; the
 * caller supplies `hub` (the hub-client) and `store` (the memory store).
 */

const NOW = () => Date.now()

// Two accidental sends of the same text to the same chat within this window
// are treated as one. Legitimate repeats after the window are allowed.
const IDEMPOTENCY_WINDOW_MS = 60_000

function contentKey(jid, kind, payload) {
  const body = JSON.stringify(payload || {})
  return `${kind}:${jid}:${hashString(body)}`
}

// FNV-1a 32-bit — good enough for idempotency keys, dependency-free.
function hashString(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * @param {{hub:object, store:object, echoMode?:boolean|(() => boolean)}} deps
 */
export function createOutbox({ hub, store, echoMode }) {
  const echo = () => (typeof echoMode === 'function' ? echoMode() : !!echoMode)

  function bucketKey(key, now) {
    return `${key}#${Math.floor(now / IDEMPOTENCY_WINDOW_MS)}`
  }

  async function send({ jid, kind, payload }) {
    if (!jid) return { ok: false, error: 'recipient jid required' }
    const now = NOW()
    const baseKey = contentKey(jid, kind, payload)
    const key = bucketKey(baseKey, now)

    // Idempotency: an identical send already recorded in this window is refused.
    const existing = store.outboxGet(key)
    if (existing && (existing.status === 'sent' || existing.status === 'delivered' || existing.status === 'read' || existing.status === 'pending')) {
      return {
        ok: false,
        duplicate: true,
        existing: { status: existing.status, at: existing.createdAt },
        message: `Already sent identical ${kind} to ${jid} at ${new Date(existing.createdAt).toISOString()}`,
      }
    }

    const record = {
      key,
      jid,
      kind,
      payload,
      status: echo() ? 'echo' : 'pending',
      hubMessageId: null,
      createdAt: now,
      attempts: 0,
      lastError: null,
    }
    store.outboxPut(key, record)

    if (echo()) {
      record.status = 'echo'
      store.outboxUpdate(key, { status: 'echo' })
      return { ok: true, echo: true, key, message: `[dry-run] would send ${kind} to ${jid}` }
    }

    try {
      const res = await dispatch(hub, kind, { jid, payload })
      record.attempts += 1
      if (res && res.ok) {
        record.status = 'sent'
        record.hubMessageId = extractHubMessageId(res)
        store.outboxUpdate(key, { status: 'sent', hubMessageId: record.hubMessageId, attempts: record.attempts })
        return { ok: true, key, hubMessageId: record.hubMessageId, message: `Sent ${kind} to ${jid}` }
      }
      record.status = 'failed'
      record.lastError = (res && res.status) ? `HTTP ${res.status}` : 'dispatch failed'
      store.outboxUpdate(key, { status: 'failed', lastError: record.lastError, attempts: record.attempts })
      return { ok: false, key, error: record.lastError }
    } catch (err) {
      record.attempts += 1
      record.status = 'failed'
      record.lastError = err && err.message ? err.message : String(err)
      store.outboxUpdate(key, { status: 'failed', lastError: record.lastError, attempts: record.attempts })
      return { ok: false, key, error: record.lastError }
    }
  }

  async function dispatch(hub, kind, { jid, payload }) {
    if (kind === 'text') return hub.sendText(jid, payload.text, payload.quotedId)
    if (kind === 'reaction') return hub.react(jid, payload.messageId, payload.emoji)
    if (kind === 'read') return hub.markRead(jid, payload.messageIds)
    return { ok: false, status: 400, data: { error: `unknown kind ${kind}` } }
  }

  function extractHubMessageId(res) {
    const d = res && res.data
    if (!d) return null
    if (typeof d === 'string') return d
    return d.message_id || d.id || d.key || null
  }

  function pending() {
    return store.outboxEntries()
      .filter(([, r]) => r.status === 'pending' || r.status === 'failed')
      .map(([key, r]) => ({ key, jid: r.jid, kind: r.kind, status: r.status, createdAt: r.createdAt, lastError: r.lastError }))
  }

  return { send, pending, contentKey, hashString }
}
