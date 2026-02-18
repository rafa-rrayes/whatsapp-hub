import { useState } from "react"
import { useMessages } from "@/hooks/use-api"
import { useAuthStore } from "@/stores/auth"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { MessagesPerDayChart } from "@/components/charts/messages-per-day"
import { MessagesByTypeChart } from "@/components/charts/messages-by-type"
import { TopChatsChart } from "@/components/charts/top-chats"
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react"
import { formatTimestamp, truncate } from "@/lib/utils"
import { useContactMap, resolveJid } from "@/hooks/use-contact-map"
import type { MessageQueryParams } from "@/hooks/use-api"

export function MessagesPage() {
  const contactMap = useContactMap()
  const [params, setParams] = useState<MessageQueryParams>({
    limit: 25,
    offset: 0,
    order: "desc",
  })
  const [search, setSearch] = useState("")
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const apiKey = useAuthStore((s) => s.apiKey)

  const { data, isLoading } = useMessages({ ...params, search: search || undefined })

  const page = Math.floor((params.offset || 0) / (params.limit || 25))
  const totalPages = data ? Math.ceil(data.total / (params.limit || 25)) : 0

  function updateFilter(key: string, value: string) {
    setParams((p) => ({ ...p, [key]: value || undefined, offset: 0 }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
        <p className="text-sm text-muted-foreground">Browse and search all messages</p>
      </div>

      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-4 mt-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search messages..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </div>

                <Input
                  placeholder="Chat JID"
                  value={params.chat || ""}
                  onChange={(e) => updateFilter("chat", e.target.value)}
                  className="h-9 w-48"
                />

                <Select
                  value={params.type || "all"}
                  onValueChange={(v) => updateFilter("type", v === "all" ? "" : v)}
                >
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="audio">Audio</SelectItem>
                    <SelectItem value="document">Document</SelectItem>
                    <SelectItem value="sticker">Sticker</SelectItem>
                    <SelectItem value="reaction">Reaction</SelectItem>
                    <SelectItem value="location">Location</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={params.from_me || "all"}
                  onValueChange={(v) => updateFilter("from_me", v === "all" ? "" : v)}
                >
                  <SelectTrigger className="h-9 w-32">
                    <SelectValue placeholder="Direction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="true">Sent</SelectItem>
                    <SelectItem value="false">Received</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={params.has_media || "all"}
                  onValueChange={(v) => updateFilter("has_media", v === "all" ? "" : v)}
                >
                  <SelectTrigger className="h-9 w-32">
                    <SelectValue placeholder="Media" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="true">Has media</SelectItem>
                    <SelectItem value="false">No media</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
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
                        <TableHead className="w-40">Time</TableHead>
                        <TableHead className="w-44">Chat</TableHead>
                        <TableHead className="w-24">Type</TableHead>
                        <TableHead className="w-16">Dir</TableHead>
                        <TableHead>Content</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data?.data.map((msg) => (
                        <>
                          <TableRow
                            key={msg.id}
                            className="cursor-pointer"
                            onClick={() =>
                              setExpandedRow(expandedRow === msg.id ? null : msg.id)
                            }
                          >
                            <TableCell className="text-xs text-muted-foreground">
                              {formatTimestamp(msg.timestamp)}
                            </TableCell>
                            <TableCell className="text-xs font-mono">
                              {truncate(resolveJid(msg.remote_jid, contactMap), 24)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {msg.message_type || "—"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={msg.from_me ? "default" : "outline"}
                                className="text-xs"
                              >
                                {msg.from_me ? "out" : "in"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm max-w-xs truncate">
                              {msg.body
                                ? truncate(msg.body, 60)
                                : msg.reaction_emoji || (msg.has_media ? `[${msg.message_type}]` : "—")}
                            </TableCell>
                          </TableRow>
                          {expandedRow === msg.id && (
                            <TableRow key={`${msg.id}-detail`}>
                              <TableCell colSpan={5} className="bg-muted/30 p-4">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="space-y-1 text-sm">
                                    <p>
                                      <span className="text-muted-foreground">ID: </span>
                                      <span className="font-mono text-xs">{msg.id}</span>
                                    </p>
                                    <p>
                                      <span className="text-muted-foreground">From: </span>
                                      {resolveJid(msg.from_jid || msg.remote_jid, contactMap)}
                                    </p>
                                    {msg.participant && (
                                      <p>
                                        <span className="text-muted-foreground">Participant: </span>
                                        {resolveJid(msg.participant, contactMap)}
                                      </p>
                                    )}
                                    {msg.push_name && (
                                      <p>
                                        <span className="text-muted-foreground">Push Name: </span>
                                        {msg.push_name}
                                      </p>
                                    )}
                                    {msg.has_media === 1 && msg.media_id && (
                                      <p>
                                        <span className="text-muted-foreground">Media: </span>
                                        <a
                                          href="#"
                                          className="text-primary hover:underline"
                                          onClick={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const res = await fetch(`/api/media/${msg.media_id}/download`, { headers: { 'x-api-key': apiKey } });
                                            const blob = await res.blob();
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a'); a.href = url; a.download = msg.media_filename || 'download'; a.click();
                                            URL.revokeObjectURL(url);
                                          }}
                                        >
                                          Download ({msg.media_mime_type})
                                        </a>
                                      </p>
                                    )}
                                  </div>
                                  {msg.raw_message && (
                                    <JsonViewer data={msg.raw_message} />
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      ))}
                      {data?.data.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                            No messages found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <span className="text-xs text-muted-foreground">
                      {data?.total.toLocaleString()} total messages
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Page {page + 1} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="icon-xs"
                        disabled={page === 0}
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            offset: ((p.offset || 0) - (p.limit || 25)),
                          }))
                        }
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-xs"
                        disabled={page + 1 >= totalPages}
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            offset: ((p.offset || 0) + (p.limit || 25)),
                          }))
                        }
                      >
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="space-y-4 mt-4">
          <MessagesPerDayChart />
          <div className="grid gap-4 lg:grid-cols-2">
            <MessagesByTypeChart />
            <TopChatsChart />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
