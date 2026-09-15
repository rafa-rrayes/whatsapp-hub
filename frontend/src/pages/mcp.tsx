import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Check, CircleHelp, Eye, EyeOff, KeyRound, Loader2, Plug, RefreshCw, ShieldCheck, Terminal, Wifi } from "lucide-react"
import { api } from "@/lib/api"
import { useAuthStore } from "@/stores/auth"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ExportMarkdownMenu } from "@/components/export-md-menu"
import { CopyAction } from "@/components/mcp/copy-action"
import { ToolCatalog } from "@/components/mcp/tool-catalog"
import { buildAgentGuide, buildAgentPrompt, buildClientConfig, checkMcpConnection, toolAccess, type AuthMode, type ConnectionCheck, type McpSetup } from "@/lib/mcp-connect"

const MASKED_KEY = "[API key hidden — Copy prompt includes your actual key]"

function ConnectionTest() {
  const apiKey = useAuthStore(s => s.apiKey)
  const [state, setState] = useState<{ pending: boolean; result?: ConnectionCheck; error?: string }>({ pending: false })
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function check() {
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    setState({ pending: true })
    try {
      const result = await checkMcpConnection(apiKey, active.signal)
      if (!active.signal.aborted) setState({ pending: false, result })
    } catch (error) {
      if (!active.signal.aborted) setState({ pending: false, error: error instanceof Error ? error.message : "Connection check failed. Try again." })
    }
  }
  return <section className="rounded-2xl border border-border/60 bg-card p-5 sm:p-6" aria-labelledby="connection-test-title">
    <div className="flex items-center gap-2 text-muted-foreground"><Wifi className="h-4 w-4" /><span className="text-xs font-medium">Connection check</span></div>
    <h2 id="connection-test-title" className="mt-3 text-lg font-semibold">Verify before you connect</h2>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Test MCP authentication, initialization, and tool discovery using your dashboard API key.</p>
    <Button variant="outline" className="mt-5 w-full" onClick={() => void check()} disabled={state.pending}>
      {state.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {state.pending ? "Checking MCP…" : state.result || state.error ? "Run check again" : "Test connection"}
    </Button>
    <div className="mt-4 text-sm" role="status" aria-live="polite">
      {state.result ? <div className="space-y-2"><p className="flex items-center gap-2 font-medium text-primary"><Check className="h-4 w-4" />MCP is responding</p><p className="text-muted-foreground">{state.result.toolCount} tools discovered · protocol {state.result.protocolVersion}</p></div>
        : state.error ? <p className="leading-relaxed text-destructive">{state.error}</p>
        : <p className="text-muted-foreground">{state.pending ? "Authenticating and discovering tools…" : "Not tested in this session."}</p>}
    </div>
    <p className="mt-4 border-t border-border/50 pt-4 text-xs leading-relaxed text-muted-foreground">Checks this dashboard’s route to MCP. External agent reachability and OAuth consent must be verified in your agent. No conversations are read or messages sent.</p>
  </section>
}

function ConnectWorkspace({ setup }: { setup: McpSetup }) {
  const apiKey = useAuthStore(s => s.apiKey)
  const [selectedMode, setSelectedMode] = useState<AuthMode | null>(null)
  const mode = selectedMode === "api-key" || !setup.auth.oauth.enabled ? "api-key" : "oauth"
  const [reveal, setReveal] = useState(false)
  const [view, setView] = useState<"prompt" | "config">("prompt")
  const actual = view === "prompt" ? buildAgentPrompt(setup, mode, apiKey) : buildClientConfig(setup, mode, apiKey)
  const preview = view === "prompt" ? buildAgentPrompt(setup, mode, reveal ? apiKey : MASKED_KEY) : buildClientConfig(setup, mode, reveal ? apiKey : MASKED_KEY)
  const isKey = mode === "api-key"
  const readCount = setup.tools.filter(t => toolAccess(t) === "Read").length
  const writeCount = setup.tools.filter(t => toolAccess(t) === "Write").length

  return <div className="space-y-10">
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-primary/25 bg-card" aria-labelledby="connect-title">
        <div className="border-b border-border/60 p-5 sm:p-7">
          <div className="mb-4 flex items-center gap-2 text-xs font-medium text-primary"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">1</span> Connect your agent</div>
          <h2 id="connect-title" className="text-xl font-semibold tracking-tight sm:text-2xl">Your WhatsApp, ready for your AI.</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Paste the setup prompt into your agent. It includes this server’s connection details and a practical guide to using your WhatsApp tools.</p>
          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border/60 bg-background/60 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><p className="mb-1 text-xs text-muted-foreground">MCP server URL</p><code className="break-all text-sm" data-testid="mcp-url">{setup.mcpUrl}</code></div>
            <CopyAction text={setup.mcpUrl} label="Copy URL" />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Streamable HTTP</span><span>{setup.urlSource === "configured" ? "Server-configured address" : "Address derived from this request"}</span></div>
        </div>
        <div className="space-y-5 p-5 sm:p-7">
          <fieldset>
            <legend className="mb-3 text-sm font-medium">Choose how to authenticate</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["oauth", "api-key"] as const).map(value => <label key={value} className={`relative flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary ${mode === value ? "border-primary/60 bg-primary/5" : "border-border/70 hover:bg-muted/30"} ${value === "oauth" && !setup.auth.oauth.enabled ? "cursor-not-allowed opacity-55" : ""}`}>
                <input className="mt-1 accent-[var(--color-primary)]" type="radio" name="mcp-auth" value={value} checked={mode === value} disabled={value === "oauth" && !setup.auth.oauth.enabled} onChange={() => { setSelectedMode(value); setReveal(false) }} />
                <div><span className="flex items-center gap-2 text-sm font-medium">{value === "oauth" ? <ShieldCheck className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}{value === "oauth" ? "OAuth" : "API key"}</span><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{value === "oauth" ? setup.auth.oauth.enabled ? "Recommended · authorize in your browser" : "Not configured on this server" : "For clients that support custom headers"}</p></div>
              </label>)}
            </div>
          </fieldset>
          {!setup.auth.oauth.enabled && <p className="text-xs leading-relaxed text-muted-foreground">{setup.auth.oauth.reason || "OAuth is unavailable. Configure the server’s public URL and OAuth password to enable browser authorization."}</p>}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-background/60">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
              <div className="flex gap-1" role="group" aria-label="Connection format">
                <Button size="sm" variant={view === "prompt" ? "secondary" : "ghost"} aria-pressed={view === "prompt"} onClick={() => setView("prompt")}>Agent prompt</Button>
                <Button size="sm" variant={view === "config" ? "secondary" : "ghost"} aria-pressed={view === "config"} onClick={() => setView("config")}>JSON config</Button>
              </div>
              {isKey && <Button size="sm" variant="ghost" onClick={() => setReveal(v => !v)}>{reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{reveal ? "Hide key" : "Reveal key"}</Button>}
            </div>
            <div className="px-4 pt-4 text-xs font-medium text-muted-foreground">{view === "prompt" ? "Paste this into your AI agent to connect your WhatsApp" : "HTTP client configuration · field names may vary by client"}</div>
            <pre tabIndex={0} aria-label={view === "prompt" ? "Agent connection prompt" : "MCP client JSON configuration"} className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-6 text-foreground/80 [overflow-wrap:anywhere]"><code>{preview}</code></pre>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{isKey ? "Copy includes your current API key. Paste it only into the agent you want to grant access." : "No API key in this prompt. Complete authorization in your agent’s browser flow."}</p>
            <CopyAction text={actual} label={view === "prompt" ? "Copy prompt" : "Copy config"} primary />
          </div>
          <div className="flex gap-3 border-t border-border/60 pt-5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">2</span><p className="text-sm leading-relaxed text-muted-foreground">Let your agent finish setup, then ask it to <span className="text-foreground">list the available WhatsApp tools</span>. A successful tool list confirms the connection before you begin.</p></div>
        </div>
      </section>
      <aside className="space-y-5">
        <ConnectionTest />
        <section className="px-1 py-2" aria-labelledby="capabilities-title">
          <h2 id="capabilities-title" className="text-sm font-medium">One connection. Useful context.</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Search, read conversations, summarize activity, and act when you ask.</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-border/60 py-4"><div><dt className="text-xs text-muted-foreground">Read tools</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{readCount}</dd></div><div><dt className="text-xs text-muted-foreground">Write tools</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{writeCount}</dd></div></dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">These labels describe tool behavior; they are not permission scopes. Both authentication methods can grant write access.</p>
        </section>
      </aside>
    </div>
    {setup.warnings.length > 0 && <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5" aria-label="Connection configuration notes"><h2 className="mb-2 text-sm font-medium text-amber-300">Check your server address</h2><ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-muted-foreground">{setup.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section>}
    <section className="grid gap-6 border-y border-border/60 py-7 lg:grid-cols-[0.8fr_1.2fr]" aria-labelledby="agent-workflow-title">
      <div><p className="mb-2 text-xs font-medium text-primary">Built for focused retrieval</p><h2 id="agent-workflow-title" className="text-xl font-semibold tracking-tight">Less context. Better answers.</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">The setup prompt teaches your agent to find the relevant slice of WhatsApp instead of loading everything.</p></div>
      <ol className="space-y-4">
        {[["Find the right conversation", "Resolve a name, inspect a short activity summary, or search with filters."], ["Read only what matters", "Pull a bounded conversation window. Expand when the task needs more evidence."], ["Act deliberately", "Verify recipients, keep message references, and check delivery before retrying a send."]].map(([title, description], index) => <li key={title} className="flex gap-3"><span className="mt-0.5 text-xs tabular-nums text-muted-foreground">0{index + 1}</span><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p></div></li>)}
      </ol>
    </section>
    <ToolCatalog tools={setup.tools} />
    <section className="space-y-3" aria-labelledby="troubleshooting-title">
      <h2 id="troubleshooting-title" className="flex items-center gap-2 text-lg font-semibold"><CircleHelp className="h-5 w-5 text-muted-foreground" />Connection help</h2>
      {[
        ["My agent cannot reach the server", "A hosted agent needs a URL reachable from its network. Localhost points to the agent’s own machine, and private network addresses need an appropriate network connection. Configure PUBLIC_BASE_URL to the reachable HTTPS address and ensure your proxy forwards /mcp and the OAuth routes."],
        ["The URL opens an error in my browser", "This server uses stateless Streamable HTTP. Opening /mcp performs GET, which returns 405 after authentication. An MCP client must POST with Accept: application/json, text/event-stream. Use the connection check above."],
        ["API key or OAuth authentication fails", "API keys belong in x-api-key. Authorization: Bearer is for OAuth access tokens, not the API key. OAuth also requires a configured PUBLIC_BASE_URL and MCP_OAUTH_PASSWORD; enter that password only on the server’s consent page."],
        ["Connected, but messages are missing", "MCP connection and WhatsApp synchronization are separate. Check Connection for your WhatsApp session and Messages for history sync. Stored history can be incomplete; an empty search does not prove a conversation never happened."],
      ].map(([title, description]) => <details key={title} className="rounded-xl border border-border/60 px-5 py-4"><summary className="cursor-pointer text-sm font-medium focus-visible:outline-primary">{title}</summary><p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p></details>)}
    </section>
  </div>
}

export function McpPage() {
  const apiKey = useAuthStore(s => s.apiKey)
  const setup = useQuery({ queryKey: ["mcp-setup"], queryFn: () => api.get<McpSetup>("/api/mcp/setup"), staleTime: 60_000 })
  return <div className="mx-auto max-w-6xl space-y-7 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-3 flex items-center gap-2 text-xs font-medium text-primary"><Plug className="h-4 w-4" />WhatsApp Hub / MCP</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Connect your AI</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">Give your agent a direct connection to your WhatsApp, with tools designed for focused, reliable work.</p></div>
      {setup.data && <div className="space-y-1 text-right"><ExportMarkdownMenu key={setup.dataUpdatedAt} filename="whatsapp-hub-agent-guide.md" getMarkdown={() => buildAgentGuide(setup.data!)} label="Export agent guide" /><p className="text-[11px] text-muted-foreground">Live tool reference · no credentials</p></div>}
    </header>
    {setup.isPending ? <div aria-label="Loading connection details" className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"><Skeleton className="h-[580px] rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div>
      : setup.isError ? <section role="alert" className="rounded-2xl border border-destructive/30 bg-card p-6"><h2 className="text-lg font-semibold">Could not load MCP connection details</h2><p className="mt-2 text-sm text-muted-foreground">Check that the backend is reachable and includes the MCP setup endpoint. Sign in again if your API key has changed.</p><Button className="mt-4" variant="outline" onClick={() => void setup.refetch()} disabled={setup.isFetching}><RefreshCw className="h-4 w-4" />Retry setup</Button></section>
      : !apiKey ? <p role="alert">Sign in again to generate your connection prompt.</p>
      : <ConnectWorkspace setup={setup.data} />}
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Terminal className="h-4 w-4" />Model Context Protocol · Streamable HTTP</span><a className="inline-flex items-center gap-1 hover:text-foreground" href="/api-docs">Explore the REST API <ArrowRight className="h-3 w-3" /></a></footer>
  </div>
}
