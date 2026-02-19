import { useState } from "react"
import { useEvents, useEventTypes, usePruneEvents } from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { JsonViewer } from "@/components/json-viewer"
import { ChevronLeft, ChevronRight, Trash2, Loader2 } from "lucide-react"
import { formatDatetime } from "@/lib/utils"
import { toast } from "sonner"

export function EventsPage() {
  const [typeFilter, setTypeFilter] = useState("")
  const [offset, setOffset] = useState(0)
  const [pruneDays, setPruneDays] = useState("30")
  const limit = 50

  const { data: types } = useEventTypes()
  const { data, isLoading } = useEvents({
    type: typeFilter || undefined,
    limit,
    offset,
  })
  const pruneEvents = usePruneEvents()

  const page = Math.floor(offset / limit)
  const hasMore = (data?.data.length || 0) >= limit

  function handlePrune() {
    const days = parseInt(pruneDays)
    if (isNaN(days) || days < 1) return
    pruneEvents.mutate(days, {
      onSuccess: (result) => {
        toast.success(`Pruned ${result.deleted} events`)
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="text-sm text-muted-foreground">Event audit log</p>
      </div>

      {/* Type Summary */}
      {types?.data && types.data.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Event Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={typeFilter === "" ? "default" : "outline"}
                className="cursor-pointer text-xs"
                onClick={() => { setTypeFilter(""); setOffset(0) }}
              >
                All
              </Badge>
              {types.data.map((t) => (
                <Badge
                  key={t.event_type}
                  variant={typeFilter === t.event_type ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => { setTypeFilter(t.event_type); setOffset(0) }}
                >
                  {t.event_type}
                  <span className="ml-1 opacity-60">{t.count}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Prune */}
      <div className="flex items-center gap-3">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
              Prune Events
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Prune Old Events</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm">Delete events older than (days):</label>
                <Input
                  type="number"
                  value={pruneDays}
                  onChange={(e) => setPruneDays(e.target.value)}
                  min="1"
                  className="h-9"
                />
              </div>
              <Button
                onClick={handlePrune}
                disabled={pruneEvents.isPending}
                variant="destructive"
                className="w-full"
              >
                {pruneEvents.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Prune
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Events Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead className="w-44">Type</TableHead>
                    <TableHead className="w-44">Time</TableHead>
                    <TableHead>Payload</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {event.id}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs font-mono">
                          {event.event_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDatetime(event.logged_at)}
                      </TableCell>
                      <TableCell>
                        {event.payload && <JsonViewer data={event.payload} />}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data?.data.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No events found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <div className="flex items-center justify-end border-t px-4 py-3 gap-2">
                <span className="text-xs text-muted-foreground mr-2">Page {page + 1}</span>
                <Button
                  variant="outline"
                  size="icon-xs"
                  disabled={page === 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <Button
                  variant="outline"
                  size="icon-xs"
                  disabled={!hasMore}
                  onClick={() => setOffset(offset + limit)}
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
