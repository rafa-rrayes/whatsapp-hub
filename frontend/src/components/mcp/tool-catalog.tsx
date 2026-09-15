import { useState } from "react"
import { Search, ArrowUpRight, BookOpen } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { CopyAction } from "./copy-action"
import { toolAccess, type McpTool } from "@/lib/mcp-connect"

export function ToolCatalog({ tools }: { tools: McpTool[] }) {
  const [search, setSearch] = useState("")
  const [access, setAccess] = useState("All")
  const filtered = tools.filter(tool =>
    (access === "All" || toolAccess(tool) === access) &&
    `${tool.name} ${tool.description || ""}`.toLowerCase().includes(search.toLowerCase()),
  )
  return <section aria-labelledby="tool-catalog-title" className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-primary"><BookOpen className="h-4 w-4" /><span className="text-xs font-medium">Discover</span></div>
        <h2 id="tool-catalog-title" className="text-xl font-semibold tracking-tight">Tools your agent can use</h2>
        <p className="mt-1 text-sm text-muted-foreground">Live schemas from this server. Expand a tool for its exact arguments.</p>
      </div>
      <span className="text-sm text-muted-foreground" aria-live="polite">{filtered.length} of {tools.length} tools</span>
    </div>
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-0 flex-1 basis-64">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Search tools" placeholder="Search tools or capabilities…" value={search} onChange={e => setSearch(e.target.value)} className="h-10 pl-9" />
      </div>
      <div className="flex gap-1 rounded-lg bg-muted/40 p-1" aria-label="Filter tools by access">
        {["All", "Read", "Write"].map(value => <Button key={value} size="sm" variant={access === value ? "secondary" : "ghost"} aria-pressed={access === value} onClick={() => setAccess(value)}>{value}</Button>)}
      </div>
    </div>
    <div className="divide-y divide-border/60 border-y border-border/60">
      {filtered.map(tool => <details key={tool.name} className="group">
        <summary className="flex cursor-pointer list-none items-start gap-4 rounded-sm py-5 focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="break-all font-mono text-sm font-medium">{tool.name}</h3>
              <span className={`text-[11px] ${toolAccess(tool) === "Write" ? "text-amber-400" : "text-muted-foreground"}`}>{toolAccess(tool)}</span>
            </div>
            <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-relaxed text-muted-foreground group-open:line-clamp-none">{tool.description || "No description provided."}</p>
          </div>
        </summary>
        <div className="mb-5 space-y-3 rounded-xl border border-border/60 bg-card p-4 sm:ml-8">
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs font-medium text-muted-foreground">Input schema</span><CopyAction text={JSON.stringify(tool.inputSchema, null, 2)} label="Copy schema" /></div>
          <pre className="max-h-80 overflow-auto text-xs leading-relaxed"><code>{JSON.stringify(tool.inputSchema, null, 2)}</code></pre>
        </div>
      </details>)}
      {!filtered.length && <div className="py-10 text-center"><p className="text-sm text-muted-foreground">No tools match these filters.</p><Button variant="link" onClick={() => { setSearch(""); setAccess("All") }}>Clear filters</Button></div>}
    </div>
  </section>
}
