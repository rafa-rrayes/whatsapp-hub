import { useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronRight, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

interface JsonViewerProps {
  data: unknown
  collapsed?: boolean
  className?: string
}

export function JsonViewer({ data, collapsed = true, className }: JsonViewerProps) {
  const [isExpanded, setIsExpanded] = useState(!collapsed)
  const [copied, setCopied] = useState(false)

  const jsonStr = typeof data === "string" ? data : JSON.stringify(data, null, 2)
  let parsed: unknown
  try {
    parsed = typeof data === "string" ? JSON.parse(data) : data
  } catch {
    parsed = data
  }

  function handleCopy() {
    navigator.clipboard.writeText(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!data) return <span className="text-muted-foreground text-xs">null</span>

  return (
    <div className={cn("relative group", className)}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-90")}
          />
          {isExpanded ? "Collapse" : "Expand JSON"}
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      {isExpanded && (
        <pre className="mt-1 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed max-h-80">
          {jsonStr}
        </pre>
      )}
    </div>
  )
}
