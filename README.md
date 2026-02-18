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
- **Contacts & groups** — names, profile pics, participants, roles, invite codes
- **Presence tracking** — online/offline/typing/recording status log
- **Call log** — incoming/outgoing, video/voice, duration
- **Status/Stories** — captured and stored
- **Message receipts** — sent/delivered/read/played timestamps per recipient
- **Webhook system** — HMAC-signed payloads, event filtering, toggle on/off
- **WebSocket streaming** — real-time events with optional event type filtering
- **Full-text search** — search across all messages
- **Web dashboard** — 10-page interactive UI for browsing everything
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

Interactive API docs are available in the dashboard at `GET /api`.

### Authentication

All requests require an API key via one of:

- Header: `x-api-key: YOUR_KEY`
- Header: `Authorization: Bearer YOUR_KEY`
- Query param: `?api_key=YOUR_KEY`

### Endpoints

<details>
<summary><strong>Connection</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/connection/status` | Connection status & JID |
| GET | `/api/connection/qr` | QR code as base64 data URL |
| GET | `/api/connection/qr/image` | QR code as PNG |
| POST | `/api/connection/restart` | Restart connection |
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

Connect to `ws://your-server:3100/ws?api_key=YOUR_KEY` for real-time events.

Optional filter: `ws://...?api_key=KEY&events=wa.messages,wa.presence`

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

const ws = new WebSocket("ws://localhost:3100/ws?api_key=YOUR_KEY&events=wa.messages");

ws.on("message", (data) => {
  const event = JSON.parse(data);
  console.log("New message:", event.type, event.data);
});
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | API server port |
| `API_KEY` | *(required)* | Authentication key (min 16 characters) |
| `DATA_DIR` | `./data` | Data directory path |
| `MEDIA_DIR` | `./data/media` | Media storage path |
| `AUTO_DOWNLOAD_MEDIA` | `true` | Auto-download media files |
| `MAX_MEDIA_SIZE_MB` | `100` | Max file size to download (0 = unlimited) |
| `LOG_LEVEL` | `info` | Pino log level |
| `SESSION_NAME` | `default` | Baileys auth session name |
| `WEBHOOK_URLS` | — | Comma-separated webhook URLs |
| `WEBHOOK_SECRET` | — | HMAC secret for webhook signatures |

## Data Storage

```
data/
├── whatsapp-hub.db        # SQLite database (WAL mode)
├── auth/default/          # Baileys session credentials
└── media/
    └── 2025/01/15/        # Date-organized media files
```

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

**Backend:** Node.js, TypeScript, Express, Baileys, better-sqlite3, Pino

**Frontend:** React, TypeScript, Vite, Tailwind CSS, Radix UI, Zustand, TanStack Query, Recharts

## License

[MIT](LICENSE)
