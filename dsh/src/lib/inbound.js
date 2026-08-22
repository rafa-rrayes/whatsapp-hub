/**
 * Inbound receiver: HMAC-verified webhook + reconciliation poll.
 *
 * The webhook is the *signal* ("something happened at chat/message"), not the
 * content. Content is fetched later by the agent through the hub's renderers.
 * The reconciliation poll is the backstop that replays the same signal from the
 * REST API when a webhook is lost (hub or DSH restart, network blip).
 *
 * Full-Node build: HMAC uses node:crypto. The dynamic demo re-implements
 * `verifySignature` over the shell service (or skips it when no secret/secret
 * tooling is available).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const RELEVANT_TYPES = new Set(['wa.messages.upsert'])

function verifySignature(rawBody, secret, header) {
  if (!secret) return true // no secret configured → not verifying
  if (!header || typeof header !== 'string') return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const provided = header.replace(/^sha256=/, '')
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Best-effort text preview from a Baileys-style WAMessage. Never throws. */
function previewText(msg) {
  try {
    if (!msg || !msg.message) return ''
    const m = msg.message
    if (m.conversation) return m.conversation
    if (m.extendedTextMessage && m.extendedTextMessage.text) return m.extendedTextMessage.text
    if (m.imageMessage && m.imageMessage.caption) return `[image] ${m.imageMessage.caption}`
    if (m.videoMessage && m.videoMessage.caption) return `[video] ${m.videoMessage.caption}`
    if (m.documentMessage) return `[document] ${m.documentMessage.fileName || ''}`
    if (m.audioMessage) return '[audio]'
    if (m.stickerMessage) return '[sticker]'
    if (m.locationMessage) return '[location]'
    if (m.contactMessage) return '[contact]'
    if (m.pollCreationMessage) return '[poll]'
    const type = Object.keys(m).find((k) => k.endsWith('Message')) || 'message'
    return `[${type.replace(/Message$/, '')}]`
  } catch {
    return ''
  }
}

function extractIdentity(event) {
  const data = event && event.data
  const messages = (data && data.messages) || (Array.isArray(data) ? data : [])
  const out = []
  for (const msg of messages) {
    try {
      const key = msg.key || {}
      out.push({
        id: key.id,
        jid: key.remoteJid || data.remoteJid || null,
        fromMe: !!key.fromMe,
        participant: key.participant || null,
        pushName: msg.pushName || '',
        timestamp: msg.messageTimestamp || event.timestamp || Date.now(),
        preview: previewText(msg),
      })
    } catch {
      /* skip malformed */
    }
  }
  return out
}

/**
 * @param {object} deps
 * @param {{get:(name:string)=>any}} deps.ctx
 * @param {object} deps.config   { webhookPath, webhookSecret, pollMs, agentSessionId }
 * @param {object} deps.hub      hub-client
 * @param {object} deps.store    memory store
 * @param {(notice:object)=>void} deps.onMessage
 */
export function createInbound({ ctx, config, hub, store, onMessage }) {
  let firstPoll = true

  function deliver(identity) {
    if (!identity || !identity.id) return
    if (identity.fromMe) return // our own sends are not inbound instructions
    if (store.seen(identity.id)) return
    store.markSeen(identity.id)
    onMessage(identity)
  }

  // ── webhook ──────────────────────────────────────────────────────────────
  function webhookHandler(req, res) {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const secret = config.webhookSecret || ''
        const sig = req.headers['x-hub-signature']
        if (!verifySignature(body, secret, sig)) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid signature' }))
          return
        }
        const event = JSON.parse(body)
        const type = event && event.type
        if (!RELEVANT_TYPES.has(type)) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, ignored: true, type }))
          return
        }
        let count = 0
        for (const identity of extractIdentity(event)) {
          if (identity.fromMe) continue
          if (store.seen(identity.id)) continue
          deliver(identity)
          count++
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, delivered: count }))
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'bad request', message: err && err.message }))
      }
    })
  }

  function registerWebhook(webServer) {
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: config.webhookPath || '/whatsapp/webhook',
      handler: webhookHandler,
    })
  }

  // ── reconciliation poll ─────────────────────────────────────────────────
  async function reconcile() {
    try {
      const res = await hub.recentMessages({ limit: 30, order: 'desc' })
      const list = Array.isArray(res.data) ? res.data : (res.data && res.data.data) || []
      if (firstPoll) {
        // Seed the seen-set from current history without delivering, so a
        // restart never replays old traffic.
        for (const m of list) {
          const id = m && (m.id || (m.key && m.key.id))
          if (id && !(m.from_me === true || m.fromMe === true)) store.markSeen(id)
        }
        firstPoll = false
        return
      }
      for (const m of list) {
        const id = m && (m.id || (m.key && m.key.id))
        const fromMe = m && (m.from_me === true || m.fromMe === true)
        if (!id || fromMe) continue
        if (!store.seen(id)) {
          deliver({
            id,
            jid: m.chat || m.jid || m.remote_jid || (m.key && m.key.remoteJid) || null,
            fromMe: false,
            pushName: m.push_name || m.pushName || '',
            timestamp: (m.timestamp || m.ts || Date.now()),
            preview: m.body || m.text || '',
          })
        }
      }
    } catch (err) {
      console.error('[whatsapp-agent] reconcile failed', err && err.message)
    }
  }

  function registerPoll(timer) {
    if (!timer || !(config.pollMs > 0)) return () => {}
    const clear = timer.interval(() => { reconcile().catch(() => {}) }, config.pollMs)
    return clear
  }

  return { webhookHandler, registerWebhook, registerPoll, reconcile, deliver, verifySignature, extractIdentity }
}
