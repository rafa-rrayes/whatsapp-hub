import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Search,
  Lock,
  Globe,
  Webhook,
  Radio,
  Heart,
  Shield,
  BookOpen,
  Download,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  type EndpointGroup,
  MethodBadge,
  CodeBlock,
  EndpointCard,
} from "@/components/api-docs/endpoint"

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const API_SECTIONS: EndpointGroup[] = [
  {
    id: "connection",
    title: "Connection",
    description: "Manage the WhatsApp connection lifecycle, QR codes, and session state.",
    prefix: "/api/connection",
    endpoints: [
      {
        method: "GET",
        path: "/api/connection/status",
        description: "Get the current connection status, linked JID, and QR availability.",
        response: `{
  "status": "connected",
  "jid": "5511999999999@s.whatsapp.net",
  "qr_available": false
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/connection/status`,
      },
      {
        method: "GET",
        path: "/api/connection/qr",
        description: "Get the current QR code as a base64-encoded data URL for embedding in HTML.",
        response: `{
  "qr": "data:image/png;base64,iVBORw0KGgo..."
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/connection/qr`,
      },
      {
        method: "GET",
        path: "/api/connection/qr/image",
        description: "Get the QR code as a raw PNG image (400x400). Suitable for direct rendering.",
        notes: "Returns image/png content type directly.",
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/connection/qr/image -o qr.png`,
      },
      {
        method: "POST",
        path: "/api/connection/restart",
        description: "Reconnect to WhatsApp using the existing session credentials.",
        response: `{ "message": "Reconnecting..." }`,
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" http://localhost:3100/api/connection/restart`,
      },
      {
        method: "POST",
        path: "/api/connection/new-qr",
        description: "Clear the current auth session and generate a fresh QR code for linking a new device.",
        response: `{ "message": "New QR code requested" }`,
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" http://localhost:3100/api/connection/new-qr`,
      },
      {
        method: "POST",
        path: "/api/connection/logout",
        description: "Disconnect from WhatsApp and end the current session.",
        response: `{ "message": "Logged out" }`,
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" http://localhost:3100/api/connection/logout`,
      },
    ],
  },
  {
    id: "messages",
    title: "Messages",
    description: "Query, search, and retrieve stored messages with powerful filtering.",
    prefix: "/api/messages",
    endpoints: [
      {
        method: "GET",
        path: "/api/messages",
        description: "Query messages with filters. Supports pagination and sorting.",
        params: [
          { name: "chat", type: "string", description: "Filter by chat JID" },
          { name: "from", type: "string", description: "Filter by sender JID" },
          { name: "from_me", type: "boolean", description: "Filter sent/received messages" },
          { name: "type", type: "string", description: "Message type (text, image, video, etc.)" },
          { name: "search", type: "string", description: "Search message body text" },
          { name: "before", type: "number", description: "Unix timestamp upper bound" },
          { name: "after", type: "number", description: "Unix timestamp lower bound" },
          { name: "has_media", type: "boolean", description: "Filter messages with media" },
          { name: "limit", type: "number", description: "Results per page", default: "50" },
          { name: "offset", type: "number", description: "Pagination offset", default: "0" },
          { name: "order", type: "string", description: "Sort order: asc or desc", default: "desc" },
        ],
        response: `{
  "data": [
    {
      "id": "3EB0A1B2C3D4E5F6",
      "remote_jid": "5511999999999@s.whatsapp.net",
      "from_me": false,
      "message_type": "text",
      "body": "Hello!",
      "timestamp": 1708300800,
      "push_name": "John"
    }
  ],
  "total": 1542,
  "meta": { "limit": 50, "offset": 0 }
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  "http://localhost:3100/api/messages?chat=5511999999999@s.whatsapp.net&limit=10"`,
      },
      {
        method: "GET",
        path: "/api/messages/search",
        description: "Full-text search across all message bodies.",
        params: [
          { name: "q", type: "string", required: true, description: "Search query" },
          { name: "chat", type: "string", description: "Limit search to a specific chat" },
          { name: "limit", type: "number", description: "Max results", default: "50" },
          { name: "offset", type: "number", description: "Pagination offset", default: "0" },
        ],
        response: `{
  "data": [ ... ],
  "total": 23,
  "meta": { "q": "meeting", "limit": 50, "offset": 0 }
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  "http://localhost:3100/api/messages/search?q=meeting&limit=10"`,
      },
      {
        method: "GET",
        path: "/api/messages/stats",
        description: "Get aggregate message statistics (counts by type, by day, etc.).",
        response: `{
  "total": 15420,
  "by_type": { "text": 12000, "image": 2100, "video": 800, ... },
  "by_day": [ { "date": "2025-01-15", "count": 342 }, ... ]
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/messages/stats`,
      },
      {
        method: "GET",
        path: "/api/messages/:id",
        description: "Retrieve a single message by its unique ID.",
        params: [
          { name: "id", type: "string", required: true, description: "Message ID (path parameter)" },
        ],
        response: `{
  "data": {
    "id": "3EB0A1B2C3D4E5F6",
    "remote_jid": "5511999999999@s.whatsapp.net",
    "from_me": false,
    "message_type": "text",
    "body": "Hello!",
    "timestamp": 1708300800,
    "raw_message": { ... }
  }
}`,
        notes: "The raw_message field is omitted when SECURITY_STRIP_RAW_MESSAGES=true is set on the server.",
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/messages/3EB0A1B2C3D4E5F6`,
      },
    ],
  },
  {
    id: "chats",
    title: "Chats",
    description: "List and inspect chat conversations.",
    prefix: "/api/chats",
    endpoints: [
      {
        method: "GET",
        path: "/api/chats",
        description: "List all chats sorted by last message timestamp.",
        params: [
          { name: "search", type: "string", description: "Filter by chat name" },
          { name: "limit", type: "number", description: "Results per page", default: "50" },
          { name: "offset", type: "number", description: "Pagination offset", default: "0" },
        ],
        response: `{
  "data": [
    {
      "jid": "5511999999999@s.whatsapp.net",
      "name": "John Doe",
      "is_group": false,
      "unread_count": 3,
      "last_message_ts": 1708300800,
      "last_message_body": "See you tomorrow!"
    }
  ],
  "total": 86
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" "http://localhost:3100/api/chats?limit=20"`,
      },
      {
        method: "GET",
        path: "/api/chats/:jid",
        description: "Get chat details along with the 20 most recent messages.",
        params: [
          { name: "jid", type: "string", required: true, description: "Chat JID (path parameter)" },
        ],
        response: `{
  "data": {
    "jid": "5511999999999@s.whatsapp.net",
    "name": "John Doe",
    "is_group": false,
    "messages": [ ... ]
  }
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  http://localhost:3100/api/chats/5511999999999@s.whatsapp.net`,
      },
    ],
  },
  {
    id: "contacts",
    title: "Contacts",
    description: "Access your WhatsApp contact list and profile pictures.",
    prefix: "/api/contacts",
    endpoints: [
      {
        method: "GET",
        path: "/api/contacts",
        description: "List all stored contacts.",
        params: [
          { name: "search", type: "string", description: "Filter by name or phone number" },
        ],
        response: `{
  "data": [
    {
      "jid": "5511999999999@s.whatsapp.net",
      "name": "John Doe",
      "notify_name": "John",
      "phone_number": "5511999999999",
      "is_business": false
    }
  ]
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" "http://localhost:3100/api/contacts?search=john"`,
      },
      {
        method: "GET",
        path: "/api/contacts/:jid",
        description: "Get a single contact's details.",
        params: [
          { name: "jid", type: "string", required: true, description: "Contact JID (path parameter)" },
        ],
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  http://localhost:3100/api/contacts/5511999999999@s.whatsapp.net`,
      },
      {
        method: "GET",
        path: "/api/contacts/:jid/profile-pic",
        description: "Get a contact's profile picture URL.",
        params: [
          { name: "jid", type: "string", required: true, description: "Contact JID (path parameter)" },
        ],
        response: `{
  "url": "https://pps.whatsapp.net/v/t61..."
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  http://localhost:3100/api/contacts/5511999999999@s.whatsapp.net/profile-pic`,
      },
    ],
  },
  {
    id: "groups",
    title: "Groups",
    description: "Manage WhatsApp groups: list, inspect, update, and manage participants.",
    prefix: "/api/groups",
    endpoints: [
      {
        method: "GET",
        path: "/api/groups",
        description: "List all groups.",
        params: [
          { name: "search", type: "string", description: "Filter by group name" },
        ],
        response: `{
  "data": [
    {
      "jid": "120363012345@g.us",
      "name": "Team Chat",
      "participant_count": 12,
      "owner_jid": "5511999999999@s.whatsapp.net"
    }
  ]
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/groups`,
      },
      {
        method: "GET",
        path: "/api/groups/:jid",
        description: "Get group details including the full participant list.",
        params: [
          { name: "jid", type: "string", required: true, description: "Group JID (path parameter)" },
        ],
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/groups/120363012345@g.us`,
      },
      {
        method: "GET",
        path: "/api/groups/:jid/metadata",
        description: "Fetch fresh group metadata directly from WhatsApp (not cached).",
        params: [
          { name: "jid", type: "string", required: true, description: "Group JID (path parameter)" },
        ],
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  http://localhost:3100/api/groups/120363012345@g.us/metadata`,
      },
      {
        method: "GET",
        path: "/api/groups/:jid/invite-code",
        description: "Get the group's invite link code.",
        params: [
          { name: "jid", type: "string", required: true, description: "Group JID (path parameter)" },
        ],
        response: `{ "code": "AbCdEfGhIjK" }`,
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  http://localhost:3100/api/groups/120363012345@g.us/invite-code`,
      },
      {
        method: "PUT",
        path: "/api/groups/:jid/subject",
        description: "Update a group's subject (name).",
        params: [
          { name: "jid", type: "string", required: true, description: "Group JID (path parameter)" },
        ],
        body: [
          { name: "subject", type: "string", required: true, description: "New group subject (1-100 characters)" },
        ],
        curl: `curl -X PUT -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"subject":"New Group Name"}' \\
  http://localhost:3100/api/groups/120363012345@g.us/subject`,
      },
      {
        method: "PUT",
        path: "/api/groups/:jid/description",
        description: "Update a group's description.",
        params: [
          { name: "jid", type: "string", required: true, description: "Group JID (path parameter)" },
        ],
        body: [
          { name: "description", type: "string", required: true, description: "New group description (max 2048 characters)" },
        ],
        curl: `curl -X PUT -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"description":"Updated description"}' \\
  http://localhost:3100/api/groups/120363012345@g.us/description`,
      },
      {
        method: "POST",
        path: "/api/groups/:jid/participants",
        description: "Add, remove, promote, or demote group participants. All JIDs are validated.",
        params: [
          { name: "jid", type: "string", required: true, description: "Group JID (path parameter)" },
        ],
        body: [
          { name: "participants", type: "string[]", required: true, description: "Array of valid participant JIDs (e.g. number@s.whatsapp.net)" },
          { name: "action", type: "string", required: true, description: "One of: add, remove, promote, demote" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"participants":["5511888888888@s.whatsapp.net"],"action":"add"}' \\
  http://localhost:3100/api/groups/120363012345@g.us/participants`,
      },
      {
        method: "POST",
        path: "/api/groups/sync",
        description: "Sync all groups from WhatsApp. Fetches fresh metadata for every group.",
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" http://localhost:3100/api/groups/sync`,
      },
    ],
  },
  {
    id: "actions",
    title: "Actions",
    description: "Send messages, media, reactions, read receipts, and presence updates.",
    prefix: "/api/actions",
    endpoints: [
      {
        method: "POST",
        path: "/api/actions/send/text",
        description: "Send a text message. Optionally quote a previous message.",
        body: [
          { name: "jid", type: "string", required: true, description: "Recipient JID" },
          { name: "text", type: "string", required: true, description: "Message text" },
          { name: "quoted_id", type: "string", description: "Message ID to quote/reply to" },
        ],
        response: `{
  "message_id": "3EB0F1A2B3C4D5E6",
  "status": "sent"
}`,
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","text":"Hello from the API!"}' \\
  http://localhost:3100/api/actions/send/text`,
      },
      {
        method: "POST",
        path: "/api/actions/send/image",
        description: "Send an image via base64 data or a URL. URL fetches are limited to MAX_MEDIA_SIZE_MB (default 100MB) and 30s timeout.",
        body: [
          { name: "jid", type: "string", required: true, description: "Recipient JID" },
          { name: "base64", type: "string", description: "Base64-encoded image data (or use url)" },
          { name: "url", type: "string", description: "Image URL to send (or use base64)" },
          { name: "caption", type: "string", description: "Optional image caption" },
          { name: "mime_type", type: "string", description: "MIME type (auto-detected if omitted)" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","url":"https://example.com/photo.jpg","caption":"Check this out"}' \\
  http://localhost:3100/api/actions/send/image`,
      },
      {
        method: "POST",
        path: "/api/actions/send/video",
        description: "Send a video via base64 data or a URL.",
        body: [
          { name: "jid", type: "string", required: true, description: "Recipient JID" },
          { name: "base64", type: "string", description: "Base64-encoded video data (or use url)" },
          { name: "url", type: "string", description: "Video URL (or use base64)" },
          { name: "caption", type: "string", description: "Optional video caption" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","url":"https://example.com/clip.mp4"}' \\
  http://localhost:3100/api/actions/send/video`,
      },
      {
        method: "POST",
        path: "/api/actions/send/audio",
        description: "Send an audio file. Set ptt to true for voice-note style playback.",
        body: [
          { name: "jid", type: "string", required: true, description: "Recipient JID" },
          { name: "base64", type: "string", description: "Base64-encoded audio (or use url)" },
          { name: "url", type: "string", description: "Audio URL (or use base64)" },
          { name: "ptt", type: "boolean", description: "Send as push-to-talk voice note" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","url":"https://example.com/voice.ogg","ptt":true}' \\
  http://localhost:3100/api/actions/send/audio`,
      },
      {
        method: "POST",
        path: "/api/actions/send/document",
        description: "Send a document (PDF, spreadsheet, etc.) with a filename.",
        body: [
          { name: "jid", type: "string", required: true, description: "Recipient JID" },
          { name: "base64", type: "string", description: "Base64-encoded file (or use url)" },
          { name: "url", type: "string", description: "Document URL (or use base64)" },
          { name: "filename", type: "string", required: true, description: "Display filename" },
          { name: "mime_type", type: "string", required: true, description: "MIME type (e.g. application/pdf)" },
          { name: "caption", type: "string", description: "Optional caption" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","url":"https://example.com/report.pdf","filename":"report.pdf","mime_type":"application/pdf"}' \\
  http://localhost:3100/api/actions/send/document`,
      },
      {
        method: "POST",
        path: "/api/actions/send/sticker",
        description: "Send a sticker image (WebP format recommended).",
        body: [
          { name: "jid", type: "string", required: true, description: "Recipient JID" },
          { name: "base64", type: "string", description: "Base64-encoded sticker (or use url)" },
          { name: "url", type: "string", description: "Sticker URL (or use base64)" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","url":"https://example.com/sticker.webp"}' \\
  http://localhost:3100/api/actions/send/sticker`,
      },
      {
        method: "POST",
        path: "/api/actions/send/location",
        description: "Send a geographic location pin.",
        body: [
          { name: "jid", type: "string", required: true, description: "Recipient JID" },
          { name: "latitude", type: "number", required: true, description: "Latitude coordinate" },
          { name: "longitude", type: "number", required: true, description: "Longitude coordinate" },
          { name: "name", type: "string", description: "Location name" },
          { name: "address", type: "string", description: "Location address" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","latitude":-23.5505,"longitude":-46.6333,"name":"São Paulo"}' \\
  http://localhost:3100/api/actions/send/location`,
      },
      {
        method: "POST",
        path: "/api/actions/send/contact",
        description: "Send a contact card (vCard).",
        body: [
          { name: "jid", type: "string", required: true, description: "Recipient JID" },
          { name: "contact_jid", type: "string", required: true, description: "Contact's JID to share" },
          { name: "name", type: "string", required: true, description: "Display name on the vCard" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","contact_jid":"5511888888888@s.whatsapp.net","name":"Jane Doe"}' \\
  http://localhost:3100/api/actions/send/contact`,
      },
      {
        method: "POST",
        path: "/api/actions/react",
        description: "React to a message with an emoji. Send empty string to remove reaction.",
        body: [
          { name: "jid", type: "string", required: true, description: "Chat JID where the message is" },
          { name: "message_id", type: "string", required: true, description: "Target message ID" },
          { name: "emoji", type: "string", required: true, description: 'Reaction emoji (e.g. "👍") or empty to remove' },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","message_id":"3EB0A1B2C3D4","emoji":"👍"}' \\
  http://localhost:3100/api/actions/react`,
      },
      {
        method: "POST",
        path: "/api/actions/read",
        description: "Mark specific messages as read (send read receipts).",
        body: [
          { name: "jid", type: "string", required: true, description: "Chat JID" },
          { name: "message_ids", type: "string[]", required: true, description: "Array of message IDs to mark as read" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jid":"5511999999999@s.whatsapp.net","message_ids":["3EB0A1B2C3D4"]}' \\
  http://localhost:3100/api/actions/read`,
      },
      {
        method: "POST",
        path: "/api/actions/presence",
        description: "Send a presence update (typing indicator, online status, etc.).",
        body: [
          { name: "type", type: "string", required: true, description: "One of: available, unavailable, composing, recording, paused" },
          { name: "jid", type: "string", description: "Target chat JID (required for composing/recording/paused)" },
        ],
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"type":"composing","jid":"5511999999999@s.whatsapp.net"}' \\
  http://localhost:3100/api/actions/presence`,
      },
      {
        method: "PUT",
        path: "/api/actions/profile-status",
        description: "Update your WhatsApp profile status text.",
        body: [
          { name: "status", type: "string", required: true, description: "New profile status text" },
        ],
        curl: `curl -X PUT -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"status":"Powered by WhatsApp Hub"}' \\
  http://localhost:3100/api/actions/profile-status`,
      },
    ],
  },
  {
    id: "media",
    title: "Media",
    description: "Access stored media files, metadata, and download content.",
    prefix: "/api/media",
    endpoints: [
      {
        method: "GET",
        path: "/api/media/stats",
        description: "Get aggregate media storage statistics.",
        response: `{
  "total": 2450,
  "total_size": 1073741824,
  "by_type": { "image/jpeg": 1200, "video/mp4": 350, ... }
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/media/stats`,
      },
      {
        method: "GET",
        path: "/api/media/:id",
        description: "Get metadata for a specific media entry.",
        params: [
          { name: "id", type: "string", required: true, description: "Media ID (path parameter)" },
        ],
        response: `{
  "data": {
    "id": "media_abc123",
    "message_id": "3EB0A1B2C3D4",
    "mime_type": "image/jpeg",
    "file_size": 245000,
    "filename": "photo.jpg",
    "download_status": "downloaded"
  }
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/media/media_abc123`,
      },
      {
        method: "GET",
        path: "/api/media/:id/download",
        description: "Download the actual media file. Returns the file with its original MIME type.",
        params: [
          { name: "id", type: "string", required: true, description: "Media ID (path parameter)" },
        ],
        notes: "Returns the raw file with the appropriate Content-Type header.",
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  http://localhost:3100/api/media/media_abc123/download -o photo.jpg`,
      },
      {
        method: "GET",
        path: "/api/media/by-message/:messageId",
        description: "Look up media by the parent message ID.",
        params: [
          { name: "messageId", type: "string", required: true, description: "Message ID (path parameter)" },
        ],
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  http://localhost:3100/api/media/by-message/3EB0A1B2C3D4`,
      },
    ],
  },
  {
    id: "export",
    title: "Export",
    description: "Export conversations as Markdown, plain text, JSON, or a Zip bundle (with media). Highly configurable: filter by chat/time/type, control rendering, redact phone numbers, anonymize JIDs, embed media inline, and more. Rate limited to 5 requests/minute.",
    prefix: "/api/export",
    endpoints: [
      {
        method: "POST",
        path: "/api/export",
        description: "Generate an export by passing a JSON body with all options. Response is the rendered file (text/markdown, text/plain, application/json, or application/zip) streamed with a Content-Disposition attachment header.",
        body: [
          { name: "days", type: "number", description: "Window: last N days (1-365). Mutually exclusive with from/to.", default: "30" },
          { name: "from", type: "number | string", description: "Window start as unix seconds or ISO datetime" },
          { name: "to", type: "number | string", description: "Window end as unix seconds or ISO datetime" },
          { name: "chats", type: "string[]", description: "Allowlist of chat JIDs to include" },
          { name: "exclude_chats", type: "string[]", description: "Blocklist of chat JIDs to exclude" },
          { name: "groups_only", type: "boolean", description: "Only include group chats. Mutually exclusive with dms_only." },
          { name: "dms_only", type: "boolean", description: "Only include 1:1 chats. Mutually exclusive with groups_only." },
          { name: "include_archived", type: "boolean", description: "Include archived chats", default: "false" },
          { name: "include_muted", type: "boolean", description: "Include muted chats", default: "true" },
          { name: "unread_only", type: "boolean", description: "Only chats with unread messages", default: "false" },
          { name: "min_messages", type: "number", description: "Skip chats with fewer than N messages in window", default: "0" },
          { name: "sort_chats_by", type: "string", description: "recent | volume | name", default: "recent" },
          { name: "max_chats", type: "number", description: "Cap on number of chats (≤500)", default: "500" },
          { name: "max_messages", type: "number", description: "Cap on total messages (≤200000)", default: "100000" },
          { name: "types", type: "string[]", description: "Allowlist of message types (text, image, video, etc.)" },
          { name: "exclude_types", type: "string[]", description: "Excluded message types", default: '["reaction","poll_update"]' },
          { name: "include_deleted", type: "boolean", description: "Include deleted messages", default: "false" },
          { name: "include_system", type: "boolean", description: "Include protocol/sync messages", default: "false" },
          { name: "min_body_length", type: "number", description: "Skip messages whose body is shorter than this", default: "0" },
          { name: "from_me", type: "boolean", description: "Filter to only sent or only received" },
          { name: "has_media", type: "boolean", description: "Filter to only messages that carry media" },
          { name: "search", type: "string", description: "LIKE search across message body" },
          { name: "format", type: "string", description: "md | txt | json | zip", default: "md" },
          { name: "preset", type: "string", description: "concise | full | llm | archive — controls which fields are rendered", default: "full" },
          { name: "timezone", type: "string", description: "IANA timezone (e.g. America/Sao_Paulo) for timestamps", default: "UTC" },
          { name: "time_format", type: "string", description: "absolute | relative | both", default: "absolute" },
          { name: "date_grouping", type: "string", description: "none | day | hour", default: "day" },
          { name: "reactions", type: "string", description: "inline | separate | omit", default: "inline" },
          { name: "me_alias", type: "string", description: "Label for messages you sent", default: "Me" },
          { name: "prefer_saved_names", type: "boolean", description: "Prefer contact-saved names over push names", default: "true" },
          { name: "media", type: "string", description: "none | ref | embed | attach. zip format requires attach.", default: "none" },
          { name: "max_media_size_mb", type: "number", description: "Skip media larger than this when attaching/embedding", default: "50" },
          { name: "include_thumbnails", type: "boolean", description: "Include image thumbnails inline", default: "false" },
          { name: "redact_phone_numbers", type: "boolean", description: "Replace phone digits in message bodies with •", default: "false" },
          { name: "anonymize_jids", type: "boolean", description: "Hash JIDs to opaque IDs throughout the output", default: "false" },
          { name: "strip_quoted_bodies", type: "boolean", description: "Drop quoted-reply bodies (privacy)", default: "false" },
        ],
        response: `[markdown / text / json / zip stream]
Content-Type: text/markdown; charset=utf-8
Content-Disposition: attachment; filename="whatsapp-export-20260508-1843.md"

---
generated_at: 2026-05-08T18:43:00.000Z
window: { from: 1746576000, to: 1746662400 }
chats_included: 12
messages_included: 1834
---

# WhatsApp Export
...`,
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"days":7,"format":"md","preset":"full","timezone":"America/Sao_Paulo"}' \\
  http://localhost:3100/api/export -o export.md`,
        notes: "Rate limited to 5 requests per minute per API key. Sync streaming with a 100k message and 500 chat hard cap. For large exports prefer format=zip with media=attach.",
      },
      {
        method: "GET",
        path: "/api/export",
        description: "Convenience GET form. Same parameters as POST, but passed as URL query parameters. Useful for browser downloads and sharing links. Note that array parameters (chats, exclude_chats, types, exclude_types) accept comma-separated values.",
        params: [
          { name: "days", type: "number", description: "Window: last N days", default: "30" },
          { name: "from", type: "number | string", description: "Window start (unix or ISO)" },
          { name: "to", type: "number | string", description: "Window end (unix or ISO)" },
          { name: "format", type: "string", description: "md | txt | json | zip", default: "md" },
          { name: "preset", type: "string", description: "concise | full | llm | archive", default: "full" },
          { name: "timezone", type: "string", description: "IANA timezone", default: "UTC" },
          { name: "media", type: "string", description: "none | ref | embed | attach", default: "none" },
          { name: "chats", type: "string", description: "Comma-separated chat JID allowlist" },
          { name: "exclude_chats", type: "string", description: "Comma-separated chat JID blocklist" },
          { name: "types", type: "string", description: "Comma-separated message-type allowlist" },
          { name: "exclude_types", type: "string", description: "Comma-separated message-type blocklist" },
          { name: "groups_only", type: "boolean", description: "Only group chats" },
          { name: "dms_only", type: "boolean", description: "Only 1:1 chats" },
          { name: "include_archived", type: "boolean", description: "Include archived chats" },
          { name: "redact_phone_numbers", type: "boolean", description: "Replace phone digits with •" },
          { name: "anonymize_jids", type: "boolean", description: "Hash JIDs throughout output" },
        ],
        notes: "All POST body fields are accepted as query parameters. See POST for full list.",
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  "http://localhost:3100/api/export?days=7&format=md&timezone=America/Sao_Paulo&groups_only=true" \\
  -o groups-export.md`,
      },
    ],
  },
  {
    id: "webhooks",
    title: "Webhooks",
    description: "Manage webhook subscriptions for real-time event delivery over HTTP.",
    prefix: "/api/webhooks",
    endpoints: [
      {
        method: "GET",
        path: "/api/webhooks",
        description: "List all webhook subscriptions.",
        response: `{
  "data": [
    {
      "id": "wh_1",
      "url": "https://example.com/webhook",
      "events": "*",
      "is_active": 1,
      "created_at": "2025-01-15T10:30:00Z"
    }
  ]
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/webhooks`,
      },
      {
        method: "POST",
        path: "/api/webhooks",
        description: "Create a new webhook subscription. URLs are validated against SSRF at creation and at delivery time.",
        body: [
          { name: "url", type: "string", required: true, description: "Webhook endpoint URL (max 2048 chars, no private IPs)" },
          { name: "secret", type: "string", description: "HMAC-SHA256 secret for signature verification (encrypted at rest when SECURITY_ENCRYPT_WEBHOOK_SECRETS=true)" },
          { name: "events", type: "string", description: 'Comma-separated event filter, or "*" for all', default: '"*"' },
        ],
        response: `{
  "data": {
    "id": "wh_2",
    "url": "https://example.com/webhook",
    "events": "wa.messages.upsert,wa.presence.update",
    "is_active": 1
  }
}`,
        curl: `curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com/webhook","secret":"my-secret","events":"wa.messages.upsert"}' \\
  http://localhost:3100/api/webhooks`,
      },
      {
        method: "DELETE",
        path: "/api/webhooks/:id",
        description: "Delete a webhook subscription.",
        params: [
          { name: "id", type: "string", required: true, description: "Webhook ID (path parameter)" },
        ],
        curl: `curl -X DELETE -H "x-api-key: YOUR_KEY" http://localhost:3100/api/webhooks/wh_1`,
      },
      {
        method: "PUT",
        path: "/api/webhooks/:id/toggle",
        description: "Toggle a webhook subscription between active and inactive.",
        params: [
          { name: "id", type: "string", required: true, description: "Webhook ID (path parameter)" },
        ],
        curl: `curl -X PUT -H "x-api-key: YOUR_KEY" http://localhost:3100/api/webhooks/wh_1/toggle`,
      },
    ],
  },
  {
    id: "stats",
    title: "Stats & Events",
    description: "Dashboard statistics and the event audit log.",
    prefix: "/api/stats",
    endpoints: [
      {
        method: "GET",
        path: "/api/stats",
        description: "Get overall dashboard statistics (message counts, contacts, groups, etc.).",
        response: `{
  "messages": 15420,
  "contacts": 342,
  "groups": 28,
  "media": 2450,
  "chats": 86
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/stats`,
      },
      {
        method: "GET",
        path: "/api/stats/events",
        description: "Query the event audit log with pagination.",
        params: [
          { name: "type", type: "string", description: "Filter by event type" },
          { name: "limit", type: "number", description: "Results per page", default: "50" },
          { name: "offset", type: "number", description: "Pagination offset", default: "0" },
          { name: "after", type: "string", description: "ISO timestamp lower bound" },
        ],
        response: `{
  "data": [
    {
      "id": 1234,
      "event_type": "wa.messages.upsert",
      "payload": { ... },
      "logged_at": "2025-01-15T10:30:00Z"
    }
  ],
  "total": 50000
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" \\
  "http://localhost:3100/api/stats/events?type=wa.messages.upsert&limit=10"`,
      },
      {
        method: "GET",
        path: "/api/stats/events/types",
        description: "Get a breakdown of event counts grouped by event type.",
        response: `{
  "data": [
    { "event_type": "wa.messages.upsert", "count": 25000 },
    { "event_type": "wa.presence.update", "count": 12000 },
    ...
  ]
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/stats/events/types`,
      },
      {
        method: "DELETE",
        path: "/api/stats/events/prune",
        description: "Delete event log entries older than the specified number of days.",
        params: [
          { name: "days", type: "number", description: "Delete events older than N days", default: "30" },
        ],
        response: `{ "deleted": 15000 }`,
        curl: `curl -X DELETE -H "x-api-key: YOUR_KEY" \\
  "http://localhost:3100/api/stats/events/prune?days=30"`,
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    description: "View and update runtime settings. Changes persist across restarts (stored in DB).",
    prefix: "/api/settings",
    endpoints: [
      {
        method: "GET",
        path: "/api/settings",
        description: "List all runtime settings with their current values, defaults, and override status.",
        response: `{
  "data": [
    { "key": "logLevel", "value": "info", "default": "info", "overridden": false },
    { "key": "autoDownloadMedia", "value": true, "default": true, "overridden": false },
    { "key": "maxMediaSizeMB", "value": 100, "default": 100, "overridden": false }
  ]
}`,
        curl: `curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/settings`,
      },
      {
        method: "PUT",
        path: "/api/settings",
        description: "Update one or more runtime settings. At least one field is required.",
        body: [
          { name: "logLevel", type: "string", description: "Log level: trace, debug, info, warn, error, fatal" },
          { name: "autoDownloadMedia", type: "boolean", description: "Auto-download media from messages" },
          { name: "maxMediaSizeMB", type: "number", description: "Max media file size for auto-download (MB)" },
        ],
        response: `{ "data": [ ... ] }`,
        curl: `curl -X PUT -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"logLevel":"debug"}' \\
  http://localhost:3100/api/settings`,
      },
    ],
  },
]

const WEBHOOK_EVENTS = [
  { event: "wa.messages.upsert", description: "New message received or sent" },
  { event: "wa.messages.update", description: "Message status changed (delivered, read, etc.)" },
  { event: "wa.messages.delete", description: "Message was deleted" },
  { event: "wa.messages.reaction", description: "Reaction added or removed" },
  { event: "wa.message-receipt.update", description: "Read receipt status updated" },
  { event: "wa.presence.update", description: "Contact online/offline/typing status changed" },
  { event: "wa.contacts.upsert", description: "New contacts added" },
  { event: "wa.contacts.update", description: "Contact info updated" },
  { event: "wa.chats.upsert", description: "New chat created" },
  { event: "wa.chats.update", description: "Chat metadata updated" },
  { event: "wa.chats.delete", description: "Chat deleted" },
  { event: "wa.groups.upsert", description: "New group created or joined" },
  { event: "wa.groups.update", description: "Group metadata updated" },
  { event: "wa.group-participants.update", description: "Participants added, removed, promoted, or demoted" },
  { event: "wa.labels.association", description: "Label assigned to chat/message" },
  { event: "wa.labels.edit", description: "Label created or modified" },
  { event: "wa.call", description: "Incoming or outgoing call event" },
  { event: "wa.messaging-history.set", description: "Initial history sync completed" },
]

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function ApiDocsPage() {
  const [search, setSearch] = useState("")
  const [activeSection, setActiveSection] = useState("authentication")
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const filteredSections = useMemo(() => {
    if (!search.trim()) return API_SECTIONS
    const q = search.toLowerCase()
    return API_SECTIONS.map((section) => ({
      ...section,
      endpoints: section.endpoints.filter(
        (ep) =>
          ep.path.toLowerCase().includes(q) ||
          ep.description.toLowerCase().includes(q) ||
          ep.method.toLowerCase().includes(q)
      ),
    })).filter((s) => s.endpoints.length > 0 || s.title.toLowerCase().includes(q))
  }, [search])

  const totalEndpoints = API_SECTIONS.reduce((sum, s) => sum + s.endpoints.length, 0)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    )

    for (const ref of Object.values(sectionRefs.current)) {
      if (ref) observer.observe(ref)
    }
    return () => observer.disconnect()
  }, [filteredSections])

  const scrollTo = useCallback((id: string) => {
    const el = sectionRefs.current[id] || document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [])

  const allNavItems = [
    { id: "authentication", label: "Authentication" },
    { id: "base-url", label: "Base URL" },
    ...API_SECTIONS.map((s) => ({ id: s.id, label: s.title })),
    { id: "websocket", label: "WebSocket" },
    { id: "webhook-events", label: "Webhook Events" },
    { id: "security", label: "Security" },
    { id: "health", label: "Health Check" },
  ]

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-6 pb-32">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <BookOpen className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">API Documentation</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Complete reference for the WhatsApp Hub REST API &middot; {totalEndpoints} endpoints
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
            >
              <a
                href="/api/openapi.md?download=1"
                download="whatsapp-hub-api.md"
              >
                <Download className="h-3.5 w-3.5" />
                Download .md
              </a>
            </Button>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search endpoints..."
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Authentication */}
        <div
          id="authentication"
          ref={(el) => { sectionRefs.current["authentication"] = el }}
        >
          <Card className="gap-0 py-0 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/50 bg-muted/20">
              <Lock className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold">Authentication</h2>
            </div>
            <CardContent className="p-5 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                All API endpoints require authentication via an API key. Provide it using any of the methods below.
                The key is set via the <code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono">API_KEY</code> environment variable.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: "Header (recommended)", code: "x-api-key: YOUR_KEY", desc: "Custom header" },
                  { label: "Bearer Token", code: "Authorization: Bearer YOUR_KEY", desc: "Standard auth header" },
                  { label: "Query Parameter", code: "?api_key=YOUR_KEY", desc: "Disabled when SECURITY_DISABLE_HTTP_QUERY_AUTH=true" },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg border border-border/50 p-3 bg-muted/20">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{m.label}</div>
                    <code className="text-xs font-mono text-foreground/90 break-all">{m.code}</code>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">{m.desc}</p>
                  </div>
                ))}
              </div>
              <CodeBlock
                code={`# Using header
curl -H "x-api-key: YOUR_KEY" http://localhost:3100/api/connection/status

# Using bearer token
curl -H "Authorization: Bearer YOUR_KEY" http://localhost:3100/api/connection/status

# Using query parameter
curl "http://localhost:3100/api/connection/status?api_key=YOUR_KEY"`}
                label="Examples"
              />
            </CardContent>
          </Card>
        </div>

        {/* Base URL */}
        <div
          id="base-url"
          ref={(el) => { sectionRefs.current["base-url"] = el }}
        >
          <Card className="gap-0 py-0 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/50 bg-muted/20">
              <Globe className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-semibold">Base URL</h2>
            </div>
            <CardContent className="p-5 space-y-3">
              <p className="text-sm text-muted-foreground leading-relaxed">
                All API paths are relative to your WhatsApp Hub server. The default port is <code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono">3100</code>.
              </p>
              <div className="rounded-lg bg-muted/40 border border-border/50 px-4 py-2.5">
                <code className="text-sm font-mono text-foreground">http://localhost:3100</code>
              </div>
              <p className="text-xs text-muted-foreground/60">
                All responses return JSON with <code className="bg-muted rounded px-1 py-0.5 font-mono">Content-Type: application/json</code> unless otherwise noted.
                Errors return <code className="bg-muted rounded px-1 py-0.5 font-mono">{"{ \"error\": \"message\" }"}</code> with an appropriate HTTP status code.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Endpoint Sections */}
        {filteredSections.map((section) => (
          <div
            key={section.id}
            id={section.id}
            ref={(el) => { sectionRefs.current[section.id] = el }}
          >
            <Card className="gap-0 py-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-muted/20">
                <div>
                  <h2 className="text-sm font-semibold">{section.title}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
                </div>
                <Badge variant="secondary" className="text-xs font-mono shrink-0">
                  {section.prefix}
                </Badge>
              </div>
              <div>
                {section.endpoints.map((ep, i) => (
                  <EndpointCard
                    key={ep.method + ep.path}
                    endpoint={ep}
                    isLast={i === section.endpoints.length - 1}
                  />
                ))}
                {section.endpoints.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No endpoints match your search.
                  </div>
                )}
              </div>
            </Card>
          </div>
        ))}

        {/* WebSocket */}
        <div
          id="websocket"
          ref={(el) => { sectionRefs.current["websocket"] = el }}
        >
          <Card className="gap-0 py-0 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/50 bg-muted/20">
              <Radio className="h-4 w-4 text-purple-400" />
              <h2 className="text-sm font-semibold">WebSocket</h2>
              <Badge variant="secondary" className="text-xs font-mono ml-auto">Real-time</Badge>
            </div>
            <CardContent className="p-5 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Connect via WebSocket for real-time event streaming. All WhatsApp events are pushed to connected clients as they happen.
                Stale connections are automatically cleaned up via ping/pong heartbeat (30s interval). Max 20 concurrent connections.
              </p>

              <div className="space-y-2">
                <div className="rounded-lg bg-muted/40 border border-border/50 px-4 py-2.5 flex items-center gap-3">
                  <MethodBadge method="WS" />
                  <code className="text-sm font-mono text-foreground">/ws?ticket=ONE_TIME_TICKET</code>
                  <Badge variant="secondary" className="text-[10px] font-mono ml-auto">Recommended</Badge>
                </div>
                <div className="rounded-lg bg-muted/40 border border-border/50 px-4 py-2.5 flex items-center gap-3">
                  <MethodBadge method="WS" />
                  <code className="text-sm font-mono text-foreground">/ws?api_key=YOUR_KEY</code>
                  <Badge variant="outline" className="text-[10px] font-mono ml-auto">Legacy</Badge>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
                  Ticket-based auth (SECURITY_WS_TICKET_AUTH=true)
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  When enabled, obtain a one-time ticket via <code className="bg-muted rounded px-1 py-0.5 font-mono">POST /api/ws/ticket</code>, then connect
                  with <code className="bg-muted rounded px-1 py-0.5 font-mono">?ticket=...</code>. Tickets expire after 30 seconds and can only be used once.
                  This prevents the API key from appearing in WebSocket URLs (browser history, server logs). Non-browser clients can still use the
                  {" "}<code className="bg-muted rounded px-1 py-0.5 font-mono">x-api-key</code> header.
                </p>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
                  Ticket Endpoint
                </div>
                <div className="border-b border-border/30 w-full flex items-start gap-3 px-4 py-3">
                  <MethodBadge method="POST" />
                  <div className="flex-1 min-w-0">
                    <code className="text-[13px] font-mono text-foreground/90">/api/ws/ticket</code>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Issue a one-time WebSocket ticket. Requires API key authentication. Returns a ticket valid for 30 seconds.
                    </p>
                  </div>
                </div>
                <div className="px-4 py-3 ml-[76px] space-y-3">
                  <CodeBlock code={`curl -X POST -H "x-api-key: YOUR_KEY" http://localhost:3100/api/ws/ticket`} label="Example Request" />
                  <CodeBlock code={`{ "ticket": "abc123...", "expiresIn": 30 }`} label="Response" />
                </div>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
                  Connection Parameters
                </div>
                <div className="rounded-lg border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Param</th>
                        <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Required</th>
                        <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/30">
                        <td className="py-2 px-3 font-mono text-xs">ticket</td>
                        <td className="py-2 px-3"><span className="text-[10px] font-medium text-amber-400">see notes</span></td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">One-time ticket from POST /api/ws/ticket (preferred when SECURITY_WS_TICKET_AUTH=true)</td>
                      </tr>
                      <tr className="border-b border-border/30">
                        <td className="py-2 px-3 font-mono text-xs">api_key</td>
                        <td className="py-2 px-3"><span className="text-[10px] font-medium text-amber-400">see notes</span></td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">API key (legacy mode, or when ticket auth is disabled)</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-mono text-xs">events</td>
                        <td className="py-2 px-3"><span className="text-[10px] text-muted-foreground/50">optional</span></td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">Comma-separated event filter. Receives all events if omitted.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <Tabs defaultValue="js">
                <TabsList className="h-8">
                  <TabsTrigger className="text-xs px-3" value="js">JavaScript (ticket)</TabsTrigger>
                  <TabsTrigger className="text-xs px-3" value="js-legacy">JavaScript (legacy)</TabsTrigger>
                  <TabsTrigger className="text-xs px-3" value="python">Python</TabsTrigger>
                  <TabsTrigger className="text-xs px-3" value="curl">wscat</TabsTrigger>
                </TabsList>
                <TabsContent value="js" className="mt-3">
                  <CodeBlock code={`// Step 1: Get a one-time ticket
const res = await fetch("http://localhost:3100/api/ws/ticket", {
  method: "POST",
  headers: { "x-api-key": "YOUR_KEY" },
});
const { ticket } = await res.json();

// Step 2: Connect with the ticket
const ws = new WebSocket(\`ws://localhost:3100/ws?ticket=\${ticket}\`);

ws.onopen = () => console.log("Connected");
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.type, data.data);
};`} />
                </TabsContent>
                <TabsContent value="js-legacy" className="mt-3">
                  <CodeBlock code={`const ws = new WebSocket("ws://localhost:3100/ws?api_key=YOUR_KEY");

ws.onopen = () => console.log("Connected");

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.type, data.data);
};

ws.onclose = () => setTimeout(() => ws = new WebSocket(...), 3000);`} />
                </TabsContent>
                <TabsContent value="python" className="mt-3">
                  <CodeBlock code={`import asyncio, websockets, json

async def listen():
    uri = "ws://localhost:3100/ws?api_key=YOUR_KEY"
    async with websockets.connect(uri) as ws:
        async for message in ws:
            event = json.loads(message)
            print(event["type"], event["data"])

asyncio.run(listen())`} />
                </TabsContent>
                <TabsContent value="curl" className="mt-3">
                  <CodeBlock code={`# Install: npm install -g wscat
wscat -c "ws://localhost:3100/ws?api_key=YOUR_KEY"

# With event filter
wscat -c "ws://localhost:3100/ws?api_key=YOUR_KEY&events=wa.messages.upsert,wa.presence.update"

# With x-api-key header (works when ticket auth is enabled)
wscat -c "ws://localhost:3100/ws" -H "x-api-key: YOUR_KEY"`} />
                </TabsContent>
              </Tabs>

              <CodeBlock
                code={`{
  "type": "wa.messages.upsert",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "data": {
    "messages": [
      {
        "key": { "remoteJid": "5511999999999@s.whatsapp.net", "id": "3EB0A1B2C3D4" },
        "message": { "conversation": "Hello!" },
        "messageTimestamp": 1705312200
      }
    ]
  }
}`}
                label="Example Message"
              />
            </CardContent>
          </Card>
        </div>

        {/* Webhook Events Reference */}
        <div
          id="webhook-events"
          ref={(el) => { sectionRefs.current["webhook-events"] = el }}
        >
          <Card className="gap-0 py-0 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/50 bg-muted/20">
              <Webhook className="h-4 w-4 text-orange-400" />
              <h2 className="text-sm font-semibold">Webhook Events Reference</h2>
            </div>
            <CardContent className="p-5 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Webhook payloads are delivered as POST requests with the following headers:
              </p>

              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { header: "X-Hub-Event", desc: "Event type string" },
                  { header: "X-Hub-Timestamp", desc: "Unix timestamp" },
                  { header: "X-Hub-Signature", desc: "sha256=<HMAC> (if secret set)" },
                ].map((h) => (
                  <div key={h.header} className="rounded-lg border border-border/50 p-3 bg-muted/20">
                    <code className="text-xs font-mono text-foreground/90">{h.header}</code>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">{h.desc}</p>
                  </div>
                ))}
              </div>

              <Separator className="opacity-30" />

              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
                  Available Events
                </div>
                <div className="rounded-lg border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Event</th>
                        <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {WEBHOOK_EVENTS.map((ev) => (
                        <tr key={ev.event} className="border-b border-border/30 last:border-0">
                          <td className="py-2 px-3">
                            <code className="text-xs font-mono text-foreground/90">{ev.event}</code>
                          </td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">{ev.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <CodeBlock
                code={`{
  "type": "wa.messages.upsert",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "data": { ... }
}

# Signature verification (Node.js)
const crypto = require("crypto");
const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
const isValid = req.headers["x-hub-signature"] === "sha256=" + signature;`}
                label="Webhook Payload & Verification"
              />
            </CardContent>
          </Card>
        </div>

        {/* Security Configuration */}
        <div
          id="security"
          ref={(el) => { sectionRefs.current["security"] = el }}
        >
          <Card className="gap-0 py-0 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/50 bg-muted/20">
              <Shield className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold">Security Configuration</h2>
              <Badge variant="outline" className="text-[10px] font-mono ml-2">Server-side</Badge>
            </div>
            <CardContent className="p-5 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                WhatsApp Hub includes configurable security features controlled via environment variables.
                All features default to off for backward compatibility. Set them in your <code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono">.env</code> file
                or Docker environment.
              </p>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
                  Security Environment Variables
                </div>
                <div className="rounded-lg border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Variable</th>
                        <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Default</th>
                        <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { name: "SECURITY_WS_TICKET_AUTH", def: "false", desc: "Use one-time tickets for WebSocket auth instead of api_key in query string", level: "!!" },
                        { name: "SECURITY_DISABLE_HTTP_QUERY_AUTH", def: "false", desc: "Disable api_key query parameter on HTTP endpoints", level: "!!" },
                        { name: "SECURITY_ENCRYPT_DATABASE", def: "false", desc: "Encrypt SQLite database at rest (requires ENCRYPTION_KEY)", level: "--" },
                        { name: "SECURITY_ENCRYPT_WEBHOOK_SECRETS", def: "false", desc: "Encrypt webhook HMAC secrets at rest (requires ENCRYPTION_KEY)", level: "--" },
                        { name: "SECURITY_STRIP_RAW_MESSAGES", def: "false", desc: "Strip raw_message field from API responses", level: "--" },
                        { name: "ENCRYPTION_KEY", def: "—", desc: "Master encryption key (min 16 chars) for database and webhook secret encryption", level: "" },
                        { name: "SECURITY_AUTO_PRUNE", def: "false", desc: "Auto-prune old presence and event log entries every 6 hours", level: "" },
                        { name: "PRESENCE_RETENTION_DAYS", def: "7", desc: "Days to keep presence log entries (when auto-prune is enabled)", level: "" },
                        { name: "EVENT_RETENTION_DAYS", def: "30", desc: "Days to keep event log entries (when auto-prune is enabled)", level: "" },
                        { name: "SECURITY_HASH_EVENT_JIDS", def: "false", desc: "Hash phone numbers in event_log for privacy (one-way)", level: "" },
                        { name: "SECURITY_SEC_FETCH_CHECK", def: "false", desc: "Block cross-site browser requests via Sec-Fetch-Site header", level: "" },
                      ].map((v) => (
                        <tr key={v.name} className="border-b border-border/30 last:border-0">
                          <td className="py-2 px-3 font-mono text-xs text-foreground/90">
                            {v.name}
                            {v.level === "!!" && <span className="ml-1.5 text-[9px] text-amber-400 font-sans">STRONGLY REC.</span>}
                            {v.level === "--" && <span className="ml-1.5 text-[9px] text-blue-400 font-sans">REC.</span>}
                          </td>
                          <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{v.def}</td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">{v.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-xs text-muted-foreground/60 italic">
                On startup, the server prints a summary of which security features are enabled and which are recommended.
                Always-on hardening (Bearer token parsing, WebSocket ping/pong, input validation, SSRF re-validation, rate limiting per API key) requires no configuration.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Health Check */}
        <div
          id="health"
          ref={(el) => { sectionRefs.current["health"] = el }}
        >
          <Card className="gap-0 py-0 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/50 bg-muted/20">
              <Heart className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold">Health Check</h2>
              <Badge variant="outline" className="text-[10px] font-mono ml-2">No Auth</Badge>
            </div>
            <div>
              <div className="w-full flex items-start gap-3 px-4 py-3">
                <MethodBadge method="GET" />
                <div className="flex-1 min-w-0">
                  <code className="text-[13px] font-mono text-foreground/90">/health</code>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Simple health check endpoint. Does not require authentication. Use for monitoring and container health probes.
                  </p>
                </div>
              </div>
              <div className="px-4 pb-4 ml-[76px] space-y-4">
                <CodeBlock code={`curl http://localhost:3100/health`} label="Example Request" />
                <CodeBlock code={`{ "status": "ok" }`} label="Response" />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Right-side navigation */}
      <div className="hidden xl:block w-44 shrink-0">
        <div className="sticky top-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-3">
            On this page
          </div>
          <ScrollArea className="h-[calc(100vh-120px)]">
            <nav className="space-y-0.5">
              {allNavItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className={cn(
                    "block w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors",
                    activeSection === item.id
                      ? "text-foreground bg-muted/50 font-medium"
                      : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/30"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
