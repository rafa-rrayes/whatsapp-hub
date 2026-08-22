# WhatsApp Agent Preset — Design Spec (v1)

A plan for a **highly competent, autonomous, self-correcting WhatsApp agent**
built on `@rafa/dsh-whatsapp-agent`. This document is the contract for the next
build phase; the Profile schema in `src/lib/profile.js` and the preset in
`preset/` are the concrete first artifacts.

Status: **design proposal — nothing below is wired yet.**

---

## 1. Three ambitions, three different layers

The wishlist folds into three orthogonal layers. Keeping them separate is what
makes the whole thing maintainable.

| Ambition | What it really requires | Where it lives |
|---|---|---|
| Competent, helpful, aware | rich tools + a rich briefing | already mostly built; enrich the briefing |
| Autonomous, "when to wake up" | a *reason to run* without a ping | **host capability** (scheduler) — the hard part |
| Self-aware, self-correcting, evolving | a reflect → record → re-inject loop | profile + memory + a periodic review |

An agent is not "on" all the time — it only runs when a turn fires. Today a
turn fires **only on inbound messages**. Autonomy is therefore not a prompt
property; it is a *wake* property.

---

## 2. The Profile (the spine)

Everything the agent is, does, and avoids is one durable object — the Profile.
It is the single source of truth, edited during onboarding and later, and
injected (summarized) into every briefing. Schema + defaults + validation live
in `src/lib/profile.js`.

### Two-speed model (safety)

- **FAST (agent-owned, no approval):** facts, commitments, questions,
  contradictions, lessons — the existing memory store. The agent writes these
  freely, every day. This is how it gets sharper.
- **SLOW (owner-gated):** the Profile's spine — `identity`, `mission`,
  `autonomy`, `boundaries`, `inboxPolicy`, `schedule`, `tone`. The agent reads
  all of it and **proposes** changes (`wa_propose_rule`), but a change only
  commits on owner approval and is appended to `changelog`.

This resolves the tension between "self-evolving" and "configurable by the
owner": the agent can never unilaterally raise its own autonomy or remove a
boundary.

### Shape (abridged — full defaults in `profile.js`)

```yaml
identity:     { name, role, owner: {jid,name}, language, timezone }
mission:      { statement, priorities[] }
autonomy:
  level:          assistant | autonomous | chief-of-staff
  proactiveSend:  bool        # may send without being pinged
  draftForApproval: bool      # prepare-and-ask for anything not auto-sent
  escalateWhen:   [kind...]   # sensitive | commitment | broadcast | ...
  quietHours:     { from, to, tz }
boundaries:   { allowed[], forbidden[], contacts: { jid: {trust, autonomyOverride, note} } }
inboxPolicy:  { respondTo, ignoreJids[], keywordsWake[], keywordsIgnore[], groupPolicy }
schedule:     { digest: {enabled,time,scope}, followUps: {enabled,windowHours}, reminders[] }
tone:         { style, brevity }
state:        { onboarding, onboardingStep }     # agent-owned
changelog:    [ {at,path,before,after,by} ]      # agent-owned
```

---

## 3. Autonomy decision model

One pure function, `decideAction(profile, action) → send | draft | refuse`,
consulted before every outbound write. Inputs: the action's **risk class**
(`info | social | logistics | commitment | sensitive | broadcast`), the profile's
autonomy level, per-contact trust, and the boundary rules.

| Level | Behavior |
|---|---|
| `assistant` | never sends proactively; drafts everything; replies only to direct asks |
| `autonomous` | sends low-risk (info/social/logistics) proactively; drafts high-risk |
| `chief-of-staff` | sends everything except `escalateWhen` triggers and `forbidden` rules |

`proactiveSend` and `draftForApproval` are independent toggles so onboarding can
produce *any* combination ("send low-risk proactively, draft the rest", "never
send but always draft", "send everything"). Per-contact `autonomyOverride` and
`trust` let the owner pin specific people higher or lower than the global level.

**Quiet hours:** no proactive send during quiet hours — the intent is queued and
fires on wake after the window.

---

## 4. Wake model + the scheduler

Wakes are the only thing that make autonomy real. They come in kinds:

| Kind | Trigger | Example |
|---|---|---|
| `inbound` | message arrived (existing webhook/poll) | reply to a contact |
| `onboarding` | first boot with empty profile | run the interview |
| `digest` | time-based | morning summary of unread + pending |
| `reminder` | time-based, agent-set | "remind me to X at 15:00" |
| `follow-up` | time-based | unanswered commitment older than N hours |
| `self-review` | time-based | periodic reflection + rule proposals |
| `keyword` | event-based | inbound text matches `keywordsWake` |

### Scheduler design (the maintainable core)

**One wake queue, one ticker, zero bespoke crons.** A single durable, persisted
queue of *intents* — `{ id, at, kind, args, status }` — is the only timing
surface. A low-frequency ticker (the plugin's existing `timer` service) pops
due intents and hands each to `agent.followup` as a structured wake prompt; it
decides *when* to wake, never *what* to do. Every wake reason — onboarding,
daily digest, reminders, follow-ups, self-review, keyword triggers — is just an
enqueue: the agent's own `wa_schedule` / `wa_remind` tools write into the same
queue, so the agent schedules itself through the exact same mechanism the host
uses. Because the queue is durable and each intent is marked `fired` before its
turn runs, restarts and overlaps are safe; because policy lives in the Profile
(not the ticker), changing behaviour never means changing the scheduler.

The ticker is deliberately dumb: it wakes the agent, the agent reads the Profile
and decides what (if anything) to actually send. Timing machinery = replaceable;
intelligence = model. That is the whole point.

---

## 5. Onboarding (first catch-up, in WhatsApp)

On first boot with an empty profile, the host enqueues an `onboarding` wake. The
agent **DMs the owner** and runs a short interview, persisting to the Profile as
it goes (gated fields via `wa_propose_rule`, fast facts via `wa_remember`).
Resumable: progress lives in `profile.state.onboardingStep`, so an interrupted
chat picks up where it left off.

Interview agenda (each step is one or two messages, not an interrogation):

1. **Who am I.** name, role, your name/language/timezone.
2. **Mission.** what should I exist for — your one-line brief + priorities.
3. **How I act.** tone, brevity, language; anything about your voice.
4. **What I may/may not do.** boundaries; people to never contact.
5. **Autonomy.** walk the level + proactive/draft toggles; per-contact overrides.
6. **When I wake.** digest time, follow-up window, quiet hours, reminder habits.
7. **Confirm.** restate the whole profile back, get an explicit "yes" (or edits),
   then mark `onboarding: done`.

Everything asked during onboarding is *also* editable later ("change your tone",
"stop messaging X", "from now on draft everything"), via the same Profile path —
so onboarding is not a special one-off, it's just the first profile edit.

---

## 6. Self-evolution (two-speed + changelog)

- **Fast loop (auto):** record lessons with `wa_record_lesson`, surface
  contradictions, update commitments — existing store, injected back every turn.
- **Slow loop (gated):** a periodic `self-review` wake where the agent (a)
  dedupes/refines lessons, (b) surfaces unresolved contradictions, and (c)
  *proposes* profile changes ("I keep drafting X that you always approve — set
  it to auto-send?"). Proposals commit only on owner "yes", appended to
  `changelog` so the owner can audit every self-modification.

This gives "self-correcting/evolving" teeth without autonomy drift: the agent
improves its *behaviour* freely, and improves its *rules* only with consent.

---

## 7. Awareness (briefing enrichment)

The briefing injected each turn grows from "pending + lessons" into a full
situational snapshot:

- profile summary (mission in one line, autonomy level, active boundaries)
- top chats by recency with a one-line state each
- next scheduled wake + its purpose
- needs-attention: stale commitments, open questions, contradictions
- recent lessons (already there)

Reuses `wa_analytics` + `wa_export` (already built). "Aware of everything" =
"everything that matters is in the briefing, and the briefing is the truth."

---

## 8. New plugin surface (to build)

- Profile store + `wa_get_profile` / `wa_set_profile` / `wa_propose_rule`.
- Bootstrap onboarding wake + resumable onboarding state.
- Scheduler (wake queue + ticker) + `wa_schedule` / `wa_remind` / `wa_cancel`.
- Reflection: post-turn hook (cheap) + periodic `self-review` wake.
- Enriched briefing builder.

The **preset** (below) carries the persona + the host capabilities (todo,
skills, memory). The **Profile** carries the behaviour. The **plugin** carries
the mechanics. No one file does two jobs.

---

## 9. Build order

1. Profile schema + store + `wa_get/set/propose` (this spec's first artifact).
2. Enriched briefing (biggest "awareness" win for the least risk).
3. Onboarding wake + WhatsApp interview (depends on 1).
4. Scheduler + `wa_schedule/remind` (depends on 1; enables autonomy).
5. Reflection + self-review wake (depends on 4).
6. Preset polish + chief-of-staff variant.

---

## 10. Open questions for the next iteration

- **Escalation delivery:** when the agent drafts-for-approval, does the draft go
  back to the owner in WhatsApp as a "send this? [yes/no]" message, to the DSH
  panel, or both?
- **Digest scope:** what exactly does the morning digest summarize, and to which
  chat does it go?
- **Multi-owner / delegate:** should the Profile support a second approved human
  who can also approve rule changes (e.g. "ask X if I'm not answering")?
- **Model/persona split:** should "chief-of-staff" be a separate preset persona,
  or always the same persona with a different `autonomy.level`? (Leaning: same
  persona; behaviour comes from the Profile.)
