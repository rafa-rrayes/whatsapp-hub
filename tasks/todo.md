# Port PFC's WhatsApp MCP lessons into whatsapp-hub

Source of the ideas: `/Users/Rafa/Code/Swift/PFC/backend/modules/whatsapp/`
(`tools.py`, `render.py`, `access.py`). That server is in-process, single-agent
and scoped-by-construction; ours is a remote, multi-consumer service. Port the
*ergonomics and safety*, not the architecture.

Guiding difference to keep in mind: PFC returns **prose written for a model**;
we mostly return `jsonResult(...)` — raw JIDs, unix timestamps, nested objects.
23 of our tool returns do this. Only `get_conversation` / `get_thread` /
`export_conversation` go through `renderConversation`.

---

## Tier 1 — ergonomics (this pass)

### 1. Prose foundation (`src/mcp/prose.ts`, new) — **done**
- [x] `formatStamp(tsSec, tz)` → `MM-DD HH:MM`, local, year added only when not
      the current year. PFC's rule: a bare `09:14` is worthless the moment it
      leaves the block it was rendered in.
- [x] `relativeAge(tsSec)` → `3m`, `2h`, `4d` for inbox lines.
- [x] `renderChatLine(chat)` — resolved name, never a raw JID. `maskJid()` is
      the escape hatch when there is no name anywhere: `…4821 (group)`.
- [x] `continuation(tool, args)` — renders a literal next call with arguments
      filled in, e.g. `get_conversation(chat="Família", last_n=50)`.
- [x] Unit tests. (35, `src/mcp/prose.test.ts`.)
- [x] `proseResult(text, structured)` in `src/mcp/types.ts` — the split
      `jsonResult` doesn't make: prose for the model, unchanged JSON for
      programmatic clients reading `structuredContent`.

### 2. Character budget on transcripts (`src/mcp/render.ts`) — **done**
- [x] `renderConversation` takes `budget` (chars). Drop oldest-first; the newest
      message always survives intact even if it alone exceeds the budget.
      Verified byte-identical to the old renderer over 2000 fuzzed pairs when
      no budget is passed.
- [x] When truncated, emit the continuation call — not just `truncated: true`
      (which is what `aggregation.ts:243` does today: tells the model something
      is missing but not how to get it). Caller supplies it as
      `truncation_hint`; the renderer can't know which tool called it and must
      not invent pagination advice.
- [x] `get_conversation` defaults `last_n: 50` with **no char cap** today. Wire
      a default budget through. Default 6000 chars, overridable per call via
      `max_chars` (500–200k). The truncation hint asks for **double** the current
      ceiling — a caller told "raise it" and left to guess by how much guesses
      too small and comes back twice. Suppressed when the chat has no name we
      can quote: `get_conversation(chat="…4821 (group)")` resolves to nothing,
      and an instruction that does not run is worse than generic advice.
- [x] Unit tests: under budget, over budget, single oversized message.
      (19, `src/mcp/render.test.ts`.)

### 3. `whatsapp_inbox` (`src/mcp/tools/inbox.ts`, new) — **done**
- [x] `whatsapp_overview` answers "how much data is there" (totals, top-active
      by volume). Nothing answers **"what needs me right now."** Add the triage
      screen: unread chats, who from, how many, last line, how long ago.
- [x] Prose out, `structuredContent` retained for programmatic clients.
- [x] Ends with the next call to make (`continuation()` from item 1).
- [x] `include_read` option for recently-active-but-read chats.
- [x] Register in `src/mcp/tools/index.ts`. (16 tools, probed end-to-end.)
- [x] Sender attribution on the preview line — `you` / the resolved participant
      in a group / nothing in an incoming DM. Cut as too costly on the first
      pass and put back: the item above literally says "who from", and
      `Ana Costa · 5h · ok, mando o arquivo` reads as Ana even when it was the
      user's own outgoing message. `idx_messages_remote_ts` makes it one index
      seek per *rendered* row (≤ 2×limit), not per candidate. No migration.

### 4. `mark_read` (`src/mcp/tools/actions.ts`) — **done**
- [x] Missing half of the inbox: no way to clear unread, so an agent that
      triages leaves the pile exactly as it found it and the next run re-reads it.
- [x] `connectionManager.markRead(jid, messageIds)` already exists
      (`manager.ts:384`). Needs unread message IDs + a local `unread_count` reset.
- [x] `chatsRepo.clearUnread(jid)` — direct `UPDATE`, not via `upsert` (which
      COALESCEs `unread_count` and would insert unknown JIDs).
- [x] **Bug found and fixed in `manager.markRead`:** it built keys with no
      `participant`. Baileys buckets receipts by
      `` `${remoteJid}:${participant || ''}` `` (`Utils/messages.js:769`), so
      every group read receipt was being sent unattributed. Signature widened to
      accept `{id, participant}` alongside plain strings, so the REST caller at
      `src/api/routes/actions.ts:136` is unaffected.
- [x] Counter is cleared only on the automatic path. A caller naming specific
      IDs may have acknowledged one old message out of twelve; zeroing there
      would leave the inbox claiming nothing is waiting. A stale unread count
      gets a chat triaged twice, a false zero drops it silently.
- [x] No raw JID in the wrong-chat error path — resolved name, else masked.

### 5. Prose conversion of the navigation read paths — **done**
- [x] `list_chats` → prose lines (keep `structuredContent`).
- [x] `resolve_contact` → prose candidates.
- [x] `whatsapp_overview` → prose summary.
- [x] `search_messages` → hits as prose, grouped by chat. No surrounding
      context: the tool never loaded any, and adding context queries would be a
      behaviour change rather than a rendering one. Left for a later pass.
- [x] Rule: `5511999999999@s.whatsapp.net` never appears in `content`. It is a
      privacy leak and a token wasted on noise. JIDs stay in `structuredContent`.
      Enforced in the dialect itself, not per tool: `looksLikeJid()` +
      `renderChatLine` treat a JID-shaped *name* as no name at all. Layers below
      hand one up routinely — the sync path writes whatever Baileys supplies
      into `chats.name`, and more than one lookup falls back to
      `name: row.name || row.jid`. One exception, deliberate: the caller's own
      query is echoed **raw** inside a continuation call. Masking it there
      produces a call that runs and returns nothing. The rule exists to stop the
      *database* handing a model identifiers it never had; the caller's own
      search term fails that test on both counts.

### Verify
- [x] `npx tsc --noEmit` clean.
- [x] `npm test` green (no regressions in the 15 existing suites). **409/409
      across 20 files** (291 before this work; 118 new).
      Note: the default `node` here is v26 and `better-sqlite3-multiple-ciphers`
      is built for Node 22, so the suite only runs under
      `PATH="/opt/homebrew/opt/node@22/bin:$PATH" npx vitest run`. Pre-existing,
      unrelated to this work, not fixed here — rebuilding the native module
      would break whatever runtime the hub actually deploys with.
- [x] Tool list still registers end-to-end. Probed over an in-memory MCP
      transport: **16 tools**, `mark_read` and `whatsapp_inbox` among them.

---

## Tier 2 — safety & input handling (next pass)

- [ ] **Connection-state honesty.** MCP tools query SQLite with no idea whether
      Baileys is connected: a disconnected hub returns stale data as if live.
      Reads should survive and append the caveat ("you are reading the local
      mirror, anything sent since the connection dropped is missing from it");
      writes should stop with a fix instruction. `connectionManager` is already
      imported in `actions.ts`.
- [ ] **Ambiguity, last 20%.** `resolveOne` (`resolve.ts:170`) flags ambiguity
      only when the top two scores are within 100 points — an arbitrary cliff.
      Worse, it misses the failure mode that actually bites: right *person*,
      wrong *chat*. Port PFC's "the same person is also in:" listing, plus the
      contact-card fallback when no chat matches.
- [ ] **Forgiving input.** `z.number().int()` rejects `"20"`; models pass strings
      as often as numbers. Use `z.coerce.number()`. Bigger win: a duration parser
      (`"2h"`, `"45m"`, `"3d"`, `"today"`, `"yesterday"`, ISO) — `recent_activity`
      takes a fixed 5-value enum today, and an agent waking up has a duration in
      mind, not a timestamp.
- [ ] **Counting past the pool.** `list_chats` and `whatsapp_inbox` run their
      filters *in memory* over a fetched pool (`min(1000, max(limit*5, 200))`),
      so neither can see a chat past its ceiling and neither can report a true
      total. Tier 1 made the prose honest about it ("At least 200 chats … 200 is
      a floor, not a total") but the root fix is a filtered-count API on
      `chatsRepo` that pushes the filters into SQL — a refactor across three
      tools, which is why it is here and not there. Same bug class as the
      `search_messages` `types` overcount already fixed at `messages.ts:216`.
- [ ] **Short stable handles** (`chat:familia`, `msg:a91c3f`). We put 40-char
      Baileys IDs and full JIDs through the model's context. Needs a handle
      derivation + reverse lookup; biggest token/privacy win of the lot.

## Tier 3 — per-caller scoping (architectural)

- [ ] One API key or token ⇒ every chat + send. That's the real gap for a shared
      service. `transport.ts` builds a **fresh `McpServer` per POST**, so
      `buildMcpServer()` only needs to take the auth context.
- [ ] Hang a chat allowlist + `can_send` off the OAuth token store
      (`src/mcp/oauth/store.ts`).
- [ ] Two rules stack, both worth copying: a `private` flag hiding a chat from
      *every* caller unconditionally, and a per-caller allowlist for the rest.
- [ ] Build the tool list per caller — a read-only token never sees
      `send_message` registered. "A tool that isn't in the list cannot be called,
      argued with, or jailbroken into existence."

## Explicitly not porting

- **Triggers/debounce** (`triggers.py`) — we have webhooks + WebSocket already.
  Waking agents is a consumer's job.
- **Media as a filesystem path** — works for PFC because the agent is on the same
  box. We're remote; `/api/media/:id/download` is right. The remote-correct
  version of that idea is returning an MCP *image content block* so a model can
  actually look at a photo — separate piece of work.
- **Shrinking to PFC's nine tools** — `export_conversation`, `list_media` and
  `sync_history` serve non-agent consumers.

## Review

**Tier 1 is done.** `npx tsc --noEmit` clean, 409/409 tests across 20 files, 16
tools registering end-to-end over an in-memory MCP transport.

What actually shipped, in one line each:

- **`src/mcp/prose.ts` (new)** — the dialect. Resolved identity or a mask, never
  a JID; always-dated local `MM-DD HH:MM`; every truncation naming the literal
  call that continues it. Three rules, one place to tune them.
- **`proseResult(text, structured)`** — the split `jsonResult` never made. Prose
  for the model in `content`, the unchanged object in `structuredContent`. Every
  conversion below is additive for programmatic clients: no field was removed.
- **Character budgets on transcripts** — oldest dropped first, newest always
  whole, and the note says how many went. Verified byte-identical to the old
  renderer over 2000 fuzzed pairs when no budget is passed.
- **`whatsapp_inbox` (new)** and **`mark_read`** — the two halves of triage. One
  says what needs you, the other clears it. Neither was possible before.
- **Four read paths converted to prose** — `list_chats`, `resolve_contact`,
  `whatsapp_overview`, `search_messages`.

### Bugs found on the way, all fixed

1. **`manager.markRead` sent every group read receipt unattributed.** Baileys
   buckets receipts by `` `${remoteJid}:${participant || ''}` ``
   (`Utils/messages.js:769`) and we built keys with no `participant`, so group
   receipts landed in the wrong bucket. Pre-existing, unrelated to rendering,
   and only visible because `mark_read` was the first caller to exercise the
   group path. Signature widened rather than changed — the REST caller at
   `src/api/routes/actions.ts:136` is untouched.
2. **`search_messages` overcounted `types`.** The count came off a pool capped
   at `Math.min(500, finalLimit * 5)`, which also silently dropped matches past
   500. Latent while it sat in a JSON `total` nobody read; the prose promoted it
   to "… 35 more matches" *plus a call that fetches them*, so the rendering
   change is what made the number load-bearing. Fixed at the source with a
   bound-parameter `IN (…)` on `messages.ts` rather than papered over.
3. **`list_chats` claimed a total it could not see.** Same class as (2) and the
   dangerous shape: filters cut the count below `limit`, so no truncation marker
   appeared and a partial listing read as exhaustive. Made honest here, root
   cause filed under Tier 2.

### Judgement calls worth recording

- **Rendering-only where the root fix is a refactor.** (3) above got an honest
  sentence, not a `chatsRepo` redesign touching three tools. (2) got the real
  fix because it was six lines in one repository method.
- **`mark_read` clears the unread counter only on the automatic path.** A caller
  naming specific IDs may have acknowledged one old message out of twelve;
  zeroing there would leave the inbox claiming nothing is waiting. A stale
  unread count gets a chat triaged twice, a false zero drops it silently.
- **`mark_read` still takes a JID and only a JID**, which sits awkwardly beside
  a dialect that forbids printing one. The codebase's rule — "all targeting
  requires a JID (no fuzzy name matching)… prevents 'sent to wrong Maria'
  errors" — was written for *write* tools, and this is one. Loosening it is a
  design decision to weigh deliberately, not something to slip into a rendering
  pass. **Flagged for you.** In practice a model reaches `mark_read` holding the
  JID from `whatsapp_inbox`'s `structuredContent`, so nothing is blocked today.
