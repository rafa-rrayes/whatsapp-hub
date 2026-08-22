/**
 * @rafa/dsh-whatsapp-agent — the DeepSeek Harness ⇄ WhatsApp seam.
 *
 * A Host Cordis plugin with ZERO runtime dependencies (node builtins + relative
 * modules only — no `@deepseek-ai/*` imports), so it installs into a profile's
 * node_modules exactly like `dsh-memory-evolve`. Tools register through the
 * raw `ctx.tools.register` contract; config is a plain object resolved from
 * the composition row.
 *
 * It turns WhatsApp traffic into agent turns and agent decisions into verified
 * WhatsApp sends, and owns the durable reliability machinery:
 *
 *   - inbound webhook receiver (HMAC) + reconciliation poll (at-least-once),
 *   - inbound dedup by message id,
 *   - write-ahead outbox with idempotency + verification,
 *   - durable per-chat / cross-chat memory + situational briefing,
 *   - a dedicated persistent agent with the reliability operating contract,
 *   - a same-origin settings panel API (`/whatsapp/panel/*`).
 *
 * See ../DESIGN.md for the full model.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { createHubClient } from './lib/hub-client.js'
import { createMemoryStore } from './lib/memory-store.js'
import { createOutbox } from './lib/outbox.js'
import { createInbound } from './lib/inbound.js'
import { OPERATING_CONTRACT } from './lib/operating-contract.js'

const DEFAULTS = {
  hubUrl: 'http://127.0.0.1:3100',
  apiKey: '',
  webhookSecret: '',
  webhookPath: '/whatsapp/webhook',
  agentSessionId: 'whatsapp-agent',
  agentPreset: '',
  model: '',
  provider: '',
  pollMs: 60000,
  stateFile: '.whatsapp-agent-state.json',
  echoMode: false,
}

function resolveConfig(raw = {}) {
  return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
}

// ── helpers ────────────────────────────────────────────────────────────────

function makeUserMessage(text, summary) {
  return {
    id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'whatsapp-agent', form: 'notice', summary: summary || String(text).slice(0, 120) },
  }
}

/** Normalize a recipient to a WhatsApp JID, or return null when it needs resolving first. */
function normalizeJid(input) {
  const s = String(input || '').trim()
  if (!s) return null
  if (/@s\.whatsapp\.net$|@g\.us$|@broadcast$/.test(s)) return s
  if (/^\d{6,}$/.test(s)) return `${s}@s.whatsapp.net`
  return null // a bare name — the agent must call wa_resolve_chat first
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c) => { body += c })
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })
}

function sendJson(res, code, value) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

/** Build a raw ToolDefinition from a flat, DSL-style params map. */
function rawTool(name, description, params, execute) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(params || {})) {
    const { required: req, ...rest } = spec
    properties[key] = rest
    if (req) required.push(key)
  }
  return {
    name,
    description,
    parameters: { type: 'object', properties, required },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute,
  }
}

// ── persistence ────────────────────────────────────────────────────────────

async function makePersistence(config) {
  const file = config.stateFile
  if (!file) return { load: async () => ({}), save: async () => {} }
  return {
    load: async () => {
      try { return JSON.parse(await readFile(file, 'utf8')) } catch { return {} }
    },
    save: async (state) => {
      try {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(state), 'utf8')
      } catch (err) {
        console.error('[whatsapp-agent] state write failed', err && err.message)
      }
    },
  }
}

// ── tools ──────────────────────────────────────────────────────────────────

function registerTools(ctx, { hub, store, outbox, config }) {
  const register = (tool) => ctx.tools.register(tool)

  register(rawTool('wa_overview', 'WhatsApp hub dashboard totals + connection state. Call first to orient before any other WhatsApp work. Includes the hub endpoint the plugin is wired to, whether an API key is set, and live connectivity (health probe).', {}, async () => {
    const res = await hub.overview()
    let healthRes = null
    if (!res.ok) {
      // The stats call already failed — still probe /health (no auth) to
      // distinguish "hub down" from "auth rejected".
      try { healthRes = await hub.health() } catch { healthRes = null }
    }
    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? undefined : (res.data && res.data.error) || res.data || 'hub request failed',
      hub: {
        url: hub.config.hubUrl,
        apiKeySet: !!hub.config.apiKey,
        echoMode: hub.config.echoMode === true || !hub.config.apiKey,
        connected: res.ok || !!(healthRes && healthRes.ok),
        health: healthRes ? (healthRes.data || null) : null,
      },
      data: res.data,
    }
  }))

  register(rawTool('wa_analytics', 'Message analytics for a trailing window: total/sent/received counts, distinct chats (when the hub reports it), per-day and per-chat breakdowns. Use to answer "how many messages did I receive/send in the last N days" and "from how many chats" without paging through messages.', {
    days: { type: 'integer', description: 'Trailing window in days (e.g. 7). Omit for all-time analytics.' },
    chat: { type: 'string', description: 'Optional chat JID to scope analytics to a single chat.' },
  }, async (args) => {
    const res = await hub.analytics({ days: args.days, chat: args.chat })
    if (!res.ok) return { ok: false, status: res.status, error: (res.data && res.data.error) || res.data || 'analytics request failed' }
    const d = res.data
    const totals = d.totals || {}
    return {
      ok: true,
      range: d.range || null,
      totals: {
        total: totals.total ?? null,
        sent: totals.sent ?? null,
        received: totals.received ?? null,
        distinctChats: totals.distinctChats ?? null,
        media: totals.media ?? null,
        forwarded: totals.forwarded ?? null,
        activeDays: totals.activeDays ?? null,
      },
      byDay: d.byDay || [],
      byChat: d.byChat || [],
      byType: d.byType || [],
    }
  }))

  register(rawTool('wa_resolve_chat', 'Fuzzy-map a name, phone number, or JID to ranked WhatsApp chat candidates. Use this BEFORE any write to obtain a verified recipient JID.', {
    query: { type: 'string', description: 'Name, phone number, or JID to resolve.', required: true },
  }, async (args) => hub.resolveChat(args.query)))

  register(rawTool('wa_list_chats', 'List WhatsApp chats (sorted by last message).', {}, async () => {
    const r = await hub.listChats()
    return { ok: r.ok, chats: r.data }
  }))

  register(rawTool('wa_recent_activity', 'Recent messages across a chat or all chats. Use to read what just arrived and its context.', {
    chat: { type: 'string', description: 'Optional chat JID to restrict to.' },
    limit: { type: 'integer', description: 'Max messages (default 20).' },
  }, async (args) => {
    const r = await hub.recentMessages({ chat: args.chat, limit: args.limit || 20, order: 'desc' })
    return { ok: r.ok, messages: r.data }
  }))

  register(rawTool('wa_get_conversation', 'Read the recent conversation in one chat as a compact transcript. Primary grounding tool for a specific chat.', {
    jid: { type: 'string', description: 'Chat JID.', required: true },
    limit: { type: 'integer', description: 'Max messages (default 30).' },
  }, async (args) => {
    const r = await hub.recentMessages({ chat: args.jid, limit: args.limit || 30, order: 'desc' })
    const list = Array.isArray(r.data) ? r.data : (r.data && r.data.data) || []
    const lines = list.slice().reverse().map((m) => {
      const who = m.from_me === true || m.fromMe === true ? 'Me' : (m.push_name || m.sender || m.from || '?')
      const body = m.body || m.text || m.message || ''
      return `${who}: ${body}`
    })
    return { ok: r.ok, jid: args.jid, count: list.length, transcript: lines.join('\n') }
  }))

  register(rawTool('wa_search_messages', 'Full-text search across all WhatsApp messages. Use to retrieve facts instead of guessing.', {
    query: { type: 'string', description: 'Search text.', required: true },
    limit: { type: 'integer', description: 'Max results (default 20).' },
  }, async (args) => {
    const r = await hub.searchMessages(args.query, args.limit || 20)
    return { ok: r.ok, results: r.data }
  }))

  register(rawTool('wa_export_conversation', 'Export one or more full conversations as a rendered transcript (markdown by default) through the hub export pipeline. This is the "entire conversation for N days" primitive for deep analysis — unlike wa_get_conversation, which only pages recent messages. Returns the transcript inline; use it to hand a whole chat to a subagent for analysis or report generation.', {
    days: { type: 'integer', description: 'Trailing window in days. Omit for all-time.' },
    chats: { type: 'array', items: { type: 'string' }, description: 'Optional list of chat JIDs to export. Omit for all chats in the window.' },
    preset: { type: 'string', enum: ['concise', 'full', 'llm', 'archive'], description: 'Field bundle per message. Default llm.' },
    format: { type: 'string', enum: ['md', 'txt', 'json'], description: 'Output format. Default md.' },
    max_messages: { type: 'integer', description: 'Hard cap on total messages across chats (default 5000).' },
    timezone: { type: 'string', description: 'IANA timezone for timestamps. Default UTC.' },
  }, async (args) => {
    const res = await hub.exportConversation({
      days: args.days,
      chats: args.chats,
      preset: args.preset,
      format: args.format,
      max_messages: args.max_messages,
      timezone: args.timezone,
    })
    if (!res.ok) return { ok: false, status: res.status, error: (res.data && res.data.error) || res.data || 'export failed' }
    return { ok: true, format: args.format || 'md', content: res.data }
  }))

  register(rawTool('wa_get_message', 'Fetch one message by id with full context.', {
    id: { type: 'string', description: 'Message id.', required: true },
  }, async (args) => {
    const r = await hub.getMessage(args.id)
    return { ok: r.ok, message: r.data }
  }))

  register(rawTool('wa_send_message', 'Send a text message to a WhatsApp chat. Requires a verified JID (call wa_resolve_chat first). Identical re-sends within a short window are refused to avoid duplicates.', {
    jid: { type: 'string', description: 'Recipient JID (e.g. 5511...@s.whatsapp.net).', required: true },
    text: { type: 'string', description: 'Message text.', required: true },
    quoted_id: { type: 'string', description: 'Optional message id to reply-quote.' },
  }, async (args) => {
    const jid = normalizeJid(args.jid)
    if (!jid) return { ok: false, error: 'unresolved recipient', hint: 'Call wa_resolve_chat with the name/phone first, then use the returned JID.' }
    return outbox.send({ jid, kind: 'text', payload: { text: args.text, quotedId: args.quoted_id } })
  }))

  register(rawTool('wa_react_to_message', 'Add, replace, or remove a reaction emoji on a message (empty emoji removes).', {
    jid: { type: 'string', description: 'Chat JID.', required: true },
    message_id: { type: 'string', description: 'Target message id.', required: true },
    emoji: { type: 'string', description: 'Emoji, or empty string to remove.', required: true },
  }, async (args) => {
    const jid = normalizeJid(args.jid)
    if (!jid) return { ok: false, error: 'unresolved recipient', hint: 'resolve the chat first' }
    return outbox.send({ jid, kind: 'reaction', payload: { messageId: args.message_id, emoji: args.emoji } })
  }))

  register(rawTool('wa_mark_read', 'Mark one or more messages in a chat as read.', {
    jid: { type: 'string', description: 'Chat JID.', required: true },
    message_ids: { type: 'array', items: { type: 'string' }, description: 'Message ids to mark read.', required: true },
  }, async (args) => {
    const jid = normalizeJid(args.jid)
    if (!jid) return { ok: false, error: 'unresolved recipient' }
    return outbox.send({ jid, kind: 'read', payload: { messageIds: args.message_ids } })
  }))

  register(rawTool('wa_remember', 'Persist a durable fact, commitment, or open question about a chat (or the global context) so it survives this conversation and is injected into future briefings.', {
    jid: { type: 'string', description: 'Chat JID, or "global".', required: true },
    fact: { type: 'string', description: 'The fact / commitment / question text.', required: true },
    kind: { type: 'string', enum: ['fact', 'commitment', 'question'], description: 'What kind of memory item.' },
    due: { type: 'string', description: 'For commitments: when it is due (free text).' },
    provenance: { type: 'string', description: 'Where this fact came from (e.g. "said on 2026-08-12").' },
  }, async (args) => store.remember({ jid: args.jid, fact: args.fact, kind: args.kind || 'fact', due: args.due, provenance: args.provenance })))

  register(rawTool('wa_recall', 'Read the durable memory for a chat (or all global memory): facts, commitments, open questions, contradictions, lessons.', {
    jid: { type: 'string', description: 'Optional chat JID; omit for global only.' },
  }, async (args) => store.recall(args.jid)))

  register(rawTool('wa_record_lesson', 'Record a correction or lesson learned, with its cause, so future turns apply it. Use whenever you realize a mistake or a better way.', {
    lesson: { type: 'string', description: 'What to do differently next time.', required: true },
    cause: { type: 'string', description: 'Why the mistake happened.' },
    jid: { type: 'string', description: 'Optional chat scope; omit for global.' },
  }, async (args) => store.recordLesson({ jid: args.jid, lesson: args.lesson, cause: args.cause })))

  register(rawTool('wa_pending', 'List open commitments and questions (optionally for one chat). Check this before acting to avoid duplicates and dropped commitments.', {
    jid: { type: 'string', description: 'Optional chat JID to filter.' },
  }, async (args) => {
    const all = store.pending()
    return { pending: args.jid ? all.filter((p) => p.jid === args.jid) : all }
  }))

  register(rawTool('wa_verify_sent', 'Check the outbox status of a prior send (queued / sent / hub-confirmed) and confirm it exists in the hub when possible.', {
    jid: { type: 'string', description: 'Chat JID to check the latest send for.' },
    key: { type: 'string', description: 'Exact outbox key returned by a send tool.' },
  }, async (args) => {
    let rec = null
    if (args.key) rec = store.outboxGet(args.key)
    else if (args.jid) {
      rec = store.outboxEntries().filter(([, r]) => r.jid === normalizeJid(args.jid) || r.jid === args.jid).sort((a, b) => b[1].createdAt - a[1].createdAt)[0]
      rec = rec && rec[1]
    }
    if (!rec) return { ok: false, error: 'no matching outbox record' }
    let hubConfirmed = false
    if (rec.hubMessageId && !(config.echoMode === true || !config.apiKey)) {
      try { const r = await hub.getMessage(rec.hubMessageId); hubConfirmed = r.ok } catch { hubConfirmed = false }
    }
    return { ok: true, key: rec.key, jid: rec.jid, kind: rec.kind, status: rec.status, hubConfirmed, hubMessageId: rec.hubMessageId, createdAt: rec.createdAt, lastError: rec.lastError }
  }))
}

// ── agent bootstrap ────────────────────────────────────────────────────────

function makeAgentSetup(store) {
  return (agentCtx) => {
    const sp = agentCtx.get('systemPrompt')
    if (sp) {
      sp.section({ name: 'whatsapp-operating-contract', order: 50, text: OPERATING_CONTRACT })
      sp.context({ name: 'whatsapp-briefing', order: 200, text: () => store.briefing() || '(no pending state)' })
    }
  }
}

async function ensureAgent(ctx, config, store) {
  const agents = ctx.get('agents')
  if (!agents) return null

  const existing = agents.get(config.agentSessionId)
  if (existing) return existing

  const setup = makeAgentSetup(store)
  const agentOptions = {}
  if (config.model) agentOptions.model = config.model
  if (config.provider) agentOptions.provider = config.provider

  const persistence = ctx.get('sessionPersistence')
  let persisted = false
  if (persistence) {
    try {
      const sessions = await persistence.list()
      persisted = sessions.some((s) => s && (s.id === config.agentSessionId || s.sessionId === config.agentSessionId))
    } catch { persisted = false }
  }

  try {
    if (persisted) {
      await agents.resume({ resumeSessionId: config.agentSessionId, agentOptions, setup })
      console.log(`[whatsapp-agent] resumed agent ${config.agentSessionId}`)
    } else {
      await agents.create({
        sessionId: config.agentSessionId,
        meta: config.agentPreset ? { agentPreset: config.agentPreset } : {},
        agentOptions,
        setup,
      })
      console.log(`[whatsapp-agent] created agent ${config.agentSessionId}`)
    }
  } catch (err) {
    console.error('[whatsapp-agent] agent bootstrap failed', err && err.message)
  }
  return agents.get(config.agentSessionId)
}

// ── plugin ─────────────────────────────────────────────────────────────────

export const name = 'whatsapp-agent'

// `ctx.tools` is only reachable from a fiber that injects it; everything else
// this plugin touches (webServer, timer, agents, sessionPersistence) is optional
// and read through `ctx.get(...)`, which resolves to undefined when absent.
export const inject = ['tools']

export async function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  // Mutable runtime config: the settings panel can override hubUrl/apiKey/
  // webhookSecret/pollMs at runtime; it resets to the composition config on reload.
  const runtime = { ...config }

  const hub = createHubClient(runtime)
  const store = createMemoryStore(await makePersistence(config))
  await store.init()
  const outbox = createOutbox({ hub, store, echoMode: () => runtime.echoMode === true || !runtime.apiKey })

  const deliver = (identity) => {
    const agents = ctx.get('agents')
    const agent = agents && agents.get(runtime.agentSessionId)
    if (!agent) {
      console.error('[whatsapp-agent] agent not live; inbound dropped', identity && identity.id)
      return
    }
    const chatLabel = identity.jid || identity.participant || 'unknown'
    const text = [
      'New WhatsApp message.',
      `Chat: ${chatLabel}`,
      identity.pushName ? `From: ${identity.pushName}` : '',
      identity.preview ? `Preview: ${identity.preview}` : '',
      `Message id: ${identity.id}`,
      '',
      'Read the full message and its recent context with wa_recent_activity or wa_get_conversation before replying.',
    ].filter(Boolean).join('\n')
    agent.followup(makeUserMessage(text, `WhatsApp message from ${chatLabel}`))
  }

  const inbound = createInbound({ ctx, config: runtime, hub, store, onMessage: deliver })

  registerTools(ctx, { hub, store, outbox, config: runtime })

  // Panel routes (same-origin; the client bundle fetches these).
  const webServer = ctx.get('webServer')
  if (webServer) {
    const status = () => ({
      ok: true,
      agent: runtime.agentSessionId,
      echoMode: runtime.echoMode === true || !runtime.apiKey,
      hubUrl: runtime.hubUrl,
      apiKeySet: !!runtime.apiKey,
      webhookSecretSet: !!runtime.webhookSecret,
      webhookPath: runtime.webhookPath,
      pollMs: runtime.pollMs,
      seenMessages: Object.keys(store.snapshot().seen || {}).length,
      chatsTracked: Object.keys(store.snapshot().chats || {}).length,
      outboxPending: store.outboxEntries().filter(([, r]) => r.status === 'pending' || r.status === 'failed').length,
      pending: store.pending(),
      lessons: (store.snapshot().lessons || []).slice(-6),
    })

    webServer.register({ kind: 'exact', path: `${runtime.webhookPath}/status`, handler: (_req, res) => sendJson(res, 200, status()) })
    webServer.register({ kind: 'exact', path: '/whatsapp/panel/status', handler: (_req, res) => sendJson(res, 200, status()) })

    webServer.register({
      kind: 'exact',
      path: '/whatsapp/panel/config',
      handler: async (req, res) => {
        if (req.method === 'POST') {
          const patch = await readJsonBody(req)
          if (typeof patch.hubUrl === 'string' && patch.hubUrl) runtime.hubUrl = patch.hubUrl.replace(/\/+$/, '')
          if (typeof patch.apiKey === 'string' && patch.apiKey) runtime.apiKey = patch.apiKey
          if (typeof patch.webhookSecret === 'string' && patch.webhookSecret) runtime.webhookSecret = patch.webhookSecret
          if (typeof patch.pollMs === 'number' && patch.pollMs >= 0) runtime.pollMs = patch.pollMs
          if (typeof patch.echoMode === 'boolean') runtime.echoMode = patch.echoMode
          sendJson(res, 200, status())
          return
        }
        sendJson(res, 200, {
          hubUrl: runtime.hubUrl,
          apiKeySet: !!runtime.apiKey,
          webhookSecretSet: !!runtime.webhookSecret,
          webhookPath: runtime.webhookPath,
          agentSessionId: runtime.agentSessionId,
          pollMs: runtime.pollMs,
          echoMode: runtime.echoMode === true || !runtime.apiKey,
        })
      },
    })

    webServer.register({
      kind: 'exact',
      path: '/whatsapp/panel/test-send',
      handler: async (req, res) => {
        const patch = await readJsonBody(req)
        const jid = normalizeJid(patch.jid)
        if (!jid) { sendJson(res, 400, { ok: false, error: 'unresolved recipient — enter digits or a full JID' }); return }
        const result = await outbox.send({ jid, kind: 'text', payload: { text: patch.text || '[panel test]' } })
        sendJson(res, 200, result)
      },
    })
  }

  // Webhook route + reconciliation poll.
  ctx.effect(() => {
    const timer = ctx.get('timer')
    const disposers = []
    disposers.push(inbound.registerWebhook(webServer))
    disposers.push(inbound.registerPoll(timer))
    return () => { for (const d of disposers) { try { d() } catch { /* ignore */ } } }
  })

  // Bootstrap the dedicated agent (does not own its teardown; durable, resumed on restart).
  await ensureAgent(ctx, runtime, store)

  console.log(`[whatsapp-agent] loaded (echoMode=${runtime.echoMode === true || !runtime.apiKey}, hub=${runtime.hubUrl})`)
}
