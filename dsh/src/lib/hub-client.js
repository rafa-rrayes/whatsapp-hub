/**
 * Thin, dependency-free REST client for whatsapp-hub.
 *
 * The plugin is the *signal* layer; whatsapp-hub is the source of truth for
 * content. This client therefore calls the hub's own endpoints and returns
 * normalized `{ ok, status, data }` values, never re-implementing message
 * parsing or rendering.
 *
 * This file is intentionally import-free (except node builtins) so it runs
 * unchanged in the full-Node permanent package. (The dynamic demo re-implements
 * the same contract over the `shell` service — see the demo body.)
 */

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * @typedef {Object} HubClientConfig
 * @property {string} hubUrl   base URL, e.g. "http://127.0.0.1:3100"
 * @property {string} apiKey   x-api-key for outbound calls
 * @property {boolean} echoMode  when true, never hit the network
 */

/**
 * @param {HubClientConfig} config
 */
export function createHubClient(config) {
  const isEcho = () => config.echoMode === true || !config.apiKey

  /**
   * @param {string} method
   * @param {string} path   absolute path, e.g. "/api/chats"
   * @param {*} [body]      JSON-serializable body (only for non-GET)
   * @returns {Promise<{ok:boolean, status:number, data:any}>}
   */
  async function request(method, path, body) {
    if (isEcho()) {
      return { ok: true, status: 0, data: { __echo: true, method, path, body } }
    }
    const base = (config.hubUrl || 'http://127.0.0.1:3100').replace(/\/+$/, '')
    const url = `${base}${path}`
    const headers = { 'content-type': 'application/json' }
    if (config.apiKey) headers['x-api-key'] = config.apiKey

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = text }
      return { ok: res.ok, status: res.status, data }
    } finally {
      clearTimeout(t)
    }
  }

  const get = (path) => request('GET', path)
  const post = (path, body) => request('POST', path, body)

  // ── Read ────────────────────────────────────────────────────────────────
  const overview = () => get('/api/stats')
  const health = () => get('/health')
  /**
   * Rich message analytics for a trailing window. Mirrors the hub's
   * GET /api/stats/analytics — totals carry a sent/received split and, on hub
   * builds with the distinctChats field, the number of distinct chats in the
   * window. Pass `chat` to scope to a single chat.
   * @param {Object} [opts]
   * @param {number} [opts.days] trailing window in days (omit for all-time)
   * @param {string} [opts.chat] chat JID to scope to
   */
  const analytics = (opts = {}) => {
    const p = new URLSearchParams()
    if (opts.days) p.set('days', String(opts.days))
    if (opts.chat) p.set('chat', opts.chat)
    const qs = p.toString()
    return get(`/api/stats/analytics${qs ? `?${qs}` : ''}`)
  }
  const listChats = () => get('/api/chats')
  const getChat = (jid) => get(`/api/chats/${encodeURIComponent(jid)}`)
  const contacts = () => get('/api/contacts')
  const searchMessages = (q, limit = 20) =>
    get(`/api/messages/search?q=${encodeURIComponent(q)}&limit=${limit}`)
  const recentMessages = (opts = {}) => {
    const p = new URLSearchParams()
    if (opts.chat) p.set('chat', opts.chat)
    if (opts.after) p.set('after', String(opts.after))
    if (opts.limit) p.set('limit', String(opts.limit))
    p.set('order', opts.order || 'desc')
    return get(`/api/messages?${p.toString()}`)
  }
  const getMessage = (id) => get(`/api/messages/${encodeURIComponent(id)}`)

  // ── Write ───────────────────────────────────────────────────────────────
  const sendText = (jid, text, quotedId) =>
    post('/api/actions/send/text', { jid, text, ...(quotedId ? { quoted_id: quotedId } : {}) })
  const react = (jid, messageId, emoji) =>
    post('/api/actions/react', { jid, message_id: messageId, emoji })
  const markRead = (jid, messageIds) =>
    post('/api/actions/read', { jid, message_ids: messageIds })

  /**
   * Fuzzy-resolve a name/phone/JID to ranked chat candidates. Faithful to the
   * hub MCP `resolve_contact` intent but implemented over REST: prefer an exact
   * JID, then match chat name / push name / phone suffix.
   * @param {string} query
   * @returns {Promise<{candidates: Array<{jid:string,name:string,score:number}>}>}
   */
  async function resolveChat(query) {
    if (!query || !String(query).trim()) return { candidates: [] }
    const q = String(query).trim()
    const qLower = q.toLowerCase()

    // Exact JID (e.g. "5511...@s.whatsapp.net" or a bare phone number).
    if (/^\d{6,}@s\.whatsapp\.net$/.test(q)) {
      return { candidates: [{ jid: q, name: q, score: 1 }] }
    }
    if (/^\d{6,}$/.test(q)) {
      return { candidates: [{ jid: `${q}@s.whatsapp.net`, name: q, score: 1 }] }
    }

    const results = []
    const push = (jid, name, score) => {
      if (!jid) return
      if (!results.some((r) => r.jid === jid)) results.push({ jid, name: name || jid, score })
    }

    try {
      const chats = await listChats()
      const list = Array.isArray(chats.data) ? chats.data : (chats.data && chats.data.data) || []
      for (const c of list) {
        const jid = c.jid || c.id
        const name = c.name || c.subject || c.push_name || ''
        const nl = String(name).toLowerCase()
        let score = 0
        if (nl === qLower) score = 3
        else if (nl.includes(qLower)) score = 2
        else if (jid && jid.includes(q.replace(/\D/g, ''))) score = 2
        if (score) push(jid, name, score)
      }
    } catch { /* ignore */ }

    try {
      const cs = await contacts()
      const list = Array.isArray(cs.data) ? cs.data : (cs.data && cs.data.data) || []
      for (const c of list) {
        const jid = c.jid || c.id
        const name = c.name || c.notify_name || c.push_name || ''
        const nl = String(name).toLowerCase()
        let score = 0
        if (nl === qLower) score = 3
        else if (nl.includes(qLower)) score = 2
        if (score) push(jid, name, score)
      }
    } catch { /* ignore */ }

    results.sort((a, b) => b.score - a.score)
    return { candidates: results.slice(0, 10) }
  }

  return {
    config,
    request,
    resolveChat,
    overview,
    health,
    analytics,
    listChats,
    getChat,
    contacts,
    searchMessages,
    recentMessages,
    getMessage,
    sendText,
    react,
    markRead,
  }
}
