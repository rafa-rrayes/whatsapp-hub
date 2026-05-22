import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plug, Lock, Compass, Search, BarChart3, Send } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  type Endpoint,
  MethodBadge,
  CodeBlock,
  EndpointCard,
} from "@/components/api-docs/endpoint"

// ---------------------------------------------------------------------------
// Data — the tools exposed by the MCP server (src/mcp/tools/*).
// ---------------------------------------------------------------------------

interface ToolGroup {
  id: string
  title: string
  description: string
  icon: LucideIcon
  tools: Endpoint[]
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "orientation",
    title: "Orientation",
    description: "Get your bearings and turn human-friendly names into JIDs before drilling in.",
    icon: Compass,
    tools: [
      {
        method: "TOOL",
        path: "whatsapp_overview",
        description:
          "High-level dashboard: totals across chats, contacts, groups, and messages, plus recent activity and the most active chats. Call this first to orient yourself before drilling in.",
        params: [
          { name: "days", type: "number", description: "Window size in days for recent stats (max 90)", default: "7" },
        ],
      },
      {
        method: "TOOL",
        path: "resolve_contact",
        description:
          "Fuzzy lookup mapping a free-text query (name, partial name, phone number, or JID) to a ranked list of contacts, groups, and chats. Translate a reference like \"Mom\" into a JID before calling tools that require one.",
        params: [
          { name: "query", type: "string", required: true, description: "Name, partial name, phone number, or JID to look up" },
          { name: "limit", type: "number", description: "Max candidates to return (max 30)", default: "10" },
          { name: "groups_only", type: "boolean", description: "Only consider group chats", default: "false" },
          { name: "dms_only", type: "boolean", description: "Only consider 1:1 (DM) chats", default: "false" },
        ],
      },
      {
        method: "TOOL",
        path: "list_chats",
        description:
          "Browse chats with optional filters (unread-only, groups/DMs, name substring, active within N days), sorted by most recent activity.",
        params: [
          { name: "unread_only", type: "boolean", description: "Only chats with unread_count > 0", default: "false" },
          { name: "groups_only", type: "boolean", description: "Only group chats", default: "false" },
          { name: "dms_only", type: "boolean", description: "Only 1:1 (DM) chats", default: "false" },
          { name: "name_contains", type: "string", description: "Case-insensitive substring filter on the chat name or JID" },
          { name: "active_since_days", type: "number", description: "Only chats whose last message is within the last N days (max 365)" },
          { name: "limit", type: "number", description: "Max chats to return (max 200)", default: "30" },
        ],
      },
    ],
  },
  {
    id: "search",
    title: "Search & retrieval",
    description: "Find specific content and pull the surrounding context as markdown.",
    icon: Search,
    tools: [
      {
        method: "TOOL",
        path: "search_messages",
        description:
          "Full-text search across the message archive. Returns snippets (not full bodies) so you can scan many hits cheaply. Narrow by chat, sender, time range, or message type.",
        params: [
          { name: "query", type: "string", required: true, description: "Free-text search term, matched against message bodies" },
          { name: "chat", type: "string", description: "Name or JID to restrict the search to a single chat" },
          { name: "from", type: "string", description: "Sender name or JID to restrict to a single sender" },
          { name: "after", type: "string", description: "ISO 8601 or unix timestamp. Lower bound, exclusive" },
          { name: "before", type: "string", description: "ISO 8601 or unix timestamp. Upper bound, exclusive" },
          { name: "types", type: "string[]", description: "Message types to include (e.g. [\"text\",\"image\"]). Omit for all" },
          { name: "limit", type: "number", description: "Max results (max 100)", default: "20" },
        ],
      },
      {
        method: "TOOL",
        path: "recent_activity",
        description:
          "Summarize activity over a flexible time window. Modes: summary (per-chat aggregates), firehose (chronological message list), rendered (markdown per chat).",
        params: [
          { name: "window", type: "string", description: "Named window: today, yesterday, past_hour, past_24h, past_week. Overridden by since/until", default: "past_24h" },
          { name: "since", type: "string", description: "ISO 8601 or unix timestamp; overrides window if set" },
          { name: "until", type: "string", description: "ISO 8601 or unix timestamp; defaults to now" },
          { name: "chats", type: "string[]", description: "Names or JIDs to include. If set, only these chats are considered" },
          { name: "exclude_chats", type: "string[]", description: "Names or JIDs to exclude from results" },
          { name: "groups_only", type: "boolean", description: "Only group chats", default: "false" },
          { name: "dms_only", type: "boolean", description: "Only 1:1 (DM) chats", default: "false" },
          { name: "unread_only", type: "boolean", description: "Only chats with unread_count > 0", default: "false" },
          { name: "exclude_types", type: "string[]", description: "Message types to exclude", default: '["reaction","poll_update"]' },
          { name: "min_messages", type: "number", description: "Drop chats with fewer than this many messages in the window", default: "1" },
          { name: "mode", type: "summary | firehose | rendered", description: "Output shape", default: "summary" },
          { name: "timezone", type: "string", description: "IANA timezone for today/yesterday boundaries and rendered output", default: "UTC" },
          { name: "limit", type: "number", description: "Caps firehose results and rendered chat count (max 500)", default: "50" },
        ],
      },
      {
        method: "TOOL",
        path: "get_conversation",
        description:
          "Fetch messages from a chat and render them as markdown — either the last N messages or a window centered on an anchor (message ID or timestamp). Same compact format as /api/export.",
        params: [
          { name: "chat", type: "string", required: true, description: "Chat name or JID" },
          { name: "around_message_id", type: "string", description: "Center the window on this message; pair with window_minutes" },
          { name: "around_timestamp", type: "string", description: "Center the window on this timestamp (ISO or unix); pair with window_minutes" },
          { name: "last_n", type: "number", description: "Fetch the last N messages. Mutually exclusive with around_* anchors (max 500)" },
          { name: "window_minutes", type: "number", description: "Span (minutes) on either side of the anchor (max 1440)", default: "60" },
          { name: "timezone", type: "string", description: "IANA timezone for date/time formatting", default: "UTC" },
          { name: "include_id", type: "boolean", description: "Append #message_id to each line", default: "false" },
          { name: "include_reactions", type: "boolean", description: "Attach reactions inline under each target message", default: "true" },
          { name: "include_quoted", type: "boolean", description: "Show a preview of quoted messages above replies", default: "true" },
        ],
      },
      {
        method: "TOOL",
        path: "get_message",
        description:
          "Fetch a single message by ID with full context: chat, sender, body, media, reactions, and the quoted message preview if any.",
        params: [
          { name: "message_id", type: "string", required: true, description: "Message ID (the id / #xxxx reference returned by other tools)" },
        ],
      },
      {
        method: "TOOL",
        path: "get_thread",
        description:
          "Walk the quote chain backward from a message, following quoted_id up to depth levels. Returns the chain rendered as markdown with message IDs.",
        params: [
          { name: "message_id", type: "string", required: true, description: "Starting message ID; the walk follows quoted_id pointers" },
          { name: "depth", type: "number", description: "Max number of hops to follow (max 20)", default: "5" },
        ],
      },
    ],
  },
  {
    id: "aggregation",
    title: "Aggregation & export",
    description: "Summarize a chat, browse media, or render whole conversations to a portable format.",
    icon: BarChart3,
    tools: [
      {
        method: "TOOL",
        path: "chat_summary",
        description:
          "High-density activity report for a single chat over the last N days: total messages, top participants, peak hour of day, message-type breakdown, media count, and top reactions.",
        params: [
          { name: "chat", type: "string", required: true, description: "Chat name or JID. Use resolve_contact first for ambiguous names" },
          { name: "days", type: "number", description: "Window size in days (max 365)", default: "7" },
          { name: "timezone", type: "string", description: "IANA timezone used for the peak-hour bucket", default: "UTC" },
        ],
      },
      {
        method: "TOOL",
        path: "list_media",
        description:
          "Browse media attachments (image, video, audio, document, sticker) across one or all chats, optionally filtered by type or time window. Returns metadata only — fetch bytes via /api/media/:id/download.",
        params: [
          { name: "chat", type: "string", description: "Chat name or JID. Omit to search across all chats" },
          { name: "types", type: "string[]", description: "Media kinds to include (image, video, audio, document, sticker)" },
          { name: "after", type: "string", description: "Lower bound — ISO 8601 string or unix seconds" },
          { name: "before", type: "string", description: "Upper bound — ISO 8601 string or unix seconds" },
          { name: "limit", type: "number", description: "Max media items to return (max 100)", default: "30" },
        ],
      },
      {
        method: "TOOL",
        path: "export_conversation",
        description:
          "Render one or more chats into markdown, text, or JSON using the same export pipeline as /api/export, returned inline. Use preset=concise for a tight transcript, llm for a balanced view, archive for everything.",
        params: [
          { name: "chat", type: "string", description: "Single chat name or JID. Either chat or chats is required" },
          { name: "chats", type: "string[]", description: "Multiple chats (names or JIDs). Mutually exclusive with chat (1–50)" },
          { name: "days", type: "number", description: "Window size in days, ending now. Overridden by from/to (max 365)" },
          { name: "from", type: "string", description: "Window start — ISO 8601 string or unix seconds" },
          { name: "to", type: "string", description: "Window end — ISO 8601 string or unix seconds" },
          { name: "preset", type: "concise | full | llm | archive", description: "Field bundle for each message", default: "llm" },
          { name: "format", type: "md | txt | json", description: "Output format (no zip — binary is not returnable via MCP)", default: "md" },
          { name: "max_messages", type: "number", description: "Hard ceiling on total messages across all chats (max 10000)", default: "5000" },
          { name: "timezone", type: "string", description: "IANA timezone for date/time labels", default: "UTC" },
        ],
      },
    ],
  },
  {
    id: "actions",
    title: "Actions (write)",
    description:
      "The only write tools. Clients should confirm with the user before invoking, and targeting always requires an explicit JID — resolve names first.",
    icon: Send,
    tools: [
      {
        method: "TOOL",
        path: "send_message",
        description:
          "WRITE — Send a WhatsApp message (text, media, or location) to a chat. Requires an explicit JID (resolve names with resolve_contact first). Media kinds need a media_url; use kind=location with the location object.",
        notes:
          "Write tool (readOnlyHint: false). MCP clients should confirm with the user before invoking. Targeting requires a literal JID — fuzzy name matching is intentionally not supported here.",
        params: [
          { name: "jid", type: "string", required: true, description: "Target JID (e.g. 5511999999999@s.whatsapp.net or ...@g.us)" },
          { name: "kind", type: "text | image | video | audio | document | location", description: "Message kind. Inferred when omitted; required for media" },
          { name: "text", type: "string", description: "Text body, or caption for image/video/document media" },
          { name: "media_url", type: "string", description: "HTTPS URL to fetch media from. Required for image/video/audio/document" },
          { name: "filename", type: "string", description: "Filename for documents. Required when kind=document" },
          { name: "mime_type", type: "string", description: "MIME type override. Required for kind=document" },
          { name: "location", type: "object", description: "{ lat, lng, name?, address? } — used when kind=location" },
          { name: "quoted_message_id", type: "string", description: "ID of the message to quote/reply to (text only)" },
        ],
      },
      {
        method: "TOOL",
        path: "react_to_message",
        description:
          "WRITE — Add, replace, or remove a reaction emoji on a specific message. Pass an empty string for emoji to remove an existing reaction. Idempotent.",
        notes:
          "Write tool (readOnlyHint: false). MCP clients should confirm with the user before invoking. Targeting requires a literal JID — use resolve_contact first.",
        params: [
          { name: "jid", type: "string", required: true, description: "JID of the chat where the message lives" },
          { name: "message_id", type: "string", required: true, description: "ID of the message to react to (the key.id of the target)" },
          { name: "emoji", type: "string", required: true, description: 'Reaction emoji (e.g. "👍"). Empty string removes the reaction' },
        ],
      },
    ],
  },
]

const TOTAL_TOOLS = TOOL_GROUPS.reduce((sum, g) => sum + g.tools.length, 0)

const CONNECT_EXAMPLE = `# List available tools
curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \\
  http://localhost:3100/mcp

# Call a tool
curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_messages","arguments":{"query":"invoice","limit":5}}}' \\
  http://localhost:3100/mcp`

const CLIENT_CONFIG = `{
  "mcpServers": {
    "whatsapp-hub": {
      "type": "http",
      "url": "http://localhost:3100/mcp",
      "headers": { "x-api-key": "YOUR_KEY" }
    }
  }
}`

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function McpPage() {
  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <Plug className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">MCP Server</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Model Context Protocol server &middot; {TOTAL_TOOLS} tools exposed to AI clients like Claude
        </p>
      </div>

      {/* Connection */}
      <Card className="gap-0 py-0 overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/50 bg-muted/20">
          <Lock className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold">Connection &amp; Authentication</h2>
          <div className="ml-auto flex items-center gap-2">
            <MethodBadge method="POST" />
            <Badge variant="secondary" className="text-xs font-mono">/mcp</Badge>
          </div>
        </div>
        <CardContent className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            The MCP endpoint speaks JSON-RPC 2.0 over stateless Streamable HTTP — every call is a
            self-contained <code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono">POST /mcp</code>;
            {" "}<code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono">GET</code> and{" "}
            <code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono">DELETE</code> return 405.
            Call <code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono">tools/list</code> to discover
            the live schema and <code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono">tools/call</code> to invoke a tool.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                label: "API key",
                code: "x-api-key: YOUR_KEY",
                desc: "Same key as the REST API — for CLI / local clients",
              },
              {
                label: "OAuth 2.1 (Bearer)",
                code: "Authorization: Bearer <token>",
                desc: "For claude.ai-style connectors. Discovery at /.well-known/oauth-protected-resource/mcp",
              },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-border/50 p-3 bg-muted/20">
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{m.label}</div>
                <code className="text-xs font-mono text-foreground/90 break-all">{m.code}</code>
                <p className="text-[11px] text-muted-foreground/60 mt-1">{m.desc}</p>
              </div>
            ))}
          </div>

          <CodeBlock code={CONNECT_EXAMPLE} label="Connect over HTTP" />
          <CodeBlock code={CLIENT_CONFIG} label="MCP client config (http transport)" />
        </CardContent>
      </Card>

      {/* Tool groups */}
      {TOOL_GROUPS.map((group) => (
        <Card key={group.id} className="gap-0 py-0 overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/50 bg-muted/20">
            <group.icon className="h-4 w-4 text-teal-400" />
            <div>
              <h2 className="text-sm font-semibold">{group.title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
            </div>
            <Badge variant="secondary" className="text-xs font-mono ml-auto shrink-0">
              {group.tools.length} {group.tools.length === 1 ? "tool" : "tools"}
            </Badge>
          </div>
          <div>
            {group.tools.map((tool, i) => (
              <EndpointCard
                key={tool.path}
                endpoint={tool}
                isLast={i === group.tools.length - 1}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
