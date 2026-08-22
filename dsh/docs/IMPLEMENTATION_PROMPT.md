# Implementation Prompt — WhatsApp Agent Preset (spec v1)

You are implementing the WhatsApp Agent Preset described in
`dsh/docs/AGENT_PRESET_SPEC.md`. Working directory: `/Users/Rafa/Code/Misc/whatsapp-hub`.
Read the spec first, then the existing code, then build in the order below.

## Read before writing anything

1. `dsh/docs/AGENT_PRESET_SPEC.md` — the contract you are implementing.
2. `dsh/src/lib/profile.js` — **already written and correct. Reuse it; do not rewrite it.**
3. `dsh/src/index.js` — plugin entry (tools, panel routes, agent bootstrap, inbound).
4. `dsh/src/lib/memory-store.js` — durable memory (chats/global/lessons/outbox/seen).
5. `dsh/src/lib/inbound.js` — webhook + reconciliation poll (shows the `timer` usage pattern).
6. `dsh/src/lib/hub-client.js`, `dsh/src/lib/outbox.js`, `dsh/src/lib/operating-contract.js`.

## Hard constraints

- **Host is dependency-free**: node builtins + relative `./lib/*.js` imports only. No new npm deps.
- **Client**: `dsh/lib/client.js` is what loads (served via `exports["./client"]`); `dsh/src/client.js`
  is the ESM reference. Keep them in sync. No emoji anywhere. Only `react` from the loader.
- **Wake path**: the only way to make the agent run is `agent.followup(makeUserMessage(text, summary))`
  (see `deliver()` in `index.js`) and the `ctx.get('timer')` service. Study `inbound.registerPoll`.
- **Never guess**: ground every design decision in the files above; if a service is absent
  (`ctx.get(...)` returns undefined), degrade gracefully, do not crash.

## What already exists (do not rebuild)

Tools: `wa_overview, wa_analytics, wa_resolve_chat, wa_list_chats, wa_recent_activity,
wa_get_conversation, wa_export_conversation, wa_search_messages, wa_get_message,
wa_send_message, wa_react_to_message, wa_mark_read, wa_remember, wa_recall,
wa_record_lesson, wa_pending, wa_verify_sent`.
Memory store has facts/commitments/open-questions/contradictions/lessons per chat + global + cross-chat lessons.
`profile.js` has `defaultProfile, GATED_FIELDS, decideAction, validateProfile, PROFILE_VERSION, AUTONOMY_LEVELS, RISK_CLASSES`.

## Build order (each step must work before the next)

### 1. Profile persistence + tools

Extend `memory-store.js` so durable state includes a `profile` key (default `defaultProfile()`
on load when absent) plus a `proposals` list. Add store methods: `getProfile()`,
`setProfile(patch)`, `appendChangelog(entry)`, `addProposal(p)`, `updateProposal(id, patch)`,
`listProposals()`. Persist after every mutation (use the existing `persist()`).

In `index.js`, register:
- `wa_get_profile` — return the full profile + `proposals` + `changelog` tail.
- `wa_set_profile` — **reject** any field under `GATED_FIELDS` (return which fields are
  gated and must go through proposals); merge the rest; validate with `validateProfile`.
- `wa_propose_rule` — stage a gated change as a proposal `{id, at, path, before, after,
  reason, status:'proposed'}` and surface it to the owner (see step 3/4 for delivery).
- `wa_approve_rule` — `id` + `approve:boolean`; on approve, apply the change and append
  to `changelog` (`by:'owner'`); mark proposal `approved|rejected`.

### 2. Enriched briefing

Rewrite `memory-store.briefing()` to also emit, in this order: a one-line **profile summary**
(mission statement, autonomy level, proactive/draft toggles, active boundaries), then the
existing pending/recent/lessons sections, then a **next-wake** line (from step 4, omit while
not built) and a **needs-attention** line (stale commitments, open questions, contradictions).
Keep it compact — it is injected every turn.

### 3. Onboarding wake + WhatsApp interview

On plugin `apply()`, after `store.init()`: if `profile.state.onboarding !== 'done'`, enqueue an
`onboarding` intent (see step 4's queue; if step 4 isn't built yet, build a minimal enqueue now).
When the onboarding intent fires, the agent DMs the owner and runs the interview in
`docs/AGENT_PRESET_SPEC.md` §5, persisting each answer via `wa_set_profile`/`wa_propose_rule`
and advancing `profile.state.onboardingStep`. On explicit owner confirmation, set
`onboarding:'done'`. It must be **resumable** — interrupted chats pick up at `onboardingStep`.

Owner JID resolution: add a `ownerJid` config field (default `''`); if unset, treat the first
inbound non-group sender as the owner and persist it to `profile.identity.owner`.

### 4. Scheduler (wake queue + dumb ticker)

Add `src/lib/scheduler.js`:
- A **durable queue** of intents `{ id, at, kind, args, status:'queued'|'fired'|'skipped' }`,
  persisted via the memory store (new `state.wake` array).
- `enqueue({at,kind,args})`, `cancel(id)`, `due(now)`, `markFired(id)`.
- One ticker using `ctx.get('timer')` (mirror `inbound.registerPoll`): every ~30s, pop due
  intents, mark them `fired` **before** handing a structured wake prompt to
  `agent.followup`. The wake prompt states the kind + args and tells the agent to read the
  Profile and decide (via `decideAction` semantics) what to actually do.
- Register tools: `wa_schedule` (add a time-based intent), `wa_remind` (one-shot reminder),
  `wa_cancel` (remove an intent). These write into the same queue the host uses.
- Wire quiet-hours: an intent whose `at` falls inside `autonomy.quietHours` is deferred to
  the end of the window.

The ticker must be **dumb**: it never decides what to do, only when to wake.

### 5. Reflection + self-review

- **Post-turn hook (cheap)**: if a turn produced a lesson/contradiction via the memory tools,
  nothing extra is needed (already persists). Add a lightweight periodic `self-review` intent
  (enqueue every 24h): the agent dedupes/refines `lessons`, surfaces unresolved
  `contradictions` to the owner, and may emit `wa_propose_rule` proposals. Do not auto-commit
  any gated change.

### 6. Preset polish

Ensure `dsh/preset/whatsapp-agent/agent.cordis.yml` + `persona.md` are coherent with the new
tools (they already reference "propose, never silently commit" — verify nothing contradicts
the implemented tools). Add a `chief-of-staff` example Profile under `dsh/preset/` as a JSON
file showing `autonomy.level:'chief-of-staff'` (same persona, different Profile).

## Verification (must pass)

1. `node --check` on every `.js` file you touch (host uses ESM; `node --input-type=module -e`
   for import smoke tests).
2. Smoke-test `profile.js` paths: `decideAction` across levels/risk/forbidden/low-trust.
3. Smoke-test scheduler: enqueue a due intent, assert `due()` returns it, `markFired` idempotent.
4. `node --check dsh/lib/client.js` and `dsh/src/client.js` if you touch the client.
5. Restart DSH (`kill $(lsof -ti tcp:3080)` then `nohup dsh --profile pfc > /tmp/dsh.log 2>&1 &`)
   and confirm the new `wa_*` tools appear and `/whatsapp/panel/status` still responds.

## Done means

- Spec §8 fully implemented; profile/presets/scheduler/onboarding/reflection wired.
- All `node --check` and smoke tests green.
- A single clear commit message summarizing the change, then `git push origin main`.

If anything in the spec is ambiguous or conflicts with the code, note it in your final
message rather than silently guessing.
