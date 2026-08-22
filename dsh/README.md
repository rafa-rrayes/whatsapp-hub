# DSH WhatsApp Agent (`@rafa/dsh-whatsapp-agent`)

A Host-only DeepSeek Harness plugin that turns your `whatsapp-hub` into a
reliable, persistent agent environment. Read `DESIGN.md` for the full model;
this file is the install/run guide.

## What it gives you

- **Inbound**: an HMAC-verified webhook receiver plus a reconciliation poll, so
  every WhatsApp message reaches the agent at-least-once and exactly-once
  (dedup by message id).
- **Outbound**: a write-ahead outbox with idempotency — the agent can never
  double-send, and can verify delivery.
- **Memory**: durable per-chat + cross-chat state, open questions, commitments,
  contradictions, and lessons, injected as a situational briefing every turn.
- **Tools**: a `wa_*` tool surface that reads ground truth from the hub and
  guards every write with a resolved-JID requirement.
- **A dedicated persistent agent** running a reliability "Operating Contract".

## Layout

```
dsh/
├── DESIGN.md                          # architecture + reliability model
├── README.md                          # this file
├── package.json                       # plugin manifest
├── src/
│   ├── index.js                       # plugin entry (tools, webhook, agent, panel routes)
│   ├── client.js                      # client reference source (plain ESM)
│   ├── operating-contract.md          # human-readable contract
│   └── lib/
│       ├── hub-client.js              # whatsapp-hub REST client
│       ├── inbound.js                 # webhook + reconciliation poll
│       ├── memory-store.js            # durable memory + briefing
│       ├── outbox.js                  # write-ahead idempotent sends
│       └── operating-contract.js      # the contract string
├── lib/
│   └── client.js                      # pre-built client bundle (what actually loads)
├── skills/
│   └── chat-reports/SKILL.md          # multi-subagent per-chat report playbook
└── preset/
    └── agent.cordis.yml.example       # optional additive preset template
```

## Install (permanent)

The plugin is a **host-plane** row (one webhook route, one outbox, one
dedicated agent), and it is a **zero-dependency bundle** — host half imports
only node builtins + relative files, and the client half is pre-built to
`lib/client.js` — so it installs into a profile's `node_modules` exactly like
`dsh-memory-evolve`.

1. Install it into your profile (this adds the dependency AND registers it as a
   bundle layer — no manual composition edit):

   ```bash
   dsh plugin --profile web add /Users/Rafa/Code/Misc/whatsapp-hub/dsh
   ```

   (`dsh plugin` forwards to `pnpm add` in the profile dir, then reconciles
   `dsh.profile.bundles` — a dependency whose package declares `dsh.bundle`
   joins the layer stack automatically.)

2. Configure `whatsapp-hub`:

   ```env
   # .env of whatsapp-hub
   API_KEY=<a strong key — same value the plugin will use>
   WEBHOOK_SECRET=<a strong secret — same value the plugin will use>
   ```

   Then register the webhook (or use the hub dashboard) pointing at the DSH
   route, e.g. `POST /api/webhooks` with
   `{ "url": "http://127.0.0.1:3080/whatsapp/webhook", "secret": "<WEBHOOK_SECRET>", "events": "wa.messages.upsert" }`.

3. Restart DSH. On first boot the plugin creates the `whatsapp-agent` session;
   on later boots it resumes the persisted session (durable memory loaded from
   `stateFile`). You can then set the API key / hub URL either in the profile
   `cordis.patch.yml` (config override) or live in **Settings → WhatsApp Agent**.


## Settings panel (DSH web)

The package ships a **"WhatsApp Agent"** page in the DSH web Settings panel —
a **permanent** client half, unlike the dynamic demo below. It's a live bridge
dashboard: connection state, 7-day message analytics, runtime config editing,
a test send, the outbox activity log, and durable memory (pending commitments
+ lessons).

The client half rides the deployment's client-module build:

1. `package.json` declares `dsh.client` (platform `web`, injects
   `@deepseek-ai/dsh-client-runtime`) and exports `./client` → `lib/client.js`.
2. Once the package is installed and mounted in the host composition, DSH's
   client-module scanner serves that file as a `window.__ModuleLoader__` bundle
   at `/plugins/@rafa/dsh-whatsapp-agent/client.js` — the section then appears
   under **Settings → WhatsApp Agent**. `src/client.js` is the readable ESM
   reference source; `lib/client.js` is the hand-maintained bundle that actually
   loads. **Keep them in sync.**
3. The panel calls the Host through these same-origin routes (see `src/index.js`):

   | Route | Purpose |
   |---|---|
   | `GET /whatsapp/panel/status` | connection + hub overview + 7-day analytics + memory + recent outbox |
   | `GET /whatsapp/panel/outbox` | full activity log (recent sends) |
   | `GET / POST /whatsapp/panel/config` | read / update runtime config |
   | `POST /whatsapp/panel/test-send` | send a test message through the outbox |

The panel themes itself off the `--dsw-*` design tokens (one self-injected
`<style>` tag) and uses only `react` from the loader — no emoji, inline SVG
icons, and a desaturated teal accent.

Runtime edits (hub URL, API key, webhook secret, poll interval) take effect
immediately and reset to the composition `config` on the next reload. The panel
uses plain `fetch` to the Host's own routes (simpler than a typed Typert Remote
service, and sufficient for a local panel; a typed Remote is a possible upgrade).

## Try it without changing the host composition (dynamic demo)

The same behavior can be demonstrated in a running session as a **dynamic
Cordis plugin** (see the agent session that built this). The dynamic slice is a
restricted-VM re-implementation that:

- registers the same `wa_*` tools,
- registers `/whatsapp/webhook` and `/whatsapp/webhook/status` on the DSH web
  server,
- runs the reconciliation poll and the durable-memory/outbox machinery,

with real HTTP done through the `shell` service (`node` fetch) when
`WH_API_KEY`/`WH_HUB_URL` are set, and a dry-run `echoMode` otherwise.

Verify it live:

```bash
curl -s http://127.0.0.1:3080/whatsapp/webhook/status
```

## Tool reference

Read: `wa_overview`, `wa_analytics`, `wa_resolve_chat`, `wa_list_chats`,
`wa_recent_activity`, `wa_get_conversation`, `wa_export_conversation`,
`wa_search_messages`, `wa_get_message`.

Write: `wa_send_message`, `wa_react_to_message`, `wa_mark_read`.

Reliability/memory: `wa_remember`, `wa_recall`, `wa_record_lesson`,
`wa_pending`, `wa_verify_sent`.

### `wa_overview` connection metadata

`wa_overview` now returns a `hub` block — `url`, `apiKeySet`, `echoMode`, and
live `connected` (a `/health` probe) — so the agent can tell "hub down" apart
from "auth rejected" and orient before any other tool call.

### `wa_analytics`

`wa_analytics` answers "how many messages did I receive/send in the last N
days, from how many chats" in a single call. It proxies the hub's
`GET /api/stats/analytics`:

```text
wa_analytics(days=7)
→ totals: { total, sent, received, distinctChats, ... }
  byDay:  [{ day, total, sent, received }]
  byChat: [{ remote_jid, count, sent, received, last_ts }]
```

`distinctChats` is the count of distinct chats with messages in the window —
no paging through history needed. Older hub builds that lack the field return
`distinctChats: null` and the tool still works.

### `wa_export_conversation`

`wa_export_conversation` is the "entire conversation for N days" primitive. It
proxies the hub's export pipeline (`POST /api/export`) and returns a rendered
transcript inline — markdown by default, or `txt`/`json`:

```text
wa_export_conversation(days=7, chats=["<jid>"], preset="llm", format="md", max_messages=5000)
→ { ok, format, content }   # content is the full transcript
```

`preset` controls field depth (`concise` / `full` / `llm` / `archive`); omit
`days` for all-time (bounded by `max_messages`). This is what makes
multi-chat analysis possible — unlike `wa_get_conversation`, which only pages
recent messages.

### `chat-reports` skill

For "analyze N chats and give me a report", pair `wa_export_conversation` with
the bundled `chat-reports` skill (`dsh/skills/chat-reports/`). It encodes the
fan-out pattern: pick chats with `wa_analytics`/`wa_list_chats`, spawn one
subagent per chat (each fetches its own export and writes a bounded report),
then merge into a summary. Install it by symlinking into your DSH skills dir:

```bash
ln -sfn "$(pwd)/dsh/skills/chat-reports" ~/.agents/skills/chat-reports
```

This keeps the plugin as the data seam and the skill as the orchestration
playbook — no monolithic "report" tool that inlines megabytes of transcript.

## Direct HTTP access to the hub (tooling note)

The plugin talks to the hub over the same REST API you can call yourself. If
you script against `hubUrl` directly (curl, Python, Go, …), keep two things in
mind:

1. **Auth**: every `/api/*` call needs the hub API key, the same `apiKey` the
   plugin uses:

   ```bash
   curl -s -H "x-api-key: <API_KEY>" \
     "https://<hub>/api/stats/analytics?days=7"
   ```

2. **User-Agent**: the edge/anti-bot layer in front of a public hub rejects
   requests whose `User-Agent` looks like an HTTP library (e.g. `Python-urllib/…`
   gets `403 Forbidden`). Send a browser-like UA:

   ```bash
   curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
     -H "x-api-key: <API_KEY>" \
     "https://<hub>/api/stats/analytics?days=7"
   ```

   If you get a bare `403` with a valid key, this is the usual cause.

## Configuration

| Field | Default | Purpose |
|---|---|---|
| `hubUrl` | `http://127.0.0.1:3100` | whatsapp-hub base URL |
| `apiKey` | `""` | hub API key for outbound |
| `webhookSecret` | `""` | HMAC secret (empty = skip verification) |
| `webhookPath` | `/whatsapp/webhook` | inbound route |
| `agentSessionId` | `whatsapp-agent` | dedicated agent session id |
| `agentPreset` | `""` | optional additive preset id |
| `model` / `provider` | `""` | optional agent model override |
| `pollMs` | `60000` | reconciliation poll (0 = off) |
| `stateFile` | `.whatsapp-agent-state.json` | durable memory file |
| `echoMode` | `false` | dry-run tools (safe testing) |

## Security notes

- Always set `webhookSecret`; the receiver rejects unsigned/mismatched webhooks
  with 401.
- The hub API key is used only for outbound calls to the configured `hubUrl`.
  Keep it out of the session log and out of tool output.
- The plugin runs as trusted same-process code (like any DSH plugin); mount it
  only on a deployment you operate.

## Known limits (v1)

- Sending media is not wired yet (text/reaction/read are). Read-side media and
  voice transcription already flow through `wa_get_conversation`.
- Delivery/read-receipt verification (`wa_verify_sent`) confirms hub acceptance
  and storage; full receipt-status polling can be added on top of the hub's
  receipt feed.
- One persistent agent with per-chat memory (not one agent per contact).
