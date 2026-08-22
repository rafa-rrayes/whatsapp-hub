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
import { createScheduler, buildWakePrompt } from './lib/scheduler.js'
import { GATED_FIELDS, validateProfile } from './lib/profile.js'
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
  ownerJid: '',
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

/** Read a dotted path from a Profile object (undefined when missing). */
function getByPath(obj, path) {
  let cur = obj
  for (const seg of String(path).split('.')) {
    if (cur == null) return undefined
    cur = cur[seg]
  }
  return cur
}

/** Mutate a dotted path on a Profile object (creating missing intermediates). */
function setByPath(obj, path, value) {
  const segs = String(path).split('.')
  let cur = obj
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]
    if (cur[seg] == null || typeof cur[seg] !== 'object' || Array.isArray(cur[seg])) cur[seg] = {}
    cur = cur[seg]
  }
  cur[segs[segs.length - 1]] = value
  return obj
}

/** True when the first segment of a dotted path is an owner-gated Profile key. */
function isGatedPath(path) {
  return GATED_FIELDS.includes(String(path || '').split('.')[0])
}

/** Parse a schedule time: Unix ms (number or digit string) or ISO 8601 string. */
function parseAt(input) {
  if (input == null) return null
  if (typeof input === 'number' && Number.isFinite(input)) return input
  const s = String(input).trim()
  if (/^\d{10,13}$/.test(s)) return Number(s)
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
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

function registerTools(ctx, { hub, store, outbox, config, scheduler }) {
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

  // ── profile (owner-gated spine) ──────────────────────────────────────────

  register(rawTool('wa_get_profile', 'Return the full Profile (mission, autonomy level, proactive/draft toggles, boundaries, inbox policy, schedule, tone) plus pending rule proposals, the recent changelog tail, and the scheduled wake queue. The Profile is the agent\'s durable, owner-configured spine: read it before any outbound send and before deciding whether a change needs a proposal.', {}, async () => {
    const profile = store.getProfile()
    return {
      profile,
      proposals: store.listProposals(),
      changelog: (profile.changelog || []).slice(-10).reverse(),
      wake: scheduler.list(),
    }
  }))

  register(rawTool('wa_set_profile', 'Merge a patch into the FAST (agent-owned) parts of the Profile: state (onboarding/onboardingStep). Any owner-gated spine key (identity, mission, autonomy, boundaries, inboxPolicy, schedule, tone) is rejected — propose those via wa_propose_rule instead. Returns which keys were gated and the validation result.', {
    patch: { type: 'object', description: 'Object of top-level Profile keys to merge, e.g. { state: { onboardingStep: 2 } }.', required: true },
  }, async (args) => {
    const patch = args.patch
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'patch must be an object' }
    const protectedKeys = ['version', 'changelog']
    const keys = Object.keys(patch)
    const gated = keys.filter((k) => GATED_FIELDS.includes(k))
    const protectedFields = keys.filter((k) => protectedKeys.includes(k))
    const allowed = {}
    for (const k of keys) if (!GATED_FIELDS.includes(k) && !protectedKeys.includes(k)) allowed[k] = patch[k]
    if (Object.keys(allowed).length) store.setProfile(allowed)
    const validation = validateProfile(store.getProfile())
    return {
      ok: gated.length === 0 && protectedFields.length === 0 && validation.ok,
      applied: Object.keys(allowed),
      gated,
      protected: protectedFields,
      hint: gated.length
        ? `Owner-gated fields must go through wa_propose_rule: ${gated.join(', ')}`
        : (protectedFields.length ? `Read-only fields ignored: ${protectedFields.join(', ')}` : undefined),
      validation,
    }
  }))

  register(rawTool('wa_propose_rule', 'Stage a change to an owner-gated Profile field (identity, mission, autonomy, boundaries, inboxPolicy, schedule, tone) as a proposal for the owner to approve. The change does NOT apply until the owner approves via wa_approve_rule. `before` is computed from the current Profile if omitted.', {
    path: { type: 'string', description: 'Dotted path into the Profile, e.g. "autonomy.level" or "boundaries.forbidden".', required: true },
    after: { description: 'Proposed new value for that path (any JSON type).', required: true },
    reason: { type: 'string', description: 'Why this change is proposed.', required: true },
    before: { description: 'Current value at that path (computed from the Profile if omitted).' },
  }, async (args) => {
    if (!isGatedPath(args.path)) {
      return { ok: false, error: 'not an owner-gated path', gatedFields: GATED_FIELDS, hint: 'Only changes to the Profile spine can be proposed; fast state changes go through wa_set_profile.' }
    }
    const profile = store.getProfile()
    const before = args.before !== undefined ? args.before : getByPath(profile, args.path)
    const proposal = store.addProposal({ path: args.path, before, after: args.after, reason: args.reason })
    return { ok: true, proposal }
  }))

  register(rawTool('wa_approve_rule', 'Approve or reject a staged Profile rule proposal (created by wa_propose_rule). On approve, the change is applied to the Profile and appended to the changelog with by: owner. On reject, the proposal is closed without applying.', {
    id: { type: 'string', description: 'Proposal id.', required: true },
    approve: { type: 'boolean', description: 'true to apply the change, false to reject.', required: true },
  }, async (args) => {
    const proposal = store.listProposals().find((p) => p.id === args.id)
    if (!proposal) return { ok: false, error: 'no such proposal' }
    if (proposal.status !== 'proposed') return { ok: false, error: `proposal already ${proposal.status}` }
    if (!args.approve) {
      store.updateProposal(args.id, { status: 'rejected' })
      return { ok: true, status: 'rejected', proposal }
    }
    const profile = store.getProfile()
    setByPath(profile, proposal.path, proposal.after)
    store.setProfile(profile)
    store.appendChangelog({ path: proposal.path, before: proposal.before, after: proposal.after, by: 'owner' })
    store.updateProposal(args.id, { status: 'approved' })
    return { ok: true, status: 'approved', proposal, profile: store.getProfile() }
  }))

  // ── scheduler tools ──────────────────────────────────────────────────────

  register(rawTool('wa_schedule', 'Add a time-based wake intent to the durable scheduler queue. At the given time the host wakes the agent with a prompt stating the kind and args; the agent then reads the Profile and decides what to do. Use for digests, follow-ups, and periodic jobs. Intents inside quiet hours are deferred to the end of the window.', {
    at: { description: 'When to wake: Unix ms (number or digit string) or an ISO 8601 string.', required: true },
    kind: { type: 'string', description: 'Wake kind: digest | reminder | follow-up | self-review | keyword | onboarding.', required: true },
    args: { type: 'object', description: 'Arbitrary details handed back in the wake prompt (e.g. { jid, text }).' },
  }, async (args) => {
    const at = parseAt(args.at)
    if (at == null) return { ok: false, error: 'invalid time; use Unix ms or an ISO 8601 string' }
    if (!args.kind || typeof args.kind !== 'string') return { ok: false, error: 'kind required' }
    const intent = scheduler.enqueue({ at, kind: args.kind, args: args.args || {} })
    return { ok: true, intent }
  }))

  register(rawTool('wa_remind', 'Schedule a one-shot reminder to a chat (shorthand for wa_schedule with kind reminder). At the time the host wakes the agent, which then sends or drafts the reminder per decideAction.', {
    at: { description: 'When: Unix ms (number or digit string) or an ISO 8601 string.', required: true },
    jid: { type: 'string', description: 'Recipient JID (resolve the chat first).', required: true },
    text: { type: 'string', description: 'What to remind them of.', required: true },
  }, async (args) => {
    const at = parseAt(args.at)
    if (at == null) return { ok: false, error: 'invalid time' }
    const jid = normalizeJid(args.jid)
    if (!jid) return { ok: false, error: 'unresolved recipient', hint: 'resolve the chat first' }
    const intent = scheduler.enqueue({ at, kind: 'reminder', args: { jid, text: args.text } })
    return { ok: true, intent }
  }))

  register(rawTool('wa_cancel', 'Cancel a scheduled wake intent by id (ids are returned by wa_schedule / wa_remind and listed in wa_get_profile.wake).', {
    id: { type: 'string', description: 'Intent id.', required: true },
  }, async (args) => scheduler.cancel(args.id)))
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
  const scheduler = createScheduler({ store })
  const outbox = createOutbox({ hub, store, echoMode: () => runtime.echoMode === true || !runtime.apiKey })

  // ── owner resolution ─────────────────────────────────────────────────────
  // The owner is who the agent DMs for onboarding, escalations, and approvals.
  // Prefer the config `ownerJid`; otherwise the first inbound non-group sender
  // becomes the owner and is persisted to the Profile.
  function ownerSet() {
    const p = store.getProfile()
    return !!(p.identity && p.identity.owner && p.identity.owner.jid)
  }
  function enqueueOnboarding() {
    const profile = store.getProfile()
    if (profile.state && profile.state.onboarding === 'done') return
    if (scheduler.list().some((e) => e.status === 'queued' && e.kind === 'onboarding')) return
    store.setProfile({
      state: {
        onboarding: 'in-progress',
        onboardingStep: profile.state && profile.state.onboardingStep != null ? profile.state.onboardingStep : 0,
      },
    })
    scheduler.enqueue({ at: Date.now(), kind: 'onboarding' })
    console.log('[whatsapp-agent] enqueued onboarding wake')
  }
  function resolveOwnerFromConfig() {
    if (ownerSet()) return
    const jid = normalizeJid(runtime.ownerJid)
    if (!jid) return
    store.setProfile({ identity: { owner: { jid } } })
    console.log(`[whatsapp-agent] owner set from config: ${jid}`)
    enqueueOnboarding()
  }
  function resolveOwnerFromInbound(identity) {
    if (ownerSet() || !identity || !identity.jid) return
    if (identity.jid.includes('@g.us') || identity.jid.includes('@broadcast')) return
    store.setProfile({ identity: { owner: { jid: identity.jid, name: identity.pushName || 'Owner' } } })
    console.log(`[whatsapp-agent] owner set from first inbound sender: ${identity.jid}`)
    enqueueOnboarding()
  }

  // ── wake bootstrap (onboarding + periodic self-review) ───────────────────
  function bootstrapWakes() {
    // Onboarding needs a known owner to DM. If none is configured and no one
    // has messaged yet, cancel any stale queued onboarding intent (e.g. one
    // persisted by an earlier boot) — it can only fire meaningfully once the
    // owner is resolved, at which point enqueueOnboarding() runs again.
    if (ownerSet()) {
      enqueueOnboarding()
    } else {
      for (const e of scheduler.list()) {
        if (e.kind === 'onboarding' && e.status === 'queued') {
          scheduler.cancel(e.id)
          console.log('[whatsapp-agent] cancelled stale onboarding wake (no owner yet)')
        }
      }
    }
    if (!scheduler.list().some((e) => e.status === 'queued' && e.kind === 'self-review')) {
      scheduler.enqueue({ at: Date.now() + scheduler.DAY_MS, kind: 'self-review' })
      console.log('[whatsapp-agent] enqueued self-review wake')
    }
  }

  resolveOwnerFromConfig()
  bootstrapWakes()

  const deliver = (identity) => {
    resolveOwnerFromInbound(identity)
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

  // Wake ticker: pops due intents and hands each a structured wake prompt.
  // Dumb by design — it decides WHEN to wake, never WHAT to do.
  const tick = () => {
    const nowTs = Date.now()
    for (const intent of scheduler.due(nowTs)) {
      scheduler.markFired(intent.id)
      if (intent.kind === 'self-review') {
        scheduler.enqueue({ at: nowTs + scheduler.DAY_MS, kind: 'self-review' })
      }
      const agents = ctx.get('agents')
      const agent = agents && agents.get(runtime.agentSessionId)
      if (!agent) {
        console.error('[whatsapp-agent] agent not live; wake dropped', intent.kind, intent.id)
        continue
      }
      agent.followup(makeUserMessage(buildWakePrompt(intent, store.getProfile()), `Scheduled wake: ${intent.kind}`))
    }
  }

  const inbound = createInbound({ ctx, config: runtime, hub, store, onMessage: deliver })

  registerTools(ctx, { hub, store, outbox, config: runtime, scheduler })

  // Panel routes (same-origin; the client bundle fetches these).
  const webServer = ctx.get('webServer')
  if (webServer) {
    // Keep the settings panel snappy: hub calls get a hard timeout and degrade
    // to partial data instead of hanging the route.
    const PING_TIMEOUT_MS = 6000
    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PING_TIMEOUT_MS)),
    ])

    const isEcho = () => runtime.echoMode === true || !runtime.apiKey

    // Hub-derived facts, gathered with graceful degradation. In dry-run mode we
    // skip overview/analytics entirely (there is no live hub to describe).
    async function hubFacts() {
      const facts = { connected: false, overview: null, analytics: null }
      try {
        const h = await withTimeout(hub.health())
        facts.connected = !!(h && h.ok)
      } catch { facts.connected = false }
      if (isEcho()) return facts
      try {
        const o = await withTimeout(hub.overview())
        if (o && o.ok) facts.overview = o.data || null
      } catch { facts.overview = null }
      try {
        const a = await withTimeout(hub.analytics({ days: 7 }))
        if (a && a.ok) facts.analytics = a.data || null
      } catch { facts.analytics = null }
      return facts
    }

    function outboxHistory(limit = 12) {
      return store.outboxEntries()
        .map(([key, r]) => ({
          key, jid: r.jid, kind: r.kind, status: r.status,
          hubMessageId: r.hubMessageId, createdAt: r.createdAt, lastError: r.lastError,
        }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, limit)
    }

    const baseStatus = () => {
      const profile = store.getProfile()
      return {
        ok: true,
        agent: runtime.agentSessionId,
        echoMode: isEcho(),
        hubUrl: runtime.hubUrl,
        apiKeySet: !!runtime.apiKey,
        webhookSecretSet: !!runtime.webhookSecret,
        webhookPath: runtime.webhookPath,
        pollMs: runtime.pollMs,
        seenMessages: Object.keys(store.snapshot().seen || {}).length,
        chatsTracked: Object.keys(store.snapshot().chats || {}).length,
        outboxPending: store.outboxEntries().filter(([, r]) => r.status === 'pending' || r.status === 'failed').length,
        pending: store.pending(),
        lessons: (store.snapshot().lessons || []).slice(-8),
        profile: {
          onboarding: (profile.state && profile.state.onboarding) || null,
          onboardingStep: (profile.state && profile.state.onboardingStep) ?? null,
          level: (profile.autonomy && profile.autonomy.level) || null,
          ownerJid: (profile.identity && profile.identity.owner && profile.identity.owner.jid) || '',
        },
        proposals: store.listProposals(),
        wake: scheduler.list(),
        outbox: outboxHistory(12),
      }
    }

    webServer.register({ kind: 'exact', path: `${runtime.webhookPath}/status`, handler: async (_req, res) => {
      sendJson(res, 200, { ...baseStatus(), ...(await hubFacts()) })
    }})
    webServer.register({ kind: 'exact', path: '/whatsapp/panel/status', handler: async (_req, res) => {
      sendJson(res, 200, { ...baseStatus(), ...(await hubFacts()) })
    }})
    webServer.register({ kind: 'exact', path: '/whatsapp/panel/outbox', handler: (_req, res) => {
      sendJson(res, 200, { ok: true, outbox: outboxHistory(50) })
    }})

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
          sendJson(res, 200, baseStatus())
          return
        }
        sendJson(res, 200, {
          hubUrl: runtime.hubUrl,
          apiKeySet: !!runtime.apiKey,
          webhookSecretSet: !!runtime.webhookSecret,
          webhookPath: runtime.webhookPath,
          agentSessionId: runtime.agentSessionId,
          pollMs: runtime.pollMs,
          echoMode: isEcho(),
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

  // Scheduler wake ticker (~30s). Degrades gracefully when `timer` is absent.
  const WAKE_TICK_MS = 30_000
  ctx.effect(() => {
    const timer = ctx.get('timer')
    if (!timer) return () => {}
    const clear = timer.interval(() => { try { tick() } catch (err) { console.error('[whatsapp-agent] wake tick failed', err && err.message) } }, WAKE_TICK_MS)
    return clear
  })

  // Bootstrap the dedicated agent (does not own its teardown; durable, resumed on restart).
  await ensureAgent(ctx, runtime, store)

  console.log(`[whatsapp-agent] loaded (echoMode=${runtime.echoMode === true || !runtime.apiKey}, hub=${runtime.hubUrl})`)
}
