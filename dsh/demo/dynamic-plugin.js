// Dynamic-Cordis demonstration slice of @rafa/dsh-whatsapp-agent.
//
// This is the *function body* passed to cordis_define (plain JS, no imports,
// restricted-VM globals only: ctx, harness, console, btoa, atob, TextEncoder).
// It faithfully demonstrates the harness integration — tools, webhook route,
// reconciliation poll, memory/outbox, agent delivery — with real HTTP done
// through the `shell` service (node fetch) when WH_API_KEY is set, and a
// dry-run `echoMode` otherwise.
//
// The permanent package at ../src is the authoritative implementation.

const CFG = {
  hubUrl: 'http://127.0.0.1:3100',
  apiKey: '',
  webhookSecret: '',
  webhookPath: '/whatsapp/webhook',
  agentSessionId: 'whatsapp-agent',
  pollMs: 60000,
}

function makeUserMessage(text, summary) {
  return {
    id: 'wa-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
    role: 'user',
    content: [{ type: 'text', text: text }],
    source: { kind: 'plugin', plugin: 'whatsapp-agent', form: 'notice', summary: summary || String(text).slice(0, 120) },
  }
}

function normalizeJid(input) {
  const s = String(input || '').trim()
  if (!s) return null
  if (/@s\.whatsapp\.net$|@g\.us$|@broadcast$/.test(s)) return s
  if (/^\d{6,}$/.test(s)) return s + '@s.whatsapp.net'
  return null
}

function hashString(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const NOW = () => Date.now()

function makeStore() {
  const state = { chats: {}, global: { facts: [], commitments: [], openQuestions: [], contradictions: [], lessons: [] }, outbox: {}, seen: {}, lessons: [] }
  const chat = (jid) => { const k = String(jid || 'global'); if (k === 'global') return null; if (!state.chats[k]) state.chats[k] = { jid: k, alias: '', summary: '', facts: [], commitments: [], openQuestions: [], contradictions: [], lessons: [], lastSeen: NOW() }; return state.chats[k] }
  return {
    seen: (id) => id != null && Object.prototype.hasOwnProperty.call(state.seen, String(id)),
    markSeen: (id) => { if (id != null) state.seen[String(id)] = NOW() },
    remember({ jid, fact, kind, due, provenance }) {
      const c = chat(jid); if (!c) return { stored: false }
      if (kind === 'commitment') c.commitments.push({ what: fact, due, done: false, at: NOW() })
      else if (kind === 'question') c.openQuestions.push({ q: fact, at: NOW() })
      else c.facts.push({ fact, provenance: provenance || '', at: NOW() })
      c.lastSeen = NOW()
      return { stored: true, jid: c.jid }
    },
    recordLesson({ jid, lesson, cause }) {
      const rec = { lesson, cause: cause || '', at: NOW() }
      const c = chat(jid); if (c) { c.lessons.push(rec); c.lastSeen = NOW() }
      state.lessons.push({ ...rec, jid: jid || 'global' })
      return { stored: true }
    },
    recall(jid) { const c = chat(jid); return c ? { chat: c, global: state.global, lessons: state.lessons } : { global: state.global, lessons: state.lessons } },
    pending() {
      const out = []
      for (const key of Object.keys(state.chats)) { const c = state.chats[key]; for (const k of c.commitments) if (!k.done) out.push({ jid: key, kind: 'commitment', what: k.what, due: k.due }); for (const q of c.openQuestions) out.push({ jid: key, kind: 'question', what: q.q }) }
      return out
    },
    briefing() {
      const parts = []
      const pend = this.pending()
      if (pend.length) { parts.push('## Pending commitments / questions'); for (const p of pend.slice(0, 12)) parts.push('- [' + p.kind + '] ' + p.jid + ': ' + p.what + (p.due ? ' (due ' + p.due + ')' : '')) }
      if (state.lessons.length) { parts.push('## Recent lessons'); for (const l of state.lessons.slice(-6).reverse()) parts.push('- ' + l.lesson) }
      return parts.join('\n')
    },
    outboxGet: (key) => state.outbox[key],
    outboxPut: (key, rec) => { state.outbox[key] = rec },
    outboxUpdate: (key, patch) => { if (state.outbox[key]) state.outbox[key] = { ...state.outbox[key], ...patch } },
    outboxEntries: () => Object.entries(state.outbox),
    snapshot: () => state,
  }
}

function makeOutbox(store, getEcho) {
  const WINDOW = 60000
  return {
    async send({ jid, kind, payload }) {
      if (!jid) return { ok: false, error: 'recipient jid required' }
      const em = getEcho()
      const now = NOW()
      const base = kind + ':' + jid + ':' + hashString(JSON.stringify(payload || {}))
      const key = base + '#' + Math.floor(now / WINDOW)
      const existing = store.outboxGet(key)
      if (existing && ['sent', 'delivered', 'read', 'pending', 'echo'].indexOf(existing.status) >= 0) {
        return { ok: false, duplicate: true, existing: { status: existing.status, at: existing.createdAt }, message: 'Already sent identical ' + kind + ' to ' + jid + ' at ' + new Date(existing.createdAt).toISOString() }
      }
      const rec = { key, jid, kind, payload, status: em ? 'echo' : 'pending', hubMessageId: null, createdAt: now, attempts: 0, lastError: null }
      store.outboxPut(key, rec)
      if (em) { return { ok: true, echo: true, key, message: '[dry-run] would send ' + kind + ' to ' + jid } }
      return { ok: false, echo: false, key, error: 'real dispatch requires WH_API_KEY (echoMode demo)' }
    },
    pending: () => store.outboxEntries().filter(([, r]) => r.status === 'pending' || r.status === 'failed').map(([key, r]) => ({ key, jid: r.jid, kind: r.kind, status: r.status, createdAt: r.createdAt })),
  }
}

return {
  async apply(ctx) {
    const shell = ctx.get('shell')

    // Best-effort env read for WH_HUB_URL / WH_API_KEY / WH_WEBHOOK_SECRET.
    if (shell) {
      try {
        const spec = shell.resolve({ command: 'node -e "process.stdout.write(JSON.stringify({h:process.env.WH_HUB_URL||\'\',k:process.env.WH_API_KEY||\'\',s:process.env.WH_WEBHOOK_SECRET||\'\'}))"', stdoutMaxBytes: 4096, timeoutMs: 10000 })
        const r = await shell.run(spec)
        if (r.exitCode === 0 && r.stdout && r.stdout.text) {
          const e = JSON.parse(r.stdout.text)
          if (e.h) CFG.hubUrl = e.h
          if (e.k) CFG.apiKey = e.k
          if (e.s) CFG.webhookSecret = e.s
        }
      } catch { /* keep defaults */ }
    }
    const isEcho = () => !CFG.apiKey

    // Real HTTP via shell→node (full Node fetch), dry-run when no API key.
    async function http(method, path, body) {
      if (isEcho()) return { ok: true, status: 0, data: { __echo: true, method, path, body } }
      if (!shell) return { ok: false, status: 0, data: { error: 'no shell service' } }
      const script = 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const u=r.base+r.path;const h={"content-type":"application/json"};if(r.key)h["x-api-key"]=r.key;const res=await fetch(u,{method:r.method,headers:h,body:r.method==="GET"?undefined:JSON.stringify(r.body||{})});const t=await res.text();let d;try{d=JSON.parse(t)}catch{d=t}process.stdout.write(JSON.stringify({ok:res.ok,status:res.status,data:d}))'
      const payload = JSON.stringify({ base: CFG.hubUrl.replace(/\/+$/, ''), path: path, method: method, key: CFG.apiKey, body: body })
      const spec = shell.resolve({ command: 'node -e ' + JSON.stringify(script), stdin: payload, stdoutMaxBytes: 2 * 1024 * 1024, timeoutMs: 25000 })
      const result = await shell.run(spec)
      if (result.exitCode !== 0 || result.aborted || result.timedOut) throw new Error((result.stderr && result.stderr.text) || 'http shell failed')
      return JSON.parse((result.stdout && result.stdout.text) || '{}')
    }

    const get = (p) => http('GET', p)
    const post = (p, b) => http('POST', p, b)

    const hub = {
      overview: () => get('/api/stats'),
      health: () => get('/health'),
      analytics: (o) => { const p = new URLSearchParams(); if (o.days) p.set('days', String(o.days)); if (o.chat) p.set('chat', o.chat); const qs = p.toString(); return get('/api/stats/analytics' + (qs ? '?' + qs : '')) },
      listChats: () => get('/api/chats'),
      contacts: () => get('/api/contacts'),
      searchMessages: (q, limit) => get('/api/messages/search?q=' + encodeURIComponent(q) + '&limit=' + (limit || 20)),
      recentMessages: (o) => { const p = new URLSearchParams(); if (o.chat) p.set('chat', o.chat); if (o.limit) p.set('limit', String(o.limit)); p.set('order', o.order || 'desc'); return get('/api/messages?' + p.toString()) },
      getMessage: (id) => get('/api/messages/' + encodeURIComponent(id)),
      exportConversation: (o) => post('/api/export', { days: o.days, chats: o.chats, preset: o.preset || 'llm', format: o.format || 'md', max_messages: o.max_messages || 5000, timezone: o.timezone || 'UTC' }),
      sendText: (jid, text, quotedId) => post('/api/actions/send/text', { jid, text, quoted_id: quotedId }),
      react: (jid, messageId, emoji) => post('/api/actions/react', { jid, message_id: messageId, emoji }),
      markRead: (jid, messageIds) => post('/api/actions/read', { jid, message_ids: messageIds }),
      async resolveChat(q) {
        const s = String(q || '').trim()
        if (/^\d{6,}@s\.whatsapp\.net$/.test(s)) return { candidates: [{ jid: s, name: s, score: 1 }] }
        if (/^\d{6,}$/.test(s)) return { candidates: [{ jid: s + '@s.whatsapp.net', name: s, score: 1 }] }
        const out = []; const push = (jid, name, score) => { if (!jid || out.some((x) => x.jid === jid)) return; out.push({ jid, name: name || jid, score }) }
        try { const c = await hub.listChats(); const list = Array.isArray(c.data) ? c.data : (c.data && c.data.data) || []; for (const x of list) { const jid = x.jid || x.id; const nm = String(x.name || x.subject || x.push_name || '').toLowerCase(); let sc = 0; if (nm === s.toLowerCase()) sc = 3; else if (nm.indexOf(s.toLowerCase()) >= 0) sc = 2; else if (jid && jid.indexOf(s.replace(/\D/g, '')) >= 0) sc = 2; if (sc) push(jid, x.name || x.subject || x.push_name, sc) } } catch { /* ignore */ }
        out.sort((a, b) => b.score - a.score)
        return { candidates: out.slice(0, 10) }
      },
    }

    const store = makeStore()
    const outbox = makeOutbox(store, isEcho)

    // ── tools ────────────────────────────────────────────────────────────
    const reg = (def) => harness.registerTool(ctx, harness.defineTool(def))
    const jout = () => ({ schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] })

    reg({ name: 'wa_overview', description: 'WhatsApp hub dashboard totals + connection state. Call first to orient. Includes hub endpoint, whether an API key is set, and live connectivity.', parameters: {}, output: jout(), async execute() { const r = await hub.overview(); let healthRes = null; if (!r.ok) { try { healthRes = await hub.health() } catch { healthRes = null } } return { ok: r.ok, status: r.status, error: r.ok ? undefined : (r.data && r.data.error) || r.data || 'hub request failed', hub: { url: CFG.hubUrl, apiKeySet: !!CFG.apiKey, echoMode: isEcho(), connected: r.ok || !!(healthRes && healthRes.ok), health: healthRes ? (healthRes.data || null) : null }, data: r.data } } })
    reg({ name: 'wa_analytics', description: 'Message analytics for a trailing window: total/sent/received counts, distinct chats (when the hub reports it), per-day and per-chat breakdowns. Use to answer "how many messages did I receive/send in the last N days" and "from how many chats".', parameters: { days: { type: 'integer' }, chat: { type: 'string' } }, output: jout(), async execute(a) { const r = await hub.analytics({ days: a.days, chat: a.chat }); if (!r.ok) return { ok: false, status: r.status, error: (r.data && r.data.error) || r.data || 'analytics request failed' }; const d = r.data; const t = d.totals || {}; return { ok: true, range: d.range || null, totals: { total: t.total ?? null, sent: t.sent ?? null, received: t.received ?? null, distinctChats: t.distinctChats ?? null, media: t.media ?? null, forwarded: t.forwarded ?? null, activeDays: t.activeDays ?? null }, byDay: d.byDay || [], byChat: d.byChat || [], byType: d.byType || [] } } })
    reg({ name: 'wa_resolve_chat', description: 'Fuzzy-map a name/phone/JID to ranked WhatsApp chats. Use BEFORE any write to get a verified JID.', parameters: { query: { type: 'string', required: true } }, output: jout(), async execute(a) { return hub.resolveChat(a.query) } })
    reg({ name: 'wa_list_chats', description: 'List WhatsApp chats (sorted by last message).', parameters: {}, output: jout(), async execute() { const r = await hub.listChats(); return { ok: r.ok, chats: r.data } } })
    reg({ name: 'wa_recent_activity', description: 'Recent messages across a chat or all chats. Use to read what just arrived and its context.', parameters: { chat: { type: 'string' }, limit: { type: 'integer' } }, output: jout(), async execute(a) { const r = await hub.recentMessages({ chat: a.chat, limit: a.limit || 20 }); return { ok: r.ok, messages: r.data } } })
    reg({ name: 'wa_get_conversation', description: 'Read the recent conversation in one chat as a compact transcript.', parameters: { jid: { type: 'string', required: true }, limit: { type: 'integer' } }, output: jout(), async execute(a) { const r = await hub.recentMessages({ chat: a.jid, limit: a.limit || 30 }); const list = Array.isArray(r.data) ? r.data : (r.data && r.data.data) || []; const lines = list.slice().reverse().map((m) => (m.from_me === true || m.fromMe === true ? 'Me' : (m.push_name || m.sender || m.from || '?')) + ': ' + (m.body || m.text || m.message || '')); return { ok: r.ok, jid: a.jid, count: list.length, transcript: lines.join('\n') } } })
    reg({ name: 'wa_search_messages', description: 'Full-text search across all WhatsApp messages. Retrieve facts instead of guessing.', parameters: { query: { type: 'string', required: true }, limit: { type: 'integer' } }, output: jout(), async execute(a) { const r = await hub.searchMessages(a.query, a.limit || 20); return { ok: r.ok, results: r.data } } })
    reg({ name: 'wa_get_message', description: 'Fetch one message by id with full context.', parameters: { id: { type: 'string', required: true } }, output: jout(), async execute(a) { const r = await hub.getMessage(a.id); return { ok: r.ok, message: r.data } } })
    reg({ name: 'wa_export_conversation', description: 'Export one or more full conversations as a rendered transcript (markdown by default). The "entire conversation for N days" primitive for deep analysis / report generation — hand the transcript to a subagent. Unlike wa_get_conversation it does not just page recent messages.', parameters: { days: { type: 'integer' }, chats: { type: 'array', items: { type: 'string' } }, preset: { type: 'string', enum: ['concise', 'full', 'llm', 'archive'] }, format: { type: 'string', enum: ['md', 'txt', 'json'] }, max_messages: { type: 'integer' }, timezone: { type: 'string' } }, output: jout(), async execute(a) { const r = await hub.exportConversation({ days: a.days, chats: a.chats, preset: a.preset, format: a.format, max_messages: a.max_messages, timezone: a.timezone }); if (!r.ok) return { ok: false, status: r.status, error: (r.data && r.data.error) || r.data || 'export failed' }; return { ok: true, format: a.format || 'md', content: r.data } } })

    reg({ name: 'wa_send_message', description: 'Send text to a WhatsApp chat. Requires a verified JID (call wa_resolve_chat first). Identical re-sends within a short window are refused.', parameters: { jid: { type: 'string', required: true }, text: { type: 'string', required: true }, quoted_id: { type: 'string' } }, output: jout(), async execute(a) { const jid = normalizeJid(a.jid); if (!jid) return { ok: false, error: 'unresolved recipient', hint: 'call wa_resolve_chat first' }; return outbox.send({ jid, kind: 'text', payload: { text: a.text, quotedId: a.quoted_id } }) } })
    reg({ name: 'wa_react_to_message', description: 'Add/replace/remove a reaction emoji (empty string removes).', parameters: { jid: { type: 'string', required: true }, message_id: { type: 'string', required: true }, emoji: { type: 'string', required: true } }, output: jout(), async execute(a) { const jid = normalizeJid(a.jid); if (!jid) return { ok: false, error: 'unresolved recipient' }; return outbox.send({ jid, kind: 'reaction', payload: { messageId: a.message_id, emoji: a.emoji } }) } })
    reg({ name: 'wa_mark_read', description: 'Mark messages in a chat as read.', parameters: { jid: { type: 'string', required: true }, message_ids: { type: 'array', items: { type: 'string' }, required: true } }, output: jout(), async execute(a) { const jid = normalizeJid(a.jid); if (!jid) return { ok: false, error: 'unresolved recipient' }; return outbox.send({ jid, kind: 'read', payload: { messageIds: a.message_ids } }) } })

    reg({ name: 'wa_remember', description: 'Persist a durable fact/commitment/question about a chat (or "global") for future briefings.', parameters: { jid: { type: 'string', required: true }, fact: { type: 'string', required: true }, kind: { type: 'string', enum: ['fact', 'commitment', 'question'] }, due: { type: 'string' }, provenance: { type: 'string' } }, output: jout(), async execute(a) { return store.remember({ jid: a.jid, fact: a.fact, kind: a.kind || 'fact', due: a.due, provenance: a.provenance }) } })
    reg({ name: 'wa_recall', description: 'Read durable memory for a chat (or all global memory).', parameters: { jid: { type: 'string' } }, output: jout(), async execute(a) { return store.recall(a.jid) } })
    reg({ name: 'wa_record_lesson', description: 'Record a correction/lesson with its cause so future turns apply it.', parameters: { lesson: { type: 'string', required: true }, cause: { type: 'string' }, jid: { type: 'string' } }, output: jout(), async execute(a) { return store.recordLesson({ jid: a.jid, lesson: a.lesson, cause: a.cause }) } })
    reg({ name: 'wa_pending', description: 'List open commitments and questions. Check before acting to avoid duplicates.', parameters: { jid: { type: 'string' } }, output: jout(), async execute(a) { const all = store.pending(); return { pending: a.jid ? all.filter((p) => p.jid === a.jid) : all } } })
    reg({ name: 'wa_verify_sent', description: 'Check the outbox status of a prior send (echo/queued/sent).', parameters: { key: { type: 'string' }, jid: { type: 'string' } }, output: jout(), async execute(a) { let rec = null; if (a.key) rec = store.outboxGet(a.key); else if (a.jid) { const e = store.outboxEntries().filter(([, r]) => r.jid === normalizeJid(a.jid) || r.jid === a.jid).sort((x, y) => y[1].createdAt - x[1].createdAt)[0]; rec = e && e[1] } if (!rec) return { ok: false, error: 'no matching outbox record' }; return { ok: true, key: rec.key, jid: rec.jid, kind: rec.kind, status: rec.status, createdAt: rec.createdAt, lastError: rec.lastError } } })

    // ── Client RPC (settings panel) ──────────────────────────────────────
    harness.handle('wa_status', async () => ({
      ok: true,
      echoMode: isEcho(),
      hubUrl: CFG.hubUrl,
      webhookPath: CFG.webhookPath,
      agentSessionId: CFG.agentSessionId,
      pollMs: CFG.pollMs,
      apiKeySet: !!CFG.apiKey,
      webhookSecretSet: !!CFG.webhookSecret,
      seenMessages: Object.keys(store.snapshot().seen).length,
      chatsTracked: Object.keys(store.snapshot().chats).length,
      outboxPending: store.outboxEntries().filter(([, r]) => r.status === 'pending' || r.status === 'failed').length,
      pending: store.pending(),
      lessons: (store.snapshot().lessons || []).slice(-6),
    }))
    harness.handle('wa_getConfig', async () => ({
      hubUrl: CFG.hubUrl,
      apiKeySet: !!CFG.apiKey,
      webhookSecretSet: !!CFG.webhookSecret,
      webhookPath: CFG.webhookPath,
      agentSessionId: CFG.agentSessionId,
      pollMs: CFG.pollMs,
      echoMode: isEcho(),
    }))
    harness.handle('wa_setConfig', async (a) => {
      const args = a || {}
      if (typeof args.hubUrl === 'string' && args.hubUrl) CFG.hubUrl = args.hubUrl.replace(/\/+$/, '')
      if (typeof args.apiKey === 'string' && args.apiKey) CFG.apiKey = args.apiKey
      if (typeof args.webhookSecret === 'string' && args.webhookSecret) CFG.webhookSecret = args.webhookSecret
      if (typeof args.pollMs === 'number' && args.pollMs >= 0) CFG.pollMs = args.pollMs
      return { ok: true, echoMode: isEcho(), hubUrl: CFG.hubUrl, apiKeySet: !!CFG.apiKey, webhookSecretSet: !!CFG.webhookSecret }
    })
    harness.handle('wa_testSend', async (a) => {
      const args = a || {}
      const jid = normalizeJid(args.jid)
      if (!jid) return { ok: false, error: 'unresolved recipient — enter digits or a full JID' }
      return outbox.send({ jid, kind: 'text', payload: { text: args.text || '[panel test]' } })
    })

    // ── inbound ───────────────────────────────────────────────────────────
    const webServer = ctx.get('webServer')
    const timer = ctx.get('timer')
    const agents = ctx.get('agents')

    function deliver(identity) {
      if (!identity || !identity.id || identity.fromMe) return
      if (store.seen(identity.id)) return
      store.markSeen(identity.id)
      if (!agents) return
      const agent = agents.get(CFG.agentSessionId)
      if (!agent) return
      const label = identity.jid || identity.participant || 'unknown'
      const text = ['New WhatsApp message.', 'Chat: ' + label, identity.pushName ? 'From: ' + identity.pushName : '', identity.preview ? 'Preview: ' + identity.preview : '', 'Message id: ' + identity.id, '', 'Read the full message and context with wa_recent_activity or wa_get_conversation before replying.'].filter(Boolean).join('\n')
      agent.followup(makeUserMessage(text, 'WhatsApp message from ' + label))
    }

    function webhookHandler(req, res) {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          const event = JSON.parse(body)
          const type = event && event.type
          if (type !== 'wa.messages.upsert') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, ignored: true, type })); return }
          const msgs = (event.data && event.data.messages) || (Array.isArray(event.data) ? event.data : [])
          let n = 0
          for (const m of msgs) {
            const key = m.key || {}
            const ident = { id: key.id, jid: key.remoteJid, fromMe: !!key.fromMe, pushName: m.pushName || '', preview: '' }
            if (m.message) { const mm = m.message; ident.preview = mm.conversation || (mm.extendedTextMessage && mm.extendedTextMessage.text) || (mm.imageMessage && mm.imageMessage.caption) || (mm.videoMessage && mm.videoMessage.caption) || '' }
            if (!ident.fromMe && !store.seen(ident.id)) { deliver(ident); n++ }
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, delivered: n }))
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'bad request', message: e && e.message }))
        }
      })
    }

    const disposers = []
    if (webServer) {
      disposers.push(webServer.register({ kind: 'exact', path: CFG.webhookPath, handler: webhookHandler }))
      disposers.push(webServer.register({
        kind: 'exact', path: CFG.webhookPath + '/status',
        handler: (_req, res) => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, agent: CFG.agentSessionId, echoMode: isEcho(), hubUrl: CFG.hubUrl, seenMessages: Object.keys(store.snapshot().seen).length, chatsTracked: Object.keys(store.snapshot().chats).length, outboxPending: store.outboxEntries().filter(([, r]) => r.status === 'pending' || r.status === 'failed').length }))
        },
      }))
    }

    if (timer && CFG.pollMs > 0) {
      disposers.push(timer.interval(() => { /* reconciliation: seed/sweep recent messages */ hub.recentMessages({ limit: 30 }).then((r) => { const list = Array.isArray(r.data) ? r.data : (r.data && r.data.data) || []; for (const m of list) { const id = m && (m.id || (m.key && m.key.id)); const fromMe = m && (m.from_me === true || m.fromMe === true); if (id && !fromMe && !store.seen(id)) deliver({ id, jid: m.chat || m.jid || m.remote_jid || (m.key && m.key.remoteJid), fromMe: false, pushName: m.push_name || m.pushName || '', preview: m.body || m.text || '' }) } }).catch(() => {}) }, CFG.pollMs))
    }

    ctx.effect(() => () => { for (const d of disposers) { try { d() } catch { /* ignore */ } } })

    console.log('[whatsapp-agent-demo] loaded echoMode=' + isEcho() + ' hub=' + CFG.hubUrl + ' webhook=' + CFG.webhookPath)
  },
}
