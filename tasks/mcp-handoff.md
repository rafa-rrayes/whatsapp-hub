# MCP Module — Handoff Note

**Status at compaction:** Foundation complete. Tool implementations not yet started. About 60% of total work remaining.

---

## Goal

Add an MCP (Model Context Protocol) extension module to WhatsApp Hub so LLMs can navigate and find data efficiently. **HTTP transport** (Streamable HTTP), mounted at `POST /mcp`, sharing the existing `x-api-key` auth.

Design proposal (agreed with user) is 13 tools across 4 tiers — see "Tool spec" below.

---

## What's Already Done

### Foundation files written (DO NOT REWRITE — they're working contracts)

| Path | Purpose |
|------|---------|
| `src/mcp/types.ts` | `McpTool` interface; `textResult()`, `jsonResult()`, `errorResult()` helpers |
| `src/mcp/resolve.ts` | `resolveCandidates()`, `resolveOne()`, `isJid()` — fuzzy name/JID resolution |
| `src/mcp/render.ts` | `renderConversation(messages, opts)` — compact markdown via `buildNameResolver` |
| `src/mcp/server.ts` | `buildMcpServer()` returns configured `McpServer` |
| `src/mcp/transport.ts` | `createMcpRouter()` — stateless Streamable HTTP, per-request transport |
| `src/mcp/index.ts` | `registerMcp(app)` — mounts `/mcp` with `express.json({limit:'4mb'})` + `authMiddleware` |
| `src/mcp/tools/index.ts` | Registers all tool arrays — imports from `orientation.ts`, `search.ts`, `aggregation.ts`, `actions.ts` |

### Wiring done
- `src/api/server.ts` — added import for `registerMcp`, called after route mounting, added `/mcp` to `/api` docs summary
- `package.json` — `@modelcontextprotocol/sdk@1.29.0` installed (supports zod v3 + v4; project uses v4)

### Tasks
Tasks #1–4 marked completed (scaffolding, SDK install, transport, resolver).
Tasks #5–9 still pending: Tier 1/2/3/4 tools, smoke test.

---

## What's Left

### 1. Create 4 tool files — `src/mcp/tools/{orientation,search,aggregation,actions}.ts`

**These don't exist yet.** Currently `tools/index.ts` imports from them, so the build will fail until they're created.

**Recommended approach:** Dispatch 4 parallel `general-purpose` agents, one per file. Each agent gets the contract below + the tool list for its tier.

### 2. Build + smoke test
- `npm run build` — should compile clean
- Start server, hit `POST /mcp` with JSON-RPC `initialize` → `tools/list` → `tools/call`

---

## Tool Registration Contract (give this to every agent)

Every tool file exports a const array of `McpTool`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { jsonResult, textResult, errorResult } from '../types.js';

const myTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'tool_name',
      {
        title: 'Human title',
        description: 'What it does — visible to the LLM, write it well',
        inputSchema: {
          // ZodRawShape — NOT z.object(...). Just a record of zod schemas.
          query: z.string().describe('User-facing description'),
          limit: z.number().int().min(1).max(100).default(20).optional(),
        },
        annotations: {
          readOnlyHint: true,       // for read tools
          idempotentHint: true,     // for read/search tools
          openWorldHint: false,     // we're querying local DB
          // destructiveHint: false  // for writes that aren't destructive
        },
      },
      async ({ query, limit }) => {
        // ... returns ToolResult: { content: [{type:'text', text:'...'}], isError? }
        return jsonResult({ ok: true, results: [...] });
      },
    );
  },
};

export const orientationTools: McpTool[] = [myTool, /* ... */];
```

**Important:**
- `inputSchema` is a **ZodRawShape** (`{ foo: z.string() }`), NOT a wrapped `z.object({...})`.
- Add `.describe('...')` to every zod field — descriptions surface to the LLM.
- Read tools: `readOnlyHint: true, idempotentHint: true`.
- Action tools (send/react): no `readOnlyHint`. Set `openWorldHint: true` since they hit WhatsApp.
- Return small JSON by default; for renderered conversations, return markdown text via `textResult`.
- Use `errorResult(message)` for graceful failure (returns `isError: true`).

---

## Available Helpers (agents should use these, not reinvent)

### Resolver — `src/mcp/resolve.ts`
- `isJid(s)` → `boolean` (matches WhatsApp JID format)
- `resolveCandidates(query, { groupsOnly?, dmsOnly?, limit? })` → `ResolveCandidate[]` ranked
- `resolveOne(query, filter)` → `{ ok:true, jid, name, is_group } | { ok:false, reason:'not_found'|'ambiguous', message, candidates }`

### Renderer — `src/mcp/render.ts`
- `renderConversation(messages: MessageRow[], opts: { timezone?, include_id?, include_reactions?, include_quoted?, me_alias?, chat_label?, subtitle? })` → markdown string

### Repos — `src/database/repositories/*.ts`
- `messagesRepo.query({ remote_jid?, from_jid?, from_me?, message_type?, search?, before?, after?, has_media?, limit?, offset?, order? })` → `{ data: MessageRow[], total: number }`
- `messagesRepo.getById(id)` → `MessageRow | undefined`
- `messagesRepo.getStats()` → totals + breakdowns
- `chatsRepo.getAll({ search?, limit?, offset? })` → `ChatRow[]`
- `chatsRepo.getByJid(jid)` → `ChatRow | undefined`
- `contactsRepo.getAll(search?)`, `contactsRepo.getByJid(jid)`, `contactsRepo.getCount()`
- `groupsRepo.getAll(search?)`, `groupsRepo.getByJid(jid)`, `groupsRepo.getParticipants(jid)`, `groupsRepo.getCount()`
- `mediaRepo` exists — check `src/database/repositories/media.ts` for signatures

### For send/react actions — `src/connection/manager.ts`
- `connectionManager.sendTextMessage(jid, text, quoted_id?)`
- `connectionManager.sendImage(jid, buffer, caption?, mime_type?)`
- `connectionManager.sendReaction(jid, message_id, emoji)`
- See `src/api/routes/actions.ts` for full method names and how they're called.

### Export pipeline — `src/export/`
- `runExport(opts, req, res)` writes directly to Express response — can call it from `export_conversation` tool, OR call `selectChats` + `selectMessages` + `renderMarkdown` directly to get a string back.

---

## Tool Spec (13 tools total)

### Tier 1 — `src/mcp/tools/orientation.ts`

1. **`whatsapp_overview`** — no args (or optional `days: number = 7`).
   Returns: total chats, total messages, message_total_last_7d, unread chat count, top-N (5) active chats with names + JIDs + message counts in window, last activity timestamp. Use `messagesRepo.getStats()` + `chatsRepo.getAll`. Read-only, idempotent.

2. **`resolve_contact`** — `{ query: string, limit?: number, groups_only?: boolean, dms_only?: boolean }`.
   Returns: `resolveCandidates(query, filter)` JSON. Read-only, idempotent.

3. **`list_chats`** — `{ unread_only?, groups_only?, dms_only?, name_contains?, active_since_days?, limit?: number = 30 }`.
   Returns: small chat summaries: `{ name, jid, is_group, unread_count, last_message_ts, last_message_preview }`. Sort by `last_message_ts` desc. Cap `limit` at 200.

### Tier 2 — `src/mcp/tools/search.ts`

4. **`search_messages`** — `{ query: string, chat?: string (name or JID), from?: string, after?: ISO|unix, before?: ISO|unix, types?: string[], limit?: number = 20 }`.
   Resolve `chat` to JID via `resolveOne()` if provided (return error result on ambiguous/not_found). Use `messagesRepo.query({ search: query, ... })`. Return snippets, not full bodies: `{ message_id, chat_name, chat_jid, sender_name, timestamp, snippet (first 160 chars of body), has_media }`. Cap limit at 100.

5. **`recent_activity`** — `{ window?: 'today'|'yesterday'|'past_hour'|'past_24h'|'past_week', since?, until?, chats?: string[], exclude_chats?: string[], groups_only?, dms_only?, unread_only?, exclude_types?: string[] = ['reaction','poll_update'], min_messages?: number = 1, mode?: 'summary'|'firehose'|'rendered' = 'summary', timezone?: string, limit?: number = 50 }`.
   Compute time window (use `Intl.DateTimeFormat` for timezone-aware 'today'/'yesterday' boundaries). Pull messages via `messagesRepo.query({ after, before, limit: 5000 })`. Group by `remote_jid`.
   - `summary` mode: per-chat counts, top senders, first/last message gist (truncated 80 chars).
   - `firehose` mode: chronological `{ chat_name, time, sender, snippet }`, capped at `limit`.
   - `rendered` mode: for each chat, run `renderConversation` and concatenate with chat headings.

6. **`get_conversation`** — `{ chat: string (name or JID), around_message_id?: string, around_timestamp?: ISO|unix, last_n?: number, window_minutes?: number = 60, timezone?: string, include_id?: boolean = false }`.
   Resolve chat. If `last_n`: fetch last N messages. If `around_*`: fetch ±window_minutes around the anchor. Returns markdown via `renderConversation`. Cap messages at 500.

7. **`get_message`** — `{ message_id: string }`.
   `messagesRepo.getById(id)`. If quoted_id, also fetch the quoted message and include preview. Include sender name (resolved), chat name, full body, reactions (query for `reaction_target_id = id`), media metadata. Return JSON.

8. **`get_thread`** — `{ message_id: string, depth?: number = 5 }`.
   Walks backward via `quoted_id` up to `depth`, and forward by querying messages where `quoted_id = message_id` (recursively). Returns ordered list of messages (root → leaves). Render via `renderConversation` with `include_id: true`.

### Tier 3 — `src/mcp/tools/aggregation.ts`

9. **`chat_summary`** — `{ chat: string, days?: number = 7, timezone?: string }`.
   Resolve chat. Pull messages in window. Compute: total messages, participants (count + top 5 names), peak hour (UTC bucket), media count, top reactions, first/last message timestamps. JSON result.

10. **`list_media`** — `{ chat?: string, types?: ('image'|'video'|'audio'|'document'|'sticker')[], after?, before?, limit?: number = 30 }`.
    Resolve chat if given. Query messages with `has_media=true`. Return: `{ message_id, media_id, chat_name, sender_name, timestamp, kind, mime_type, filename, size_bytes, caption (= body) }`. Cap at 100.

11. **`export_conversation`** — Thin wrapper over `src/export/runner.ts` machinery. Args: subset of `ExportRequest`: `{ chat?: string, chats?: string[], days?, from?, to?, preset?: 'concise'|'full'|'llm'|'archive' = 'llm', max_messages?: number = 5000, format?: 'md'|'txt'|'json' = 'md' (skip zip), timezone? }`.
    Resolve chats if names given. Call `selectChats` + `selectMessages` directly (don't go through HTTP), then `renderMarkdown` / `renderText` / `renderJson`. Return text content. Hard cap max_messages at 10000 to keep MCP responses sane.

### Tier 4 — `src/mcp/tools/actions.ts`

12. **`send_message`** — `{ jid: string (REQUIRED, no fuzzy resolution), text?, media_url?, caption?, location?: { lat, lng, name?, address? }, quoted_message_id?, kind?: 'text'|'image'|'video'|'audio'|'document'|'location' (auto-detected from fields if omitted) }`.
    Validate JID format (use the regex from `src/api/schemas.ts` — or import the constant). Reject if no text/media_url/location. For media: fetch URL with size limit (see `src/api/routes/actions.ts:resolveBuffer` for the existing pattern, or — simpler — just pass URL to the WhatsApp send method if Baileys accepts it; otherwise download into buffer). Returns `{ ok, message_key }`.
    Annotations: `readOnlyHint: false, openWorldHint: true, destructiveHint: false`.

13. **`react_to_message`** — `{ jid: string, message_id: string, emoji: string }`.
    Calls `connectionManager.sendReaction`. Returns `{ ok }`.

---

## Gotchas / Notes

- **ESM imports**: every relative import ends in `.js` even though source is `.ts` (project convention).
- **No file mocking required**: SQLite repos all use the live DB via `getDb()`.
- **`buildNameResolver` cost**: loads all contacts/groups/chats into memory each call. For hot tools, that's fine for now — the data is small. Don't cache yet.
- **Timezone fallback**: if user-supplied tz is invalid, fall back to `'UTC'`. There's an `isValidTz` helper inside `render.ts` (not exported; agents can copy or just rely on Intl throwing).
- **Auth middleware path check**: `authMiddleware` checks `req.path === '/health'`. When mounted at `/mcp`, the path inside the router is `/`, so the check is fine — auth runs normally.
- **CORS already covers** `x-api-key`, `Authorization`, `Content-Type`. The browser-side dashboard won't call /mcp, but external HTTP clients will.
- **DO NOT add rate limit to /mcp specifically** beyond the global 200/min — the user hasn't asked, and it's not clear how heavy real LLM calls will be.
- **Zod version warning**: project uses `zod ^4.3.6`. The SDK accepts v3 or v4. If anything weird happens with schema parsing at runtime, check that.

---

## Smoke test (after tool agents finish)

```bash
npm run build  # must succeed
npm start &    # or whatever the dev workflow is
SERVER_PID=$!
sleep 2

# initialize
curl -s -X POST http://localhost:3100/mcp \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'

# list tools
curl -s -X POST http://localhost:3100/mcp \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call overview
curl -s -X POST http://localhost:3100/mcp \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"whatsapp_overview","arguments":{}}}'

kill $SERVER_PID
```

The MCP protocol requires `Accept: application/json, text/event-stream` on POSTs — clients must accept both. Don't forget that header.

---

## Dispatch pattern for next session

Send 4 agents in parallel (single message, 4 Agent tool calls):

- **Agent A** → write `src/mcp/tools/orientation.ts` (3 tools, Tier 1). Give it the contract section + Tier 1 specs.
- **Agent B** → write `src/mcp/tools/search.ts` (5 tools, Tier 2). Largest. Note `recent_activity` and `get_conversation` are the workhorses — extra care.
- **Agent C** → write `src/mcp/tools/aggregation.ts` (3 tools, Tier 3).
- **Agent D** → write `src/mcp/tools/actions.ts` (2 tools, Tier 4). Needs to read `src/api/routes/actions.ts` and `src/connection/manager.ts` for the send helpers.

Each agent should:
1. Read this handoff note for context.
2. Read `src/mcp/types.ts`, `src/mcp/resolve.ts`, `src/mcp/render.ts` for the helpers.
3. Read one example repo (e.g., `src/database/repositories/messages.ts`) for the data shape.
4. Write the file. Don't run `npm run build` themselves — the main session handles it after.

Then main session: run `npm run build`, fix any cross-file type issues, smoke test.

---

## Files at risk to delete by mistake
None — every foundation file is load-bearing. The `tasks/mcp-handoff.md` (this file) can be deleted after the build passes.
