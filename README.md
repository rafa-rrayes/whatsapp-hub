# WhatsApp Hub

**Your personal WhatsApp backbone.** A single self-hosted service that maintains a persistent WhatsApp connection and exposes everything through a clean REST API, real-time WebSocket stream, and webhook system.

Every message, media file, contact, group, call, presence change, and status update is captured and stored in a local SQLite database. Connect all your projects — AI agents, auto-reply bots, dashboards, analytics — to one hub.

```
WhatsApp  <-->  Baileys Connection  <-->  Event Bus  <-->  SQLite DB
                                            |
                                    REST API + WebSocket
                                            |
                                     Webhook Dispatcher
                                            |
                                   Your projects subscribe
```

## Features

- **Full message capture** — text, images, video, audio, documents, stickers, locations, contacts, reactions, polls, view-once, forwards, quotes, edits, deletes
- **Media auto-download** — organized by date in `data/media/`
- **AI media transcription** — optional Google Gemini integration that transcribes voice notes and describes images; transcripts appear inline when you pull messages (REST/MCP) and are full-text searchable
- **Contacts & groups** — names, profile pics, participants, roles, invite codes
- **Presence tracking** — online/offline/typing/recording status log
- **Call log** — incoming/outgoing, video/voice, duration
- **Status/Stories** — captured and stored
- **Message receipts** — sent/delivered/read/played timestamps per recipient
- **Webhook system** — HMAC-signed payloads, event filtering, toggle on/off, SSRF protection
- **WebSocket streaming** — real-time events with optional event type filtering, ticket-based auth
- **Full-text search** — search across all messages
- **Web dashboard** — 10-page interactive UI for browsing everything
- **Security hardening** — database encryption at rest, webhook secret encryption, configurable security toggles
- **Docker-ready** — single `docker compose up` to deploy

## Quick Start

### 1. Clone & configure

```bash
git clone https://github.com/rafa-rrayes/whatsapp-hub.git
cd whatsapp-hub
cp .env.example .env
```

Edit `.env` and set a strong API key:

```bash
# Generate a random key
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 2. Run with Docker Compose

```bash
docker compose up -d
```

### 3. Authenticate

Open `http://localhost:3100` in your browser, enter your API key, and scan the QR code with WhatsApp.

Or check the container logs:

```bash
docker compose logs -f
```

### 4. Start using the API

```bash
# Check connection status
curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/connection/status

# Search messages
curl -H "x-api-key: YOUR_KEY" "http://localhost:3100/api/messages/search?q=hello"

# Send a message
curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"jid": "5511999999999@s.whatsapp.net", "text": "Hello from WhatsApp Hub!"}' \
  http://localhost:3100/api/actions/send/text
```

## API Reference

Interactive API docs are available in the dashboard at `GET /api`. The full spec is also exposed as JSON at `GET /api/openapi.json` and as Markdown at `GET /api/openapi.md` (append `?download=1` to download as a file).

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server is also exposed at `POST /mcp` so AI clients like Claude can read and act on your WhatsApp data as tools — see the **MCP Server** section below.

### Authentication

All requests require an API key via one of:

- Header: `x-api-key: YOUR_KEY` (recommended)
- Header: `Authorization: Bearer YOUR_KEY`
- Query param: `?api_key=YOUR_KEY` (disabled when `SECURITY_DISABLE_HTTP_QUERY_AUTH=true`)

### Endpoints

<details>
<summary><strong>Connection</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/connection/status` | Connection status & JID |
| GET | `/api/connection/qr` | QR code as base64 data URL |
| GET | `/api/connection/qr/image` | QR code as PNG |
| POST | `/api/connection/restart` | Restart connection |
| POST | `/api/connection/new-qr` | Clear session, generate new QR |
| POST | `/api/connection/logout` | Logout |

</details>

<details>
<summary><strong>Messages</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages` | Query messages with filters |
| GET | `/api/messages/search?q=` | Full-text search |
| GET | `/api/messages/stats` | Statistics & breakdown |
| GET | `/api/messages/:id` | Single message by ID |

**Query parameters for `/api/messages`:**

| Param | Description |
|-------|-------------|
| `chat` | Filter by chat JID |
| `from` | Filter by sender JID |
| `from_me` | `true` / `false` |
| `type` | Message type (text, image, video, audio, document, sticker, etc.) |
| `search` | Text search in message body |
| `before` / `after` | Unix timestamp range |
| `has_media` | `true` / `false` |
| `limit` / `offset` | Pagination (default: 50) |
| `order` | `asc` or `desc` (default: desc) |

</details>

<details>
<summary><strong>Chats</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chats` | List all chats (sorted by last message) |
| GET | `/api/chats/:jid` | Chat details + recent messages |

</details>

<details>
<summary><strong>Contacts</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/contacts` | List all contacts |
| GET | `/api/contacts/:jid` | Single contact |
| GET | `/api/contacts/:jid/profile-pic` | Profile picture URL |

</details>

<details>
<summary><strong>Groups</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/groups` | List all groups |
| GET | `/api/groups/:jid` | Group + participants |
| GET | `/api/groups/:jid/metadata` | Fresh metadata from WhatsApp |
| GET | `/api/groups/:jid/invite-code` | Invite code |
| PUT | `/api/groups/:jid/subject` | Update subject |
| PUT | `/api/groups/:jid/description` | Update description |
| POST | `/api/groups/:jid/participants` | Manage members |
| POST | `/api/groups/sync` | Sync all groups from WhatsApp |

</details>

<details>
<summary><strong>Actions (Send)</strong></summary>

| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/actions/send/text` | `{ jid, text, quoted_id? }` |
| POST | `/api/actions/send/image` | `{ jid, base64\|url, caption?, mime_type? }` |
| POST | `/api/actions/send/video` | `{ jid, base64\|url, caption? }` |
| POST | `/api/actions/send/audio` | `{ jid, base64\|url, ptt? }` |
| POST | `/api/actions/send/document` | `{ jid, base64\|url, filename, mime_type, caption? }` |
| POST | `/api/actions/send/sticker` | `{ jid, base64\|url }` |
| POST | `/api/actions/send/location` | `{ jid, latitude, longitude, name?, address? }` |
| POST | `/api/actions/send/contact` | `{ jid, contact_jid, name }` |
| POST | `/api/actions/react` | `{ jid, message_id, emoji }` |
| POST | `/api/actions/read` | `{ jid, message_ids[] }` |
| POST | `/api/actions/presence` | `{ type, jid? }` |
| PUT | `/api/actions/profile-status` | `{ status }` |

</details>

<details>
<summary><strong>Media</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/media/stats` | Media statistics |
| GET | `/api/media/:id` | Media metadata |
| GET | `/api/media/:id/download` | Download file |
| GET | `/api/media/by-message/:msgId` | Get media by message ID |

</details>

<details>
<summary><strong>Webhooks</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/webhooks` | List subscriptions |
| POST | `/api/webhooks` | Create `{ url, secret?, events? }` |
| DELETE | `/api/webhooks/:id` | Delete |
| PUT | `/api/webhooks/:id/toggle` | Toggle active |

Webhook payloads include `X-Hub-Event` and `X-Hub-Signature` (HMAC-SHA256) headers.

</details>

<details>
<summary><strong>WebSocket</strong></summary>

Connect to `ws://your-server:3100/ws` for real-time events. Max 20 concurrent connections with automatic ping/pong cleanup.

**Authentication** (one of):

| Method | Usage |
|--------|-------|
| Ticket (recommended) | `POST /api/ws/ticket` → connect with `?ticket=TOKEN` |
| Header | `x-api-key: YOUR_KEY` (non-browser clients) |
| Query param (legacy) | `?api_key=YOUR_KEY` |

Ticket auth requires `SECURITY_WS_TICKET_AUTH=true`. Tickets are one-time use and expire after 30 seconds.

Optional event filter: `?ticket=TOKEN&events=wa.messages.upsert,wa.presence.update`

</details>

<details>
<summary><strong>Settings</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | List runtime settings with defaults |
| PUT | `/api/settings` | Update settings `{ logLevel?, autoDownloadMedia?, maxMediaSizeMB? }` |

</details>

<details>
<summary><strong>Stats & Events</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Full dashboard overview |
| GET | `/api/stats/events` | Query event audit log |
| GET | `/api/stats/events/types` | Event type counts |
| DELETE | `/api/stats/events/prune?days=30` | Prune old events |

</details>

<details>
<summary><strong>Export</strong></summary>

A single richly-parameterised endpoint that produces a curated **Markdown** export of conversations (also `txt`, `json`, or a `zip` bundling media). Useful for archives, LLM context, and human-friendly dumps. Rate-limited to 5/min/key.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/export` | Full-featured export with rich filters (time window, chat selection, media handling, privacy) |
| GET | `/api/export?days=N&format=md` | Convenience GET for trivial exports — POST is preferred for full options |

**Body fields (all optional unless noted; one of `days` / `from` / `to` is required):**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | int 1–365 | — | Last N days ending now |
| `from` / `to` | unix int or ISO datetime | — | Absolute window |
| `chats` | string[] of JIDs | — | Only include these chats |
| `exclude_chats` | string[] of JIDs | — | Skip these chats |
| `groups_only` / `dms_only` | bool | false | Mutually exclusive |
| `include_archived` | bool | `false` | |
| `include_muted` | bool | `true` | |
| `unread_only` | bool | `false` | |
| `min_messages` | int | `0` | Drop chats with fewer than N messages in window |
| `chat_search` | string | — | Substring match on chat name |
| `sort_chats_by` | `recent` / `volume` / `name` | `recent` | |
| `types` / `exclude_types` | string[] | exclude `['reaction','poll_update']` | Message-type filters |
| `has_media` / `from_me` | bool | — | |
| `include_deleted` / `include_system` | bool | `false` | |
| `min_body_length` | int | `0` | Drop messages shorter than N characters |
| `search` | string | — | Substring search on body |
| `format` | `md` / `txt` / `json` / `zip` | `md` | `zip` requires `media: 'attach'` |
| `preset` | `concise` / `full` / `llm` / `archive` | `full` | Selects which fields to render |
| `fields` | string[] | — | Override preset; valid: `timestamp, sender, body, media, reply, reactions, id, edits, forwarded, starred` |
| `timezone` | IANA TZ string | `UTC` | E.g. `America/Sao_Paulo` |
| `date_grouping` | `none` / `day` / `hour` | `day` | Subheadings within each chat |
| `reactions` | `inline` / `separate` / `omit` | `inline` | |
| `me_alias` | string | `Me` | Label for messages you sent |
| `prefer_saved_names` | bool | `true` | Use saved contact name over WhatsApp push name |
| `media` | `none` / `ref` / `embed` / `attach` | `none` | `attach` requires `format=zip` |
| `media_types` | string[] | — | Filter to a subset of `image,video,audio,sticker,document` |
| `max_media_size_mb` | int | `50` | Skip files larger than this (per-file) |
| `redact_phone_numbers` | bool | `false` | Replace digits with `•` in message bodies |
| `anonymize_jids` | bool | `false` | Hash sender JIDs (privacy) |
| `strip_quoted_bodies` | bool | `false` | Drop quoted-message bodies (keep marker) |
| `max_messages` | int ≤ 200 000 | `100 000` | Hard cap on total messages |
| `max_chats` | int ≤ 500 | `500` | Hard cap on number of chats |

**Response:** the requested format with `Content-Disposition: attachment; filename="whatsapp-export-YYYYMMDD-HHMM.<ext>"`.

**Examples:**

```bash
# Last 15 days as Markdown, in São Paulo time
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"days": 15, "format": "md", "preset": "full", "timezone": "America/Sao_Paulo"}' \
  http://localhost:3100/api/export -o export.md

# Pick specific chats with media bundled in a zip
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"days": 30, "chats": ["111@s.whatsapp.net"], "format": "zip", "media": "attach"}' \
  http://localhost:3100/api/export -o export.zip

# Privacy-friendly LLM-ready export
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"days": 7, "preset": "llm", "anonymize_jids": true, "redact_phone_numbers": true}' \
  http://localhost:3100/api/export -o export.md
```

</details>

<details>
<summary><strong>MCP Server</strong></summary>

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server is exposed at `POST /mcp` so AI clients (Claude, etc.) can read and act on your WhatsApp data as tools. It speaks JSON-RPC 2.0 over stateless Streamable HTTP — every call is a self-contained POST; `GET`/`DELETE` return 405.

**Authentication** (one of):

| Method | Usage |
|--------|-------|
| API key | `x-api-key: YOUR_KEY` (same key as the REST API — for CLI/local clients) |
| OAuth 2.1 | `Authorization: Bearer <token>` (claude.ai-style connectors; discovery at `/.well-known/oauth-protected-resource/mcp`) |

```bash
# List available tools
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://localhost:3100/mcp

# Call a tool
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_messages","arguments":{"query":"invoice","limit":5}}}' \
  http://localhost:3100/mcp
```

**Tools:**

| Tool | Type | Description |
|------|------|-------------|
| `whatsapp_overview` | read | Dashboard totals + recent activity. Call first to orient. |
| `resolve_contact` | read | Fuzzy-map a name / phone / JID to a ranked list of chats. |
| `list_chats` | read | Browse chats with filters (unread, group/DM, name, recency). |
| `search_messages` | read | Full-text search returning snippets. |
| `recent_activity` | read | Activity over a time window (summary / firehose / rendered). |
| `get_conversation` | read | Render a chat as markdown (last N, or window around an anchor). |
| `get_message` | read | One message by ID with full context (media, reactions, quote). |
| `get_thread` | read | Walk the quote chain backward from a message. |
| `chat_summary` | read | Activity report for one chat (top senders, peak hour, types). |
| `list_media` | read | Browse media attachment metadata. |
| `export_conversation` | read | Render chats to md/txt/json via the export pipeline. |
| `send_message` | **write** | Send text/media/location to a JID. Resolve names first. |
| `react_to_message` | **write** | Add/replace/remove a reaction emoji (empty string removes). |

Write tools advertise `readOnlyHint: false` — MCP clients should confirm with the user before invoking. Targeting always requires an explicit JID; use `resolve_contact` first.

</details>

## What Gets Stored

| Category | Details |
|----------|---------|
| Messages | Text, images, video, audio, documents, stickers, locations, contacts, reactions, polls, view-once, forwarded, quoted, edits, deletes |
| Media | Auto-downloaded to `data/media/` in date-organized folders |
| Contacts | Names, phone numbers, profile pics, business status |
| Groups | Metadata, descriptions, participants, roles, invite codes |
| Chats | Archive/pin/mute status, unread counts, last message preview |
| Receipts | Sent, delivered, read, played timestamps per recipient |
| Presence | Online/offline/typing/recording status log |
| Calls | Incoming/outgoing, video/voice, status, duration |
| Stories | Status updates captured and stored |
| Labels | WhatsApp Business labels |
| Events | Full audit trail with timestamps |

## Media Transcription

Optionally transcribe incoming **voice notes / audio** and describe **images**
using Google Gemini. Once enabled, the resulting text is stored on the message and
shows up everywhere you read messages — REST API responses (`media_transcription`),
the MCP tools (inline in rendered conversations and in search snippets), and it's
indexed for **full-text search**, so you can search the content of your voice notes.

**Setup:**

1. Get a key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. In the dashboard go to **Settings → Media Transcription**, paste the key, and
   toggle **Transcribe Media** on. (Or set `GEMINI_API_KEY` / `TRANSCRIBE_MEDIA=true`
   in your environment.)
3. New incoming audio and photos are transcribed automatically after download.

Notes:

- Default model is `gemini-3.1-flash-lite` (configurable via `GEMINI_MODEL` or the UI).
- Stickers, video, and documents are skipped; only audio and non-sticker images are processed.
- Only **new** media is processed — existing history is left as-is.
- The API key is encrypted at rest when `ENCRYPTION_KEY` is set, and is never returned by the API.

## Example Integrations

### Python AI agent

```python
import requests

API = "http://localhost:3100/api"
HEADERS = {"x-api-key": "YOUR_KEY"}

# Get unread chats
chats = requests.get(f"{API}/chats", headers=HEADERS).json()
unread = [c for c in chats["data"] if c["unread_count"] > 0]

# Search messages
tasks = requests.get(f"{API}/messages/search", params={"q": "TODO"}, headers=HEADERS).json()

# Reply
requests.post(f"{API}/actions/send/text", headers=HEADERS, json={
    "jid": "5511999999999@s.whatsapp.net",
    "text": "Got it! I'll handle that."
})
```

### Node.js WebSocket listener

```javascript
import WebSocket from "ws";

// With ticket auth (recommended — requires SECURITY_WS_TICKET_AUTH=true)
const res = await fetch("http://localhost:3100/api/ws/ticket", {
  method: "POST",
  headers: { "x-api-key": "YOUR_KEY" },
});
const { ticket } = await res.json();
const ws = new WebSocket(`ws://localhost:3100/ws?ticket=${ticket}&events=wa.messages.upsert`);

// Or with header auth (non-browser)
// const ws = new WebSocket("ws://localhost:3100/ws", { headers: { "x-api-key": "YOUR_KEY" } });

ws.on("message", (data) => {
  const event = JSON.parse(data);
  console.log("New message:", event.type, event.data);
});
```

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | API server port |
| `API_KEY` | *(required)* | Authentication key (min 16 characters) |
| `DATA_DIR` | `./data` | Data directory path |
| `MEDIA_DIR` | `./data/media` | Media storage path |
| `AUTO_DOWNLOAD_MEDIA` | `true` | Auto-download media files |
| `MAX_MEDIA_SIZE_MB` | `100` | Max file size to download (0 = unlimited) |
| `TRANSCRIBE_MEDIA` | `false` | Transcribe audio / describe images via Gemini (also toggleable in Settings) |
| `GEMINI_API_KEY` | — | Google Gemini API key (encrypted at rest when `ENCRYPTION_KEY` is set) |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Gemini model used for transcription |
| `LOG_LEVEL` | `info` | Pino log level |
| `SESSION_NAME` | `default` | Baileys auth session name |
| `BEHIND_PROXY` | `false` | Set `true` behind a TLS reverse proxy (enables HSTS, CSP upgrade-insecure-requests, trust proxy) |
| `CORS_ORIGINS` | *(auto)* | Allowed CORS origins (comma-separated, or `*`). Default: localhost + LAN IPs on configured port |
| `WEBHOOK_URLS` | — | Comma-separated webhook URLs |
| `WEBHOOK_SECRET` | — | HMAC secret for webhook signatures |

### Security

> **Migration notice:** Starting with this version, `SECURITY_WS_TICKET_AUTH` and `SECURITY_DISABLE_HTTP_QUERY_AUTH` now **default to ON** (previously OFF). If you rely on query-string API key auth or raw WebSocket connections with `?api_key=`, explicitly set `SECURITY_WS_TICKET_AUTH=false` and/or `SECURITY_DISABLE_HTTP_QUERY_AUTH=false` in your `.env` file or Docker Compose environment.

| Variable | Default | Description |
|----------|---------|-------------|
| `SECURITY_WS_TICKET_AUTH` | `true` | Use one-time tickets for WebSocket auth instead of api_key in URL |
| `SECURITY_DISABLE_HTTP_QUERY_AUTH` | `true` | Disable `?api_key=` query parameter on HTTP endpoints |
| `SECURITY_ENCRYPT_DATABASE` | `false` | Encrypt SQLite database at rest (requires `ENCRYPTION_KEY`) |
| `SECURITY_ENCRYPT_WEBHOOK_SECRETS` | `false` | Encrypt webhook HMAC secrets at rest (requires `ENCRYPTION_KEY`) |
| `SECURITY_STRIP_RAW_MESSAGES` | `false` | Omit `raw_message` field from API responses |
| `ENCRYPTION_KEY` | — | Master encryption key (min 16 chars). Required by database and webhook secret encryption |
| `SECURITY_AUTO_PRUNE` | `false` | Auto-prune old presence and event log entries every 6 hours |
| `PRESENCE_RETENTION_DAYS` | `7` | Days to keep presence log entries (when auto-prune enabled) |
| `EVENT_RETENTION_DAYS` | `30` | Days to keep event log entries (when auto-prune enabled) |
| `SECURITY_HASH_EVENT_JIDS` | `false` | Hash phone numbers in event log for privacy (one-way) |
| `SECURITY_SEC_FETCH_CHECK` | `false` | Block cross-site browser requests via Sec-Fetch-Site header |

**Always-on hardening** (no configuration needed): Bearer token parsing fix, WebSocket ping/pong heartbeat, input validation on group operations and order parameters, media URL fetch size limits + timeout, SSRF re-validation at webhook delivery, per-API-key rate limiting.

## Reverse Proxy / HTTPS

WhatsApp Hub serves plain HTTP by default. If you place it behind a TLS-terminating reverse proxy (Caddy, nginx, Cloudflare Tunnel, etc.), set:

```bash
BEHIND_PROXY=true
```

This enables:
- **HSTS** — tells browsers to always use HTTPS for this host
- **`upgrade-insecure-requests`** in Content-Security-Policy — tells browsers to load sub-resources over HTTPS
- **`trust proxy`** in Express — reads the real client IP from `X-Forwarded-For`

Leave it at `false` (the default) when accessing the app directly over HTTP, otherwise all asset loads will fail and you'll see a blank page.

## Data Storage

```
data/
├── whatsapp-hub.db        # SQLite database (WAL mode, optionally encrypted)
├── auth/default/          # Baileys session credentials
└── media/
    └── 2025/01/15/        # Date-organized media files
```

When `SECURITY_ENCRYPT_DATABASE=true`, the database is encrypted at rest (AES-256). Existing unencrypted databases are automatically migrated on first start (a backup is created beforehand). No special build steps or system libraries are needed — encryption support is bundled.

## Development

```bash
npm install
cd frontend && npm install && cd ..
cp .env.example .env
# Set your API_KEY in .env
npm run dev
```

The frontend dev server runs separately:

```bash
cd frontend
npm run dev
```

## Tech Stack

**Backend:** Node.js, TypeScript, Express, Baileys, better-sqlite3 (with encryption), Pino

**Frontend:** React, TypeScript, Vite, Tailwind CSS, Radix UI, Zustand, TanStack Query, Recharts

## License

[MIT](LICENSE)
