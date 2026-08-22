/**
 * Profile — the WhatsApp agent's durable, owner-configured "spine".
 *
 * This module is the single source of truth for the Profile schema: its shape,
 * defaults, the field paths that are owner-gated, and the autonomy decision
 * function. It is dependency-free and pure, so the onboarding flow, the
 * briefing builder, the scheduler, and the future self-review loop all import
 * the same contract (no drift between "what the agent remembers" and "what the
 * panel shows").
 *
 * Two-speed model (see docs/AGENT_PRESET_SPEC.md):
 *   - FAST (agent-owned, no approval): facts, commitments, questions,
 *     contradictions, lessons — the existing memory store. Not this file.
 *   - SLOW (owner-gated): everything here EXCEPT `state` and `changelog`.
 *     The agent may READ all of it and PROPOSE changes, but a change to a
 *     gated path only commits on owner approval (recorded in `changelog`).
 */

export const PROFILE_VERSION = 1

export const AUTONOMY_LEVELS = ['assistant', 'autonomous', 'chief-of-staff']

/** Risk classes for outbound actions. Drives the autonomy matrix + escalation. */
export const RISK_CLASSES = ['info', 'social', 'logistics', 'commitment', 'sensitive', 'broadcast']

/**
 * Dotted paths the agent may not mutate on its own. A proposal targeting any of
 * these goes through `wa_propose_rule` (owner approves) instead of a direct
 * write. `state` and `changelog` are the only fast (agent-owned) profile keys.
 */
export const GATED_FIELDS = [
  'identity',
  'mission',
  'autonomy',
  'boundaries',
  'inboxPolicy',
  'schedule',
  'tone',
]

/** Build the default Profile. `ownerJid`/`ownerName` are filled in at onboarding. */
export function defaultProfile({ ownerJid = '', ownerName = 'Owner', timezone = 'America/Sao_Paulo', language = 'pt-BR' } = {}) {
  return {
    version: PROFILE_VERSION,
    identity: {
      name: 'WhatsApp Agent',
      role: 'assistant',           // assistant | gatekeeper | chief-of-staff
      owner: { jid: ownerJid, name: ownerName },
      language,
      timezone,
    },
    mission: {
      statement: '',               // one paragraph: what this agent exists to do
      priorities: [],              // ordered list
    },
    autonomy: {
      level: 'assistant',          // assistant | autonomous | chief-of-staff
      proactiveSend: false,        // may it send without being pinged at all
      draftForApproval: true,      // prepare-and-ask for anything it won't auto-send
      escalateWhen: ['sensitive', 'commitment', 'broadcast'],
      quietHours: { from: '22:00', to: '08:00', tz: timezone },
    },
    boundaries: {
      allowed: [],                 // e.g. "reply to scheduling requests"
      forbidden: [],               // e.g. "never send money / never contact <jid>"
      contacts: {},                // jid -> { trust: 'normal', autonomyOverride: null, note }
    },
    inboxPolicy: {
      respondTo: 'known',          // all | known | flagged
      ignoreJids: [],
      keywordsWake: [],            // inbound text matching these wakes the agent
      keywordsIgnore: [],
      groupPolicy: 'mention-only', // mention-only | always | never
    },
    schedule: {
      digest: { enabled: false, time: '09:00', tz: timezone, scope: 'unread-and-pending' },
      followUps: { enabled: true, windowHours: 48 },
      reminders: [],               // agent-managed via wa_schedule/wa_remind
    },
    tone: {
      style: 'warm-professional',
      brevity: 3,                  // 1 (terse) .. 5 (thorough)
    },
    // ── fast / agent-owned ────────────────────────────────────────────────
    state: {
      onboarding: 'not-started',   // not-started | in-progress | done
      onboardingStep: null,        // resumes the interview where it left off
    },
    changelog: [],                 // [{ at, path, before, after, by: 'owner'|'agent' }]
  }
}

/**
 * Decide whether an outbound action may be sent proactively or must be drafted
 * for owner approval. Pure function; the model consults this contract (not
 * ad-hoc judgement) before every outbound write.
 *
 * @param {object} profile  the current Profile
 * @param {object} action   { kind, jid, summary }
 * @returns {{verdict:'send'|'draft'|'refuse', reason:string}}
 */
export function decideAction(profile, action = {}) {
  const kind = action.kind || 'info'
  const contact = (action.jid && profile.boundaries.contacts[action.jid]) || {}
  const level = contact.autonomyOverride || profile.autonomy.level

  const forbidden = (profile.boundaries.forbidden || []).some((rule) => matches(rule, action))
  if (forbidden) return { verdict: 'refuse', reason: 'forbidden-by-boundary' }
  if (contact.trust === 'low') return { verdict: 'draft', reason: 'low-trust-contact' }

  const escalate = (profile.autonomy.escalateWhen || []).includes(kind)

  if (level === 'assistant') return { verdict: 'draft', reason: escalate ? 'escalate' : 'assistant-level' }
  if (level === 'autonomous') return escalate ? { verdict: 'draft', reason: 'escalate' } : { verdict: 'send', reason: 'low-risk' }
  // chief-of-staff
  return escalate ? { verdict: 'draft', reason: 'escalate' } : { verdict: 'send', reason: 'chief-of-staff' }
}

/** Light structural validation. Returns { ok, errors }. v1: shallow + type-ish. */
export function validateProfile(p) {
  const errors = []
  if (!p || typeof p !== 'object') return { ok: false, errors: ['profile must be an object'] }
  if (p.version !== PROFILE_VERSION) errors.push(`unknown version ${p.version}`)
  if (!AUTONOMY_LEVELS.includes(p.autonomy && p.autonomy.level)) {
    errors.push('autonomy.level must be one of ' + AUTONOMY_LEVELS.join(', '))
  }
  if (typeof (p.autonomy && p.autonomy.proactiveSend) !== 'boolean') {
    errors.push('autonomy.proactiveSend must be a boolean')
  }
  return { ok: errors.length === 0, errors }
}

// v1: dumb substring match. Deliberately simple; upgrade to structured rules
// (e.g. {kind, jid, pattern}) when onboarding needs it — do not over-build now.
function matches(rule, action = {}) {
  const r = String(rule || '').toLowerCase().trim()
  if (!r) return false
  const hay = String((action.kind || '') + ' ' + (action.summary || '')).toLowerCase()
  return hay.includes(r)
}
