/**
 * Scheduler — the "when to wake" core of the WhatsApp agent preset.
 *
 * One durable queue of *intents* (`state.wake` in the memory store) plus a dumb
 * ticker (wired in index.js). The ticker pops due intents, marks them `fired`,
 * and hands a structured wake prompt to `agent.followup`. It decides WHEN to
 * wake, never WHAT to do: the agent reads the Profile and decides (decideAction
 * semantics) what, if anything, to actually send.
 *
 * Quiet hours: a time-based intent whose `at` falls inside
 * `autonomy.quietHours` is deferred to the end of the window at enqueue time
 * (no proactive wake during quiet hours).
 *
 * Dependency-free: node builtins (Intl for tz math) + the injected memory store.
 */

const NOW = () => Date.now()

const DAY_MS = 24 * 60 * 60 * 1000

// ── quiet-hours helpers (dependency-free, Intl-based tz math) ───────────────

/** "HH:MM" -> minutes since midnight, or null when unparseable. */
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}

/** Local wall-clock minutes in `tz` for a Unix timestamp, or null on bad tz. */
function localMinutes(ts, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(ts))
    const h = Number(parts.find((p) => p.type === 'hour').value) % 24
    const mi = Number(parts.find((p) => p.type === 'minute').value)
    return h * 60 + mi
  } catch { return null }
}

function isInQuietHours(min, from, to) {
  if (from === to) return false
  if (from < to) return min >= from && min < to
  return min >= from || min < to // window crosses midnight
}

/** Next timestamp (after `at`) whose local time equals the window `to`. */
function deferToWindowEnd(at, qh, tz) {
  const to = toMinutes(qh.to)
  if (to == null) return null
  let t = at
  for (let i = 0; i < DAY_MS / 60000; i++) {
    t += 60000
    if (localMinutes(t, tz) === to) return t
  }
  return null
}

/**
 * @param {{store:object, now?:()=>number}} deps
 */
export function createScheduler({ store, now = NOW }) {
  const nextId = () => `wake-${now()}-${Math.random().toString(36).slice(2, 8)}`

  function deferredAt(baseAt) {
    const profile = store.getProfile()
    const qh = profile && profile.autonomy && profile.autonomy.quietHours
    if (!qh || typeof qh !== 'object') return baseAt
    const from = toMinutes(qh.from)
    const to = toMinutes(qh.to)
    if (from == null || to == null) return baseAt
    const tz = qh.tz || (profile.identity && profile.identity.timezone) || 'UTC'
    const min = localMinutes(baseAt, tz)
    if (min == null || !isInQuietHours(min, from, to)) return baseAt
    const deferred = deferToWindowEnd(baseAt, qh, tz)
    return deferred != null && deferred > baseAt ? deferred : baseAt
  }

  /** Add a durable time-based intent. Returns the persisted entry. */
  function enqueue({ at, kind, args = {} }) {
    const baseAt = at == null ? now() : at
    const finalAt = deferredAt(baseAt)
    const entry = { id: nextId(), at: finalAt, kind, args, status: 'queued', deferred: finalAt !== baseAt }
    store.wakePut(entry)
    return entry
  }

  function cancel(id) {
    const e = store.wakeUpdate(id, { status: 'skipped' })
    return e ? { ok: true, intent: e } : { ok: false, error: 'no such intent' }
  }

  /** All currently-due (queued and past their `at`) intents, oldest first. */
  function due(nowTs = now()) {
    return store.wakeList()
      .filter((e) => e.status === 'queued' && e.at <= nowTs)
      .sort((a, b) => a.at - b.at)
  }

  /** Idempotently mark an intent fired; false when absent or already fired/skipped. */
  function markFired(id) {
    const e = store.wakeList().find((x) => x.id === id)
    if (!e || e.status !== 'queued') return false
    store.wakeUpdate(id, { status: 'fired' })
    return true
  }

  function list() { return store.wakeList() }
  function next() { return list().filter((e) => e.status === 'queued').sort((a, b) => a.at - b.at)[0] || null }

  return { enqueue, cancel, due, markFired, list, next, DAY_MS }
}

// ── wake prompts ────────────────────────────────────────────────────────────

export const ONBOARDING_AGENDA = [
  'Owner onboarding interview (7 steps; 1-2 short messages each, in the owner DM):',
  '1. Who I am — agent name, role, the owner\'s name / language / timezone.',
  '2. Mission — a one-line brief plus priorities for what you exist to do.',
  '3. How I act — tone, brevity, language, anything about the owner\'s voice.',
  '4. What I may/may not do — boundaries; people to never contact.',
  '5. Autonomy — walk the level (assistant | autonomous | chief-of-staff) plus the proactiveSend / draftForApproval toggles; per-contact overrides.',
  '6. When I wake — digest time, follow-up window, quiet hours, reminder habits.',
  '7. Confirm — restate the whole Profile back, get an explicit "yes" (or edits), then mark onboarding done.',
].join('\n')

/**
 * Build the structured wake prompt handed to `agent.followup`. States the kind
 * + args and tells the agent to read the Profile and decide (decideAction
 * semantics) what to actually do. The ticker never decides itself.
 */
export function buildWakePrompt(intent, profile = null) {
  const kind = intent.kind || 'wake'
  const args = intent.args || {}
  const lines = [`Scheduled wake (host-initiated). Kind: ${kind}.`]

  if (kind === 'onboarding') {
    const step = (profile && profile.state && profile.state.onboardingStep) ?? null
    lines.push(step == null
      ? 'Owner onboarding has not started. DM the owner and begin the interview below.'
      : `Onboarding is in progress. Resume at step ${step} of the interview below (pick up where the interrupted chat left off).`)
    lines.push('')
    lines.push(ONBOARDING_AGENDA)
    lines.push('')
    lines.push('Persist each answer as you go: fast facts via wa_remember; owner-gated fields (identity, mission, tone, boundaries, autonomy, schedule) via wa_propose_rule (the owner approves via wa_approve_rule). Advance profile.state.onboardingStep with wa_set_profile after each step. Only on the owner\'s explicit confirmation of the final restatement, set profile.state.onboarding to "done" via wa_set_profile.')
  } else if (kind === 'self-review') {
    lines.push('Periodic self-review. (1) Dedupe and refine your lessons (wa_record_lesson already persists them). (2) Surface any unresolved contradictions to the owner. (3) If your behaviour shows a recurring pattern the owner always approves, propose a Profile rule change with wa_propose_rule. Do NOT auto-commit any gated change — proposals only.')
  } else {
    if (args && Object.keys(args).length) lines.push(`Details: ${JSON.stringify(args)}`)
    lines.push('A time-based wake fired. Read the Profile (wa_get_profile) and the briefing, then decide what (if anything) to do.')
  }

  lines.push('')
  lines.push('Before any outbound send, apply decideAction semantics (risk class x autonomy level x per-contact trust x boundaries): send, draft-for-approval, or refuse. Never commit a gated Profile change yourself — propose it with wa_propose_rule.')
  return lines.join('\n')
}
