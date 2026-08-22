# Reliable WhatsApp Agent — Design

This document describes how DeepSeek Harness (DSH) is wired to `whatsapp-hub` so
that WhatsApp becomes a dependable environment for a **persistent AI agent** —
not merely a channel where a model occasionally produces a good reply.

The guiding principle: **the harness, not just the model, must make the agent
dependable.** The model is given good context and good tools, but every failure
mode we care about (missed messages, forgotten context, hallucinated facts,
wrong assumptions, duplicate actions, acting before it knows enough) is
*mechanically* guarded against by the plugin, the memory model, and the preset —
not left to prompt-hoping alone.

---

## 1. System view

```
WhatsApp  ⇄  Baileys (whatsapp-hub)
                 │
                 │  REST API  (x-api-key)   ── outbound: agent tools → hub
                 │  Webhooks  (HMAC)        ── inbound:  hub → DSH receiver
                 ▼
        ┌──────────────────────────────────────────────┐
        │  DSH host plugin  (this package)             │
        │                                              │
        │  ┌──────────┐  ┌─────────┐  ┌────────────┐  │
        │  │ Inbound  │  │ Outbox  │  │  Memory    │  │
        │  │ receiver │  │  (dedup │  │  store     │  │
        │  │ + dedup  │  │  + ack) │  │  (per-chat │  │
        │  │ + recons.│  └─────────┘  │   durable) │  │
        │  └──────────┘               └────────────┘  │
        │                                              │
        │  Tools (wa_*) registered for the agent        │
        └───────────────┬──────────────────────────────┘
                        │  agent.followup()  /  agent.inject()
                        ▼
        ┌──────────────────────────────────────────────┐
        │  Dedicated persistent agent session           │
        │  (preset: whatsapp-agent)                     │
        │    • WhatsApp read/write tools                │
        │    • Reliability "Operating Contract" prompt  │
        │    • Long-term memory (memory/recall)         │
        └──────────────────────────────────────────────┘
```

**Two planes, two lifetimes.**

- `whatsapp-hub` is the *infrastructure* (connection, storage, REST/WS/webhooks).
  It is not modified by this work except for configuration.
- DeepSeek Harness is the *agent runtime*. The plugin is the seam that turns
  WhatsApp traffic into agent turns and agent decisions into WhatsApp sends.

The plugin is **Host-only** (no Client/browser UI): everything it does is
files/networking/agent plumbing, which belongs on the Host plane.

---

## 2. The seam: two halves of the loop

### 2.1 Inbound (WhatsApp → agent)

1. A message arrives at `whatsapp-hub` and is stored (SQLite) by Baileys.
2. `whatsapp-hub` fires a `wa.messages.upsert` webhook to the plugin's route
   (`POST /whatsapp/webhook`) with headers `X-Hub-Event`, `X-Hub-Timestamp`,
   and `X-Hub-Signature: sha256=<HMAC>`.
3. The plugin **validates the HMAC**, then **dedups** on the message id.
4. The plugin extracts only *identity* fields (message id, chat JID, sender,
   `fromMe`, timestamp) — not rich content. Rich content is fetched later,
   through the hub's own renderers (single source of truth).
5. The plugin **injects a situational briefing** (per-chat state — §5) and
   delivers a notice to the dedicated agent via `agent.followup(...)`.
6. The agent reads the full rendered message + context through tools
   (`wa_recent_activity`, `wa_get_conversation`) and decides.

**Why webhook = signal, not content.** Parsing raw Baileys protocol messages in
the plugin would duplicate fragile logic and drift from the hub. The hub already
renders messages correctly (names, media, transcriptions, reactions, quotes).
The webhook therefore carries only "something happened at (chat, message-id)";
the agent fetches ground truth through the hub's own tools. This also means a
**reconciliation poll** can replay the same "something happened" signal from the
REST API when a webhook is lost (hub restarted, DSH restarted, network blip).

### 2.2 Outbound (agent → WhatsApp)

1. The agent calls `wa_send_message` (or a media/reaction tool).
2. The tool **verifies the target** (JID must resolve) and **records the send in
   the outbox** with an idempotency key before dispatching.
3. The tool POSTs to `whatsapp-hub` and records the returned message id +
   delivery receipt state.
4. `wa_verify_sent` lets the agent confirm delivery/read receipts before it
   *claims* success to the user.

---

## 3. Reliability model — failures and their mechanical guards

This is the heart of the design. Each reliability requirement from the brief is
paired with a mechanism that is enforced by the harness, not assumed of the
model.

| # | Failure mode | Mechanical guard | Where |
|---|---|---|---|
| 1 | **Missed instructions** (webhook lost, DSH down) | At-least-once delivery: hub retries 5× with backoff; plugin dedups. **Reconciliation poll** re-scans `recent_activity` and injects anything the webhook missed. | inbound receiver + poll |
| 2 | **Duplicate handling** (retries, re-delivery) | Idempotency by message id (inbound) and by (JID, content-hash, window) (outbound). A seen-id set is durable. | inbound + outbox |
| 3 | **Forgotten context** (long-running chats) | **Situational briefing** injected before each inbound turn: who this is, rolling summary, open questions, commitments. The model does not rely on its own fading context. | memory store + `agent.inject` |
| 4 | **Hallucinated facts** | The agent has **retrieval tools first**; the Operating Contract mandates read-before-answer. Writes require a **resolved JID**, never a guessed one. | tools + preset |
| 5 | **Incorrect assumptions** | Per-chat "open questions" and "assumptions pending verification" are surfaced in the briefing and must be resolved or explicitly flagged. | memory store + preset |
| 6 | **Duplicate / mistaken actions** | Outbox idempotency + an **action log** (what was sent, when, to whom, verified) the agent checks before acting. | outbox |
| 7 | **Acting before enough info** | Write tools are `readOnlyHint:false` and the Operating Contract requires a *verify → decide → act* order; `wa_send_message` refuses unresolved JIDs. | tools + preset |
| 8 | **Uncertainty hidden as certainty** | The Operating Contract defines an explicit confidence vocabulary; `wa_remember` stores uncertainty instead of letting it evaporate. | preset + memory |
| 9 | **Contradictions unnoticed** | Memory records *assertions* with provenance; a later assertion that conflicts is stored as a **contradiction** and surfaced in the briefing rather than silently overwritten. | memory store |
| 10 | **Repeated mistakes, no learning** | A `wa_record_lesson` tool + a turn-close reflection hook persist "what happened, why it went wrong, what to do next time"; lessons are injected into future briefings. | memory store + `agent/turn-stopping` |
| 11 | **Lost writes / uncertain send** | Outbox write-ahead: the intent is durable before the HTTP call; delivery state is pollable; failures are recorded as `pending` for retry. | outbox |

The rest of this section details the non-obvious mechanisms.

### 3.1 At-least-once inbound, exactly-once handling

- `whatsapp-hub` retries failed webhooks (5 attempts, exponential backoff) and
  keeps a delivery log. We treat delivery as **at-least-once**.
- The plugin keeps a **seen-id set** (`seenMessages`) keyed by hub message id.
  A duplicate id is acknowledged (200) and dropped. The set is persisted and
  pruned (keep the last N ids / TTL).
- Because the webhook carries only identity, the **reconciliation poll** (every
  60s by default) calls `recent_activity` and diffs against `seenMessages`; any
  gap becomes the same "something happened" notice. This is the backstop that
  makes "consistently notice everything" true even across restarts of either
  process.

### 3.2 Outbox (write-ahead, idempotent, verifiable)

Each outbound action is a durable record:

```jsonc
{
  "key": "wa:<jid>:<hash>",        // idempotency key
  "kind": "text",                  // text | media | reaction | read
  "jid": "5511…@s.whatsapp.net",
  "payload": { "text": "…" },
  "status": "pending",             // pending → sent → delivered/read/failed
  "hubMessageId": null,
  "createdAt": 1712345678901,
  "attempts": 0,
  "lastError": null
}
```

- **Write-ahead**: the record is persisted *before* the HTTP call.
- **Idempotency**: a send with the same key inside a short window is refused
  ("already sent at …"). The key mixes chat, content hash, and a time bucket so
  legitimate repeats are allowed but accidental doubles are not.
- **Verification**: `wa_verify_sent` polls the hub's message/receipt data so the
  agent distinguishes "queued" from "delivered" instead of guessing.

### 3.3 Mistake → learning loop

- **During the turn**: the agent uses `wa_remember` / `wa_record_lesson` to
  persist anything worth keeping (a correction, a discovered preference, a
  mistake it caught).
- **At turn close**: the plugin listens to the `agent/turn-stopping` (serial)
  event and appends a lightweight *turn record* to the action log — not the full
  transcript, just "what was decided / sent / left open". This is the audit
  trail that lets a future turn answer "did I already do this?" without
  re-reading the entire session log.
- **On next briefing**: relevant lessons and open items for that chat are
  injected, so learning is *used*, not just stored.

---

## 4. Tool surface (the agent's verified API to WhatsApp)

Tools mirror the hub's MCP tools (single renderer/source of truth) but add the
reliability semantics (verified JID, outbox, memory). Read tools are safe and
plentiful; write tools are few, guarded, and verifiable.

**Read**

| Tool | Purpose |
|---|---|
| `wa_overview` | Dashboard totals + connection state (hub URL, key set, live probe). First call to orient. |
| `wa_analytics` | Trailing-window totals with sent/received split + distinct chats; per-day and per-chat breakdowns. Answers "how many did I receive, from how many chats" in one call. |
| `wa_resolve_chat` | Fuzzy name/phone/JID → ranked candidate chats. **Required before any write.** |
| `wa_list_chats` | Browse chats (unread, group/DM, name, recency). |
| `wa_recent_activity` | Activity over a window (summary / firehose). |
| `wa_get_conversation` | Render one chat as markdown (last N / window). |
| `wa_export_conversation` | Full-transcript export for a window / chat set (the "analyze N days" primitive). |
| `wa_search_messages` | Full-text search with snippets. |
| `wa_get_message` | One message by id with full context. |
| `wa_get_thread` | Walk the quote chain backward. |

**Write** (all `readOnlyHint:false`, all recorded in the outbox)

| Tool | Purpose |
|---|---|
| `wa_send_message` | Send text. Refuses unresolved JIDs. |
| `wa_react_to_message` | Add/replace/remove a reaction. |
| `wa_mark_read` | Mark a chat read. |

**Reliability / memory** (plugin-owned durable store, not the hub)

| Tool | Purpose |
|---|---|
| `wa_remember` | Persist a fact/commitment/preference/note scoped to a chat (or global). |
| `wa_recall` | Read memory: chat state, open questions, commitments, lessons. |
| `wa_record_lesson` | Persist a correction/lesson with a cause (drives the learning loop). |
| `wa_pending` | List open questions/commitments for a chat (what still needs verifying). |
| `wa_verify_sent` | Poll delivery/read receipt for a prior outbox send. |

The full set is implemented in the plugin; the dynamic demo registers the same
set so the behavior is identical in both paths.

---

## 5. Memory model (four layers)

Context is layered by **durability** and **scope**, and each layer has a single
owner.

1. **Session log** (DSH `sessionPersistence` / `sessionQuery`). The full
   transcript. Ground truth of *what actually happened*. Searchable, replayable,
   survives restart. The agent reads it via normal turn context and compaction.
2. **Per-chat state** (plugin memory store, `storageDomain`). One record per
   chat JID:

   ```jsonc
   {
     "jid": "5511…@s.whatsapp.net",
     "alias": "Rafa",
     "summary": "…rolling 1–2 line state…",
     "facts": [ { "fact": "…", "provenance": "said on 2026-08-12", "at": 1712… } ],
     "openQuestions": [ { "q": "…", "asked": 1712… } ],
     "commitments": [ { "what": "…", "due": 1712…, "done": false } ],
     "contradictions": [ { "a": "…", "b": "…", "at": 1712… } ],
     "lessons": [ { "lesson": "…", "cause": "…", "at": 1712… } ],
     "lastSeen": 1712…
   }
   ```

   This is the **situational briefing** source.
3. **Cross-chat / global long-term memory** (the `memory` tool, when the preset
   includes `memory-evolve`). Facts about *people* and *standing instructions*
   that outlive any single chat: names, preferences, "never do X", project
   state. This is where "become more reliable over time" lives beyond one chat.
4. **Action/audit log** (outbox + turn records). What was sent, when, verified
   status. Enables idempotency, accountability, and "did I already do this".

**Briefing injection.** Before an inbound turn, the plugin builds a compact text
block from layer 2 (+ relevant layer 3 via `wa_recall`) and injects it with
`agent.inject(...)` (model-facing context, no wake) *before* the follow-up. The
Operating Contract tells the agent to treat the briefing as authoritative
current state and to **update** it through the memory tools as facts change.

---

## 6. The dedicated agent + preset

The plugin ensures a persistent agent exists (`agents.create` on first boot,
`agents.resume` thereafter), with a fixed session id (default `whatsapp-agent`).

The agent runs a **preset** (`dsh/preset/agent.cordis.yml`) that composes:

- this WhatsApp plugin (tools + receiver + memory),
- the reliability **Operating Contract** system prompt (`dsh/src/operating-contract.md`),
- `memory-evolve` (long-term memory + `memory`/`recall`), and
- the host's sandbox/approval rows (inherited).

The Operating Contract encodes the *behavioral* half of reliability:

- **Verify before acting**: read the rendered message + context before replying;
  resolve the recipient before sending; never guess facts or JIDs.
- **State uncertainty explicitly**: use a fixed confidence vocabulary
  (`certain` / `likely` / `unsure` / `unknown`) and prefer "I don't know — let
  me check" over a guess.
- **Persist, don't drift**: update per-chat memory and long-term memory as facts
  and commitments change; acknowledge commitments explicitly.
- **Check before acting twice**: consult the action log / pending list before
  sending to avoid duplicates.
- **Own mistakes**: when something went wrong, record a lesson with a cause.
- **Never act on a message the harness didn't route**: treat injected briefings
  as authoritative, not optional flavor.

---

## 7. Failure & security model

**Failure containment.** Every component owns a disposer and lives in the plugin
fiber (`ctx.effect`, `ctx.on`, route disposers, `timer.interval`). A webhook
error, a hub outage, or a tool failure is caught and recorded; it never crashes
the agent or the harness. If the hub is down, sends stay `pending` in the outbox
and the poll retries.

**Security.**

- Webhook requests are authenticated with HMAC-SHA256 (`X-Hub-Signature`) when a
  secret is configured; unsigned/mismatched requests are rejected 401.
- Outbound calls to `whatsapp-hub` use the API key (`x-api-key`) and are
  restricted to the configured hub origin (no open SSRF — the hub URL is
  configuration, and the same-origin check the hub applies on *its* side is
  preserved).
- The plugin never stores the hub API key in the session log or in tool output.

**Trust boundary.** The plugin is trusted same-process code (like any DSH
plugin); it is mounted only in the dedicated agent's preset (per-session realm)
or, if shared, in the host composition by an operator who owns the deployment.

---

## 8. Deployment & configuration

Configuration is a schemastery `Config` object (plus env fallbacks for the
dynamic demo):

| Field | Default | Purpose |
|---|---|---|
| `hubUrl` | `http://127.0.0.1:3100` | `whatsapp-hub` base URL |
| `apiKey` | `env WH_API_KEY` | hub API key (outbound) |
| `webhookSecret` | `env WH_WEBHOOK_SECRET` | HMAC secret (inbound) |
| `webhookPath` | `/whatsapp/webhook` | inbound route on the DSH web server |
| `agentSessionId` | `whatsapp-agent` | dedicated agent session id |
| `pollMs` | `60000` | reconciliation poll interval (0 = off) |
| `echoMode` | `false` | dry-run tools (no live hub) for safe testing |

`whatsapp-hub` side: add a webhook subscription pointing at the DSH route with
the shared secret, and (for the backstop) ensure `recent_activity`/REST is
reachable with the API key. See `dsh/README.md` for the exact steps.

---

## 9. What is *not* solved here (honest limits)

- **Message content extraction** is delegated to the hub's renderers; the plugin
  does not parse Baileys protocol messages (intentional — see §2.1).
- **Media upload** (sending images/video) is out of scope for v1; text/reaction/
  read are covered. Read-side media (images, voice transcription) already works
  through `wa_get_conversation`.
- **Multi-agent fan-out** (one agent per contact) is a future extension; v1 uses
  one persistent agent with per-chat memory, which is the right tradeoff for a
  personal assistant where cross-chat context matters.
- **Host-composition permanence** is an operator step (mounting the package in
  the deployment), documented in the README; this repo ships the package +
  preset + a dynamic demonstration that runs immediately.
