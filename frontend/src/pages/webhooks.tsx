import { useState } from "react"
import { useWebhooks, useCreateWebhook, useDeleteWebhook, useToggleWebhook } from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Trash2, Loader2, ChevronsUpDown, Check } from "lucide-react"
import { formatDatetime } from "@/lib/utils"
import { toast } from "sonner"

const WEBHOOK_EVENTS = [
  { value: "wa.messages.upsert", label: "Messages received" },
  { value: "wa.messages.update", label: "Messages updated" },
  { value: "wa.messages.delete", label: "Messages deleted" },
  { value: "wa.message-receipt.update", label: "Read receipts" },
  { value: "wa.presence.update", label: "Presence updates" },
  { value: "wa.contacts.upsert", label: "Contacts added" },
  { value: "wa.contacts.update", label: "Contacts updated" },
  { value: "wa.chats.upsert", label: "Chats added" },
  { value: "wa.chats.update", label: "Chats updated" },
  { value: "wa.groups.upsert", label: "Groups added" },
  { value: "wa.groups.update", label: "Groups updated" },
  { value: "wa.group-participants.update", label: "Group participants changed" },
  { value: "wa.call", label: "Calls" },
  { value: "wa.messaging-history.set", label: "History sync" },
  { value: "message.received", label: "Message processed" },
  { value: "message.edited", label: "Message edited" },
  { value: "message.deleted", label: "Message deleted" },
] as const

function EventPicker({
  selected,
  onChange,
}: {
  selected: Set<string>
  onChange: (selected: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const allSelected = selected.size === 0

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) {
      next.delete(value)
    } else {
      next.add(value)
    }
    onChange(next)
  }

  function selectAll() {
    onChange(new Set())
  }

  const label = allSelected
    ? "All events"
    : selected.size === 1
      ? WEBHOOK_EVENTS.find((e) => e.value === [...selected][0])?.label ?? [...selected][0]
      : `${selected.size} events`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between font-normal"
        >
          <span className="truncate text-sm">{label}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="max-h-64 overflow-y-auto p-1">
          <button
            type="button"
            onClick={selectAll}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          >
            <div className="flex h-4 w-4 items-center justify-center">
              {allSelected && <Check className="h-3.5 w-3.5" />}
            </div>
            <span className="font-medium">All events</span>
          </button>
          <div className="my-1 h-px bg-border" />
          {WEBHOOK_EVENTS.map((event) => (
            <button
              key={event.value}
              type="button"
              onClick={() => toggle(event.value)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            >
              <div className="flex h-4 w-4 items-center justify-center">
                {(allSelected || selected.has(event.value)) && (
                  <Check className="h-3.5 w-3.5" />
                )}
              </div>
              <div className="min-w-0 text-left">
                <div className="truncate">{event.label}</div>
                <div className="truncate text-xs text-muted-foreground font-mono">
                  {event.value}
                </div>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function WebhooksPage() {
  const { data, isLoading } = useWebhooks()
  const createWebhook = useCreateWebhook()
  const deleteWebhook = useDeleteWebhook()
  const toggleWebhook = useToggleWebhook()

  const [url, setUrl] = useState("")
  const [secret, setSecret] = useState("")
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set())

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return

    const events = selectedEvents.size === 0 ? "*" : [...selectedEvents].join(",")

    createWebhook.mutate(
      { url: url.trim(), secret: secret.trim() || undefined, events },
      {
        onSuccess: () => {
          toast.success("Webhook created")
          setUrl("")
          setSecret("")
          setSelectedEvents(new Set())
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  function handleDelete(id: string) {
    deleteWebhook.mutate(id, {
      onSuccess: () => toast.success("Webhook deleted"),
      onError: (e) => toast.error(e.message),
    })
  }

  function handleToggle(id: string) {
    toggleWebhook.mutate(id, {
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-sm text-muted-foreground">Manage webhook subscriptions</p>
      </div>

      {/* Create Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Create Webhook</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label className="text-xs">URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="h-9"
                required
              />
            </div>
            <div className="w-40 space-y-1.5">
              <Label className="text-xs">Secret (optional)</Label>
              <Input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="hmac-secret"
                className="h-9"
              />
            </div>
            <div className="w-56 space-y-1.5">
              <Label className="text-xs">Events</Label>
              <EventPicker selected={selectedEvents} onChange={setSelectedEvents} />
            </div>
            <Button type="submit" size="sm" disabled={createWebhook.isPending}>
              {createWebhook.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Webhooks List */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead className="w-36">Events</TableHead>
                  <TableHead className="w-28">Created</TableHead>
                  <TableHead className="w-20">Active</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data.map((wh) => (
                  <TableRow key={wh.id}>
                    <TableCell className="text-sm font-mono max-w-xs truncate">
                      {wh.url}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {wh.events === "*" ? (
                          <Badge variant="secondary" className="text-xs font-mono">
                            all
                          </Badge>
                        ) : (
                          wh.events.split(",").map((ev) => (
                            <Badge key={ev} variant="secondary" className="text-xs font-mono">
                              {ev.trim()}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDatetime(wh.created_at)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={wh.is_active === 1}
                        onCheckedChange={() => handleToggle(wh.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleDelete(wh.id)}
                        disabled={deleteWebhook.isPending}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {data?.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No webhooks configured
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
