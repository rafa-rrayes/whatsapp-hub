/**
 * Durable per-chat + cross-chat memory store for the WhatsApp agent.
 *
 * This is the plugin's *own* reliability memory (layer 2 and the action log
 * from DESIGN.md). It is deliberately import-free: persistence is injected as
 * `{ load, save }` callbacks so the same module runs over `storageDomain`,
 * a JSON file, or plain memory.
 *
 * State shape (one JSON object):
 *   {
 *     chats:   { [jid]: ChatState },
 *     global:  { facts, commitments, openQuestions, contradictions, lessons },
 *     outbox:  { [idempotencyKey]: OutboxRecord },
 *     seen:    { [messageId]: timestamp },   // inbound dedup
 *     lessons: [ { lesson, cause, at } ]     // cross-chat learning
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

const emptyState = () => ({ chats: {}, global: emptyGlobal(), outbox: {}, seen: {}, lessons: [] })

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

  // ── situational briefing ────────────────────────────────────────────────
  function briefing(maxItems = 12) {
    const parts = []
    const pend = pending()
    if (pend.length) {
      parts.push('## Pending commitments / open questions')
      for (const p of pend.slice(0, maxItems)) {
        parts.push(`- [${p.kind}] ${p.jid}: ${p.what}${p.due ? ` (due ${p.due})` : ''}`)
      }
    }
    const recent = Object.keys(state.chats)
      .map((jid) => state.chats[jid])
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .slice(0, 8)
    for (const c of recent) {
      const head = [`- ${c.alias || c.jid}`]
      if (c.summary) head.push(c.summary)
      if (c.contradictions.length) head.push(`⚠ ${c.contradictions.length} unresolved contradiction(s)`)
      parts.push(head.join(': '))
    }
    if (state.lessons.length) {
      parts.push('## Recent lessons (apply these)')
      for (const l of state.lessons.slice(-6).reverse()) parts.push(`- ${l.lesson}`)
    }
    return parts.join('\n')
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
    outboxGet,
    outboxPut,
    outboxUpdate,
    outboxEntries,
    snapshot,
  }
}
