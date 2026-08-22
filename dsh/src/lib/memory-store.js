/**
 * Durable per-chat + cross-chat memory store for the WhatsApp agent.
 *
 * This is the plugin's *own* reliability memory (layer 2 and the action log
 * from DESIGN.md). It is deliberately import-free except for the sibling
 * `profile.js` (the Profile schema): persistence is injected as `{ load, save }`
 * callbacks so the same module runs over `storageDomain`, a JSON file, or plain
 * memory.
 *
 * State shape (one JSON object):
 *   {
 *     chats:   { [jid]: ChatState },
 *     global:  { facts, commitments, openQuestions, contradictions, lessons },
 *     outbox:  { [idempotencyKey]: OutboxRecord },
 *     seen:    { [messageId]: timestamp },   // inbound dedup
 *     lessons: [ { lesson, cause, at } ],    // cross-chat learning
 *     profile: Profile,                       // owner-gated spine (profile.js)
 *     proposals: [ Proposal ],                // staged rule changes
 *     wake:    [ Intent ],                    // durable scheduler queue
 *   }
 *
 * ChatState = {
 *   jid, alias, summary,
 *   facts:          [ { fact, provenance, at } ],
 *   commitments:    [ { what, due, done, at } ],
 *   openQuestions:  [ { q, at } ],
 *   contradictions: [ { a, b, at } ],
 *   lessons:        [ { lesson, cause, at } ],
 *   lastSeen: number,
 * }
 */

import { defaultProfile } from './profile.js'

const NOW = () => Date.now()

const emptyChat = (jid) => ({
  jid,
  alias: '',
  summary: '',
  facts: [],
  commitments: [],
  openQuestions: [],
  contradictions: [],
  lessons: [],
  lastSeen: NOW(),
})

const emptyGlobal = () => ({
  facts: [],
  commitments: [],
  openQuestions: [],
  contradictions: [],
  lessons: [],
})

const emptyState = () => ({
  chats: {},
  global: emptyGlobal(),
  outbox: {},
  seen: {},
  lessons: [],
  profile: defaultProfile(),
  proposals: [],
  wake: [],
})

/**
 * Recursive merge of `patch` over `base`. Plain objects merge key-by-key;
 * arrays and primitives replace. Used to seed/upgrade the Profile so that new
 * schema fields get their defaults without dropping persisted values.
 */
function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.slice()
  if (patch && typeof patch === 'object') {
    const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
    for (const k of Object.keys(patch)) out[k] = deepMerge(base ? base[k] : undefined, patch[k])
    return out
  }
  return patch
}

/**
 * @param {{load:()=>Promise<object>, save:(state:object)=>Promise<void>}} persistence
 */
export function createMemoryStore({ load, save }) {
  let state = emptyState()
  let ready = false
  let writeChain = Promise.resolve()

  function persist() {
    if (!save) return writeChain
    writeChain = writeChain.then(() => save(JSON.parse(JSON.stringify(state)))).catch((err) => {
      console.error('[whatsapp-agent] memory save failed', err && err.message)
    })
    return writeChain
  }

  const init = async () => {
    if (ready) return
    if (load) {
      try {
        const loaded = await load()
        if (loaded && typeof loaded === 'object') {
          state = { ...emptyState(), ...loaded }
          if (!state.chats) state.chats = {}
          if (!state.global) state.global = emptyGlobal()
          if (!state.outbox) state.outbox = {}
          if (!state.seen) state.seen = {}
          if (!state.lessons) state.lessons = []
          // Seed/upgrade the Profile and the new durable collections.
          state.profile = deepMerge(defaultProfile(), state.profile || {})
          if (!Array.isArray(state.proposals)) state.proposals = []
          if (!Array.isArray(state.wake)) state.wake = []
        }
      } catch (err) {
        console.error('[whatsapp-agent] memory load failed, starting fresh', err && err.message)
      }
    }
    ready = true
  }

  const chat = (jid) => {
    const key = String(jid || 'global')
    if (key === 'global') return null
    if (!state.chats[key]) state.chats[key] = emptyChat(key)
    return state.chats[key]
  }

  // ── inbound dedup ────────────────────────────────────────────────────────
  function seen(id) { return id != null && Object.prototype.hasOwnProperty.call(state.seen, String(id)) }
  function markSeen(id) { if (id != null) { state.seen[String(id)] = NOW(); persist() } }

  // ── chat facts / memory ──────────────────────────────────────────────────
  function remember({ jid, fact, kind = 'fact', provenance = '', due = null }) {
    const c = chat(jid)
    if (!c) return { stored: false, reason: 'no-chat' }
    if (kind === 'commitment') {
      c.commitments.push({ what: fact, due, done: false, at: NOW() })
    } else if (kind === 'question') {
      c.openQuestions.push({ q: fact, at: NOW() })
    } else {
      c.facts.push({ fact, provenance, at: NOW() })
    }
    c.lastSeen = NOW()
    persist()
    return { stored: true, jid: c.jid }
  }

  function recordContradiction({ jid, a, b }) {
    const c = chat(jid)
    if (!c) return { stored: false }
    c.contradictions.push({ a, b, at: NOW() })
    c.lastSeen = NOW()
    persist()
    return { stored: true }
  }

  function recordLesson({ jid, lesson, cause = '' }) {
    const rec = { lesson, cause, at: NOW() }
    const c = chat(jid)
    if (c) { c.lessons.push(rec); c.lastSeen = NOW() }
    state.lessons.push({ ...rec, jid: jid || 'global' })
    persist()
    return { stored: true }
  }

  function completeCommitment({ jid, what }) {
    const c = chat(jid)
    if (!c) return { found: false }
    const hit = c.commitments.find((k) => !k.done && k.what === what)
    if (hit) { hit.done = true; c.lastSeen = NOW(); persist(); return { found: true } }
    return { found: false }
  }

  function recall(jid) {
    const c = chat(jid)
    if (!c) return { global: state.global, lessons: state.lessons }
    return { chat: c, global: state.global, lessons: state.lessons }
  }

  function pending() {
    const out = []
    for (const key of Object.keys(state.chats)) {
      const c = state.chats[key]
      for (const k of c.commitments) if (!k.done) out.push({ jid: key, kind: 'commitment', what: k.what, due: k.due })
      for (const q of c.openQuestions) out.push({ jid: key, kind: 'question', what: q.q })
    }
    for (const k of state.global.commitments) if (!k.done) out.push({ jid: 'global', kind: 'commitment', what: k.what, due: k.due })
    for (const q of state.global.openQuestions) out.push({ jid: 'global', kind: 'question', what: q.q })
    return out
  }

  // ── profile (owner-gated spine) ──────────────────────────────────────────
  function getProfile() { return JSON.parse(JSON.stringify(state.profile)) }

  function setProfile(patch) {
    if (!patch || typeof patch !== 'object') return getProfile()
    state.profile = deepMerge(state.profile, patch)
    persist()
    return getProfile()
  }

  function appendChangelog(entry) {
    const rec = { at: NOW(), ...entry }
    if (!Array.isArray(state.profile.changelog)) state.profile.changelog = []
    state.profile.changelog.push(rec)
    persist()
    return rec
  }

  function addProposal(p = {}) {
    const proposal = {
      id: `proposal-${NOW()}-${Math.random().toString(36).slice(2, 8)}`,
      at: NOW(),
      path: p.path,
      before: p.before,
      after: p.after,
      reason: p.reason || '',
      status: 'proposed',
    }
    state.proposals.push(proposal)
    persist()
    return proposal
  }

  function updateProposal(id, patch) {
    const p = state.proposals.find((x) => x.id === id)
    if (!p) return null
    Object.assign(p, patch)
    persist()
    return p
  }

  function listProposals() { return state.proposals.slice() }

  // ── scheduler wake queue ─────────────────────────────────────────────────
  function wakeList() { return state.wake.slice() }
  function wakePut(entry) { state.wake.push(entry); persist(); return entry }
  function wakeUpdate(id, patch) {
    const e = state.wake.find((x) => x.id === id)
    if (!e) return null
    Object.assign(e, patch)
    persist()
    return e
  }
  function nextWake() {
    return state.wake.filter((e) => e.status === 'queued').sort((a, b) => a.at - b.at)[0] || null
  }

  // ── situational briefing ────────────────────────────────────────────────
  function briefing(maxItems = 12) {
    const parts = []
    const profile = state.profile || defaultProfile()
    const mission = profile.mission || {}
    const autonomy = profile.autonomy || {}
    const boundaries = profile.boundaries || {}

    // 1. one-line profile summary (authoritative spine, injected every turn)
    const missionLine = mission.statement
      ? `mission: "${String(mission.statement).slice(0, 80)}"`
      : 'mission: (unset)'
    const autonomyLine = `autonomy: ${autonomy.level || 'assistant'}${autonomy.proactiveSend ? ', proactive-send' : ', no-proactive-send'}${autonomy.draftForApproval ? ', drafts-for-approval' : ''}`
    const forbidden = boundaries.forbidden || []
    const boundaryLine = forbidden.length
      ? `forbidden: ${forbidden.map((f) => String(f)).join(' | ')}`
      : 'boundaries: none active'
    parts.push(`## Profile — ${missionLine}; ${autonomyLine}; ${boundaryLine}`)

    // 2. pending commitments / open questions
    const pend = pending()
    if (pend.length) {
      parts.push('## Pending commitments / open questions')
      for (const p of pend.slice(0, maxItems)) {
        parts.push(`- [${p.kind}] ${p.jid}: ${p.what}${p.due ? ` (due ${p.due})` : ''}`)
      }
    }

    // 3. recent chats
    const recent = Object.keys(state.chats)
      .map((jid) => state.chats[jid])
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .slice(0, 8)
    if (recent.length) {
      parts.push('## Recent chats')
      for (const c of recent) {
        const head = [`- ${c.alias || c.jid}`]
        if (c.summary) head.push(c.summary)
        if (c.contradictions.length) head.push(`⚠ ${c.contradictions.length} unresolved contradiction(s)`)
        parts.push(head.join(': '))
      }
    }

    // 4. recent lessons
    if (state.lessons.length) {
      parts.push('## Recent lessons (apply these)')
      for (const l of state.lessons.slice(-6).reverse()) parts.push(`- ${l.lesson}`)
    }

    // 5. next scheduled wake
    const next = nextWake()
    if (next) parts.push(`## Next wake — ${new Date(next.at).toISOString()} (${next.kind})`)

    // 6. needs attention
    const needs = needsAttention()
    if (needs) parts.push(`## Needs attention — ${needs}`)

    return parts.join('\n')
  }

  function needsAttention() {
    const now = NOW()
    const STALE_MS = 48 * 60 * 60 * 1000 // matches the default followUps.windowHours
    let stale = 0
    let openQuestions = 0
    let contradictions = 0
    const scan = (commitments, qs, cons) => {
      for (const k of commitments || []) {
        if (!k.done && k.at && now - k.at > STALE_MS) stale++
      }
      openQuestions += (qs || []).length
      contradictions += (cons || []).length
    }
    scan(state.global.commitments, state.global.openQuestions, state.global.contradictions)
    for (const key of Object.keys(state.chats)) {
      const c = state.chats[key]
      scan(c.commitments, c.openQuestions, c.contradictions)
    }
    const items = []
    if (stale) items.push(`${stale} stale commitment(s)`)
    if (openQuestions) items.push(`${openQuestions} open question(s)`)
    if (contradictions) items.push(`${contradictions} contradiction(s)`)
    return items.length ? items.join(', ') : ''
  }

  // ── outbox ───────────────────────────────────────────────────────────────
  function outboxGet(key) { return state.outbox[key] }
  function outboxPut(key, record) { state.outbox[key] = record; persist() }
  function outboxUpdate(key, patch) {
    if (!state.outbox[key]) return
    state.outbox[key] = { ...state.outbox[key], ...patch }
    persist()
  }
  function outboxEntries() { return Object.entries(state.outbox) }

  function snapshot() { return state }

  return {
    init,
    chat,
    seen,
    markSeen,
    remember,
    recordContradiction,
    recordLesson,
    completeCommitment,
    recall,
    pending,
    briefing,
    getProfile,
    setProfile,
    appendChangelog,
    addProposal,
    updateProposal,
    listProposals,
    wakeList,
    wakePut,
    wakeUpdate,
    nextWake,
    outboxGet,
    outboxPut,
    outboxUpdate,
    outboxEntries,
    snapshot,
  }
}
