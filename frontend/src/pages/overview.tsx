import { ConnectionCard } from "@/components/connection-card"
import { StatsCards } from "@/components/stats-cards"
import { MessagesPerDayChart } from "@/components/charts/messages-per-day"
import { MessagesByTypeChart } from "@/components/charts/messages-by-type"
import { TopChatsChart } from "@/components/charts/top-chats"
import { useWebSocketStore } from "@/stores/websocket"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Trash2 } from "lucide-react"
import { formatDatetime } from "@/lib/utils"

export function OverviewPage() {
  const recentEvents = useWebSocketStore((s) => s.recentEvents)
  const clearEvents = useWebSocketStore((s) => s.clearEvents)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">WhatsApp Hub dashboard</p>
      </div>

      <StatsCards />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MessagesPerDayChart />
        </div>
        <ConnectionCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MessagesByTypeChart />
        <TopChatsChart />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Live Events</CardTitle>
            {recentEvents.length > 0 && (
              <Button variant="ghost" size="xs" onClick={clearEvents}>
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No events yet. Events will appear here in real-time.
            </p>
          ) : (
            <ScrollArea className="h-64">
              <div className="space-y-1.5">
                {recentEvents.slice(0, 20).map((event, i) => (
                  <div
                    key={`${event.timestamp}-${i}`}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <Badge variant="secondary" className="text-xs font-mono shrink-0">
                      {event.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDatetime(new Date(event.timestamp).toISOString())}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
