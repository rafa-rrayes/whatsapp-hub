import { useWebSocketStore } from "@/stores/websocket"
import { cn } from "@/lib/utils"
import { Radio, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ActivityBar() {
  const status = useWebSocketStore((s) => s.status)
  const eventCount = useWebSocketStore((s) => s.eventCount)
  const paused = useWebSocketStore((s) => s.paused)
  const togglePaused = useWebSocketStore((s) => s.togglePaused)

  const statusColor = {
    connected: "text-emerald-400",
    connecting: "text-amber-400",
    disconnected: "text-muted-foreground",
    error: "text-destructive",
  }[status]

  const statusDot = {
    connected: "bg-emerald-400",
    connecting: "bg-amber-400 animate-pulse",
    disconnected: "bg-muted-foreground",
    error: "bg-destructive",
  }[status]

  return (
    <div className="flex h-7 items-center justify-between border-t border-border/50 bg-sidebar px-3 text-xs">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
          <span className={cn(statusColor)}>WS {status}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Radio className="h-3 w-3" />
          <span>{eventCount} events</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={togglePaused}
        className="text-muted-foreground hover:text-foreground"
      >
        {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
      </Button>
    </div>
  )
}
