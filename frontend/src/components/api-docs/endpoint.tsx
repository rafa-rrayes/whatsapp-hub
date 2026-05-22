import { useState, useCallback } from "react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Copy, Check, ChevronRight } from "lucide-react"

// ---------------------------------------------------------------------------
// Shared types + presentational primitives for the API Docs and MCP pages.
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "WS" | "TOOL"

export interface Param {
  name: string
  type: string
  required?: boolean
  description: string
  default?: string
}

export interface Endpoint {
  method: HttpMethod
  path: string
  description: string
  params?: Param[]
  body?: Param[]
  response?: string
  curl?: string
  notes?: string
}

export interface EndpointGroup {
  id: string
  title: string
  description: string
  prefix: string
  endpoints: Endpoint[]
}

export const METHOD_STYLES: Record<HttpMethod, { bg: string; text: string; border: string }> = {
  GET: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  POST: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  PUT: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  DELETE: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
  WS: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
  TOOL: { bg: "bg-teal-500/10", text: "text-teal-400", border: "border-teal-500/20" },
}

export function MethodBadge({ method }: { method: HttpMethod }) {
  const style = METHOD_STYLES[method]
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-wider font-mono shrink-0 w-16 text-center",
        style.bg,
        style.text,
        style.border
      )}
    >
      {method}
    </span>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="relative group">
      {label && (
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1.5">
          {label}
        </div>
      )}
      <div className="relative rounded-lg bg-[hsl(var(--muted)/0.4)] border border-border/50 overflow-hidden">
        <CopyButton text={code} />
        <pre className="p-3 pr-10 text-[12.5px] leading-relaxed font-mono text-foreground/80 overflow-x-auto">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}

export function ParamsTable({ params, label }: { params: Param[]; label: string }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
        {label}
      </div>
      <div className="rounded-lg border border-border/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name</th>
              <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Type</th>
              <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Required</th>
              <th className="py-2 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Description</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name} className="border-b border-border/30 last:border-0">
                <td className="py-2 px-3 font-mono text-xs text-foreground/90">{p.name}</td>
                <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{p.type}</td>
                <td className="py-2 px-3 hidden sm:table-cell">
                  {p.required ? (
                    <span className="text-[10px] font-medium text-amber-400">required</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/50">optional</span>
                  )}
                </td>
                <td className="py-2 px-3 text-xs text-muted-foreground">
                  {p.description}
                  {p.default && (
                    <span className="ml-1.5 text-muted-foreground/50">
                      (default: <code className="text-foreground/60">{p.default}</code>)
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function EndpointCard({ endpoint, isLast }: { endpoint: Endpoint; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = endpoint.params || endpoint.body || endpoint.response || endpoint.curl

  return (
    <div className={cn(!isLast && "border-b border-border/30")}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={cn(
          "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors",
          hasDetails && "hover:bg-muted/30 cursor-pointer",
          !hasDetails && "cursor-default"
        )}
      >
        <MethodBadge method={endpoint.method} />
        <div className="flex-1 min-w-0">
          <code className="text-[13px] font-mono text-foreground/90">{endpoint.path}</code>
          <p className="text-xs text-muted-foreground mt-0.5">{endpoint.description}</p>
        </div>
        {hasDetails && (
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform mt-0.5",
              expanded && "rotate-90"
            )}
          />
        )}
      </button>

      {expanded && hasDetails && (
        <div className="px-4 pb-4 ml-[76px] space-y-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          {endpoint.notes && (
            <p className="text-xs text-muted-foreground italic border-l-2 border-amber-500/40 pl-3">
              {endpoint.notes}
            </p>
          )}

          {endpoint.params && <ParamsTable params={endpoint.params} label="Parameters" />}
          {endpoint.body && <ParamsTable params={endpoint.body} label="Request Body (JSON)" />}

          {endpoint.curl && <CodeBlock code={endpoint.curl} label="Example Request" />}
          {endpoint.response && <CodeBlock code={endpoint.response} label="Example Response" />}
        </div>
      )}
    </div>
  )
}
