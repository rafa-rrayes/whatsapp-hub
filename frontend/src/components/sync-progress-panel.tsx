import { useMemo } from "react"
import { useSyncProgressStore } from "@/stores/sync-progress"
import { useContactMap, resolveJid } from "@/hooks/use-contact-map"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Check, Loader2, X } from "lucide-react"
import { cn, truncate } from "@/lib/utils"

/**
 * Live progress for "Sync older chats". Driven entirely by `history.sync.*`
 * WebSocket events fed into the sync-progress store. Renders only while a sync
 * run is active; dismissed manually so the final tally stays readable.
 */
export function SyncProgressPanel() {
  const active = useSyncProgressStore((s) => s.active)
  const scope = useSyncProgressStore((s) => s.scope)
  const total = useSyncProgressStore((s) => s.total)
  const count = useSyncProgressStore((s) => s.count)
  const processed = useSyncProgressStore((s) => s.processed)
  const requested = useSyncProgressStore((s) => s.requested)
  const skipped = useSyncProgressStore((s) => s.skipped)
  const requestingDone = useSyncProgressStore((s) => s.requestingDone)
  const chats = useSyncProgressStore((s) => s.chats)
  const close = useSyncProgressStore((s) => s.close)
  const contactMap = useContactMap()

  const rows = useMemo(() => Object.values(chats), [chats])
  const chatsDone = useMemo(() => rows.filter((r) => r.done).length, [rows])
  const totalReceived = useMemo(() => rows.reduce((a, r) => a + r.received, 0), [rows])

  if (!active) return null

  const requestPct = total > 0 ? (processed / total) * 100 : 0

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {requestingDone ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <span className="text-sm font-medium">Syncing older history</span>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={close} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Requesting progress */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {requestingDone ? "Requested" : "Requesting"}{" "}
              {total > 0 ? `${processed} / ${total}` : "…"}{" "}
              {scope === "chat" ? "chat" : "chats"}
              {count ? ` · ${count} each` : ""}
            </span>
            {skipped > 0 && <span>{skipped} skipped</span>}
          </div>
          <Progress value={requestPct} indeterminate={total === 0} />
        </div>

        {/* Receiving summary */}
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {totalReceived.toLocaleString()}
          </span>{" "}
          message{totalReceived === 1 ? "" : "s"} synced
          {requested > 0 && ` · ${chatsDone} / ${requested} chats done`}
        </div>

        {/* Per-chat rows */}
        {rows.length > 0 && (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {rows.map((r) => (
              <div key={r.jid} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs">
                      {truncate(resolveJid(r.jid, contactMap), 28)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        r.done ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {r.done ? `${r.received} msg${r.received === 1 ? "" : "s"}` : "pending"}
                    </span>
                  </div>
                  <Progress className="mt-1" value={r.done ? 100 : 0} indeterminate={!r.done} />
                </div>
                {r.done ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
