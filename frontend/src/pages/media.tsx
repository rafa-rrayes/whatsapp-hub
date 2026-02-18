import { useState } from "react"
import { useMediaStats, useMessages } from "@/hooks/use-api"
import { useAuthStore } from "@/stores/auth"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { ChevronLeft, ChevronRight, Download, Image } from "lucide-react"
import { formatBytes, formatTimestamp } from "@/lib/utils"
import { useContactMap, resolveJid } from "@/hooks/use-contact-map"

const COLORS = [
  "oklch(0.67 0.17 162)",
  "oklch(0.6 0.15 200)",
  "oklch(0.55 0.15 250)",
  "oklch(0.65 0.18 80)",
  "oklch(0.55 0.2 27)",
  "oklch(0.7 0.12 300)",
]

export function MediaPage() {
  const { data: stats, isLoading: statsLoading } = useMediaStats()
  const apiKey = useAuthStore((s) => s.apiKey)
  const contactMap = useContactMap()
  const [mediaType, setMediaType] = useState<string>("")
  const [offset, setOffset] = useState(0)
  const limit = 25

  const { data: messages, isLoading: msgsLoading } = useMessages({
    has_media: "true",
    type: mediaType || undefined,
    limit,
    offset,
    order: "desc",
  })

  const page = Math.floor(offset / limit)
  const totalPages = messages ? Math.ceil(messages.total / limit) : 0

  const typeChartData = (stats?.byType || []).slice(0, 6).map((d) => ({
    name: d.mime_type?.split("/")[0] || "unknown",
    value: d.count,
  }))

  // Merge duplicate type categories
  const mergedChart: Record<string, number> = {}
  typeChartData.forEach((d) => {
    mergedChart[d.name] = (mergedChart[d.name] || 0) + d.value
  })
  const finalChartData = Object.entries(mergedChart).map(([name, value]) => ({ name, value }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Media</h1>
        <p className="text-sm text-muted-foreground">Browse and download media files</p>
      </div>

      {/* Stats */}
      {statsLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-16 mb-2" />
                <Skeleton className="h-7 w-12" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Total</span>
                <Image className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="text-xl font-semibold">{stats.total.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Downloaded</span>
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="text-xl font-semibold">{stats.downloaded.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Pending</div>
              <div className="text-xl font-semibold">{stats.pending.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Total Size</div>
              <div className="text-xl font-semibold">{formatBytes(stats.totalSize)}</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Type Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Media by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={finalChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {finalChartData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.17 0 0)",
                      border: "1px solid oklch(0.3 0 0)",
                      borderRadius: "8px",
                      fontSize: 12,
                      color: "oklch(0.985 0 0)",
                    }}
                  />
                  <Legend
                    formatter={(value) => (
                      <span style={{ color: "oklch(0.65 0 0)", fontSize: 11 }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Filter */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Browse Media</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={mediaType || "all"} onValueChange={(v) => { setMediaType(v === "all" ? "" : v); setOffset(0) }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="document">Document</SelectItem>
                <SelectItem value="sticker">Sticker</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      {/* Media Table */}
      <Card>
        <CardContent className="p-0">
          {msgsLoading ? (
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
                    <TableHead className="w-40">Time</TableHead>
                    <TableHead className="w-40">Chat</TableHead>
                    <TableHead className="w-24">Type</TableHead>
                    <TableHead className="w-28">MIME</TableHead>
                    <TableHead className="w-24">Size</TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages?.data.map((msg) => (
                    <TableRow key={msg.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTimestamp(msg.timestamp)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[160px]">
                        {resolveJid(msg.remote_jid, contactMap)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {msg.message_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {msg.media_mime_type || "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {msg.media_size ? formatBytes(msg.media_size) : "—"}
                      </TableCell>
                      <TableCell className="text-xs truncate max-w-[200px]">
                        {msg.media_filename || "—"}
                      </TableCell>
                      <TableCell>
                        {msg.media_id && (
                          <Button variant="ghost" size="icon-xs" onClick={async (e) => {
                            e.preventDefault();
                            const res = await fetch(`/api/media/${msg.media_id}/download`, { headers: { 'x-api-key': apiKey } });
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a'); a.href = url; a.download = msg.media_filename || 'download'; a.click();
                            URL.revokeObjectURL(url);
                          }}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {messages?.data.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No media found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between border-t px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  {messages?.total.toLocaleString()} media messages
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
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
                    disabled={page + 1 >= totalPages}
                    onClick={() => setOffset(offset + limit)}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
