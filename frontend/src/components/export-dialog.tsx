import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Download, Loader2 } from "lucide-react"
import { useAuthStore } from "@/stores/auth"
import { toast } from "sonner"

type Format = "md" | "txt" | "json" | "zip"
type Preset = "concise" | "full" | "llm" | "archive"
type ChatScope = "all" | "groups_only" | "dms_only"
type Reactions = "inline" | "separate" | "omit"
type DateGrouping = "none" | "day" | "hour"
type Media = "none" | "ref" | "embed" | "attach"
type SortChats = "recent" | "volume" | "name"

const DEFAULT_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
})()

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)
  return match ? decodeURIComponent(match[1]) : null
}

function extensionForFormat(format: Format): string {
  return format
}

interface ExportDialogProps {
  trigger?: React.ReactNode
}

export function ExportDialog({ trigger }: ExportDialogProps) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="default">
            <Download className="h-4 w-4" />
            Export
          </Button>
        )}
      </DialogTrigger>
      {open && <ExportDialogContent onClose={() => setOpen(false)} />}
    </Dialog>
  )
}

function ExportDialogContent({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState<Format>("md")
  const [preset, setPreset] = useState<Preset>("full")
  const [days, setDays] = useState<number>(15)
  const [timezone, setTimezone] = useState<string>(DEFAULT_TZ)
  const [chatScope, setChatScope] = useState<ChatScope>("all")
  const [reactions, setReactions] = useState<Reactions>("inline")
  const [dateGrouping, setDateGrouping] = useState<DateGrouping>("day")
  const [media, setMedia] = useState<Media>("none")
  const [sortChatsBy, setSortChatsBy] = useState<SortChats>("recent")
  const [minMessages, setMinMessages] = useState<number>(0)
  const [includeArchived, setIncludeArchived] = useState<boolean>(false)
  const [includeMuted, setIncludeMuted] = useState<boolean>(true)
  const [unreadOnly, setUnreadOnly] = useState<boolean>(false)
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false)
  const [redactPhones, setRedactPhones] = useState<boolean>(false)
  const [anonymizeJids, setAnonymizeJids] = useState<boolean>(false)
  const [stripQuoted, setStripQuoted] = useState<boolean>(false)
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false)
  const [downloading, setDownloading] = useState<boolean>(false)

  // zip needs media=attach. If user picks zip, force media to attach.
  const effectiveMedia = format === "zip" && media === "none" ? "attach" : media

  async function handleDownload() {
    if (downloading) return

    const body: Record<string, unknown> = {
      days,
      format,
      preset,
      timezone,
      reactions,
      date_grouping: dateGrouping,
      media: effectiveMedia,
      sort_chats_by: sortChatsBy,
      min_messages: minMessages,
      include_archived: includeArchived,
      include_muted: includeMuted,
      unread_only: unreadOnly,
      include_deleted: includeDeleted,
      redact_phone_numbers: redactPhones,
      anonymize_jids: anonymizeJids,
      strip_quoted_bodies: stripQuoted,
    }

    if (chatScope === "groups_only") body.groups_only = true
    if (chatScope === "dms_only") body.dms_only = true

    const apiKey = useAuthStore.getState().apiKey

    setDownloading(true)
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(errBody.error || errBody.message || `HTTP ${res.status}`)
      }

      const blob = await res.blob()
      const filename =
        filenameFromContentDisposition(res.headers.get("Content-Disposition")) ??
        `whatsapp-export.${extensionForFormat(format)}`

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      toast.success(`Downloaded ${filename}`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Export conversations</DialogTitle>
        <DialogDescription>
          Configure what to include and how to render. Rate limited to 5 exports per minute.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="format">Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
              <SelectTrigger id="format" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="md">Markdown (.md)</SelectItem>
                <SelectItem value="txt">Plain text (.txt)</SelectItem>
                <SelectItem value="json">JSON (.json)</SelectItem>
                <SelectItem value="zip">Zip with media (.zip)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="preset">Preset</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
              <SelectTrigger id="preset" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="concise">Concise (timestamp + sender + body)</SelectItem>
                <SelectItem value="full">Full (all fields)</SelectItem>
                <SelectItem value="llm">LLM-friendly</SelectItem>
                <SelectItem value="archive">Archive (everything)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="days">Last N days</Label>
            <Input
              id="days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/Sao_Paulo"
              className="h-9"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="chat-scope">Chat scope</Label>
            <Select value={chatScope} onValueChange={(v) => setChatScope(v as ChatScope)}>
              <SelectTrigger id="chat-scope" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All chats</SelectItem>
                <SelectItem value="groups_only">Groups only</SelectItem>
                <SelectItem value="dms_only">DMs only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sort">Sort chats by</Label>
            <Select value={sortChatsBy} onValueChange={(v) => setSortChatsBy(v as SortChats)}>
              <SelectTrigger id="sort" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Most recent</SelectItem>
                <SelectItem value="volume">Most messages</SelectItem>
                <SelectItem value="name">Name (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="reactions">Reactions</Label>
            <Select value={reactions} onValueChange={(v) => setReactions(v as Reactions)}>
              <SelectTrigger id="reactions" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inline">Inline</SelectItem>
                <SelectItem value="separate">Separate</SelectItem>
                <SelectItem value="omit">Omit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="date-grouping">Date grouping</Label>
            <Select value={dateGrouping} onValueChange={(v) => setDateGrouping(v as DateGrouping)}>
              <SelectTrigger id="date-grouping" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="hour">Hour</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="media">Media</Label>
            <Select value={effectiveMedia} onValueChange={(v) => setMedia(v as Media)} disabled={format === "zip"}>
              <SelectTrigger id="media" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (placeholders)</SelectItem>
                <SelectItem value="ref">Reference URLs</SelectItem>
                <SelectItem value="embed">Embed (base64)</SelectItem>
                <SelectItem value="attach">Attach to zip</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {advancedOpen ? "▼ Hide" : "▶ Show"} advanced options
        </button>

        {advancedOpen && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="min-messages">Minimum messages per chat</Label>
              <Input
                id="min-messages"
                type="number"
                min={0}
                value={minMessages}
                onChange={(e) => setMinMessages(Math.max(0, Number(e.target.value) || 0))}
                className="h-9"
              />
            </div>

            <div className="space-y-2 pt-2">
              <ToggleRow
                label="Include archived chats"
                checked={includeArchived}
                onCheckedChange={setIncludeArchived}
              />
              <ToggleRow
                label="Include muted chats"
                checked={includeMuted}
                onCheckedChange={setIncludeMuted}
              />
              <ToggleRow
                label="Unread chats only"
                checked={unreadOnly}
                onCheckedChange={setUnreadOnly}
              />
              <ToggleRow
                label="Include deleted messages"
                checked={includeDeleted}
                onCheckedChange={setIncludeDeleted}
              />
            </div>

            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Privacy</p>
              <div className="space-y-2">
                <ToggleRow
                  label="Redact phone numbers"
                  description="Replace digits in message bodies with •"
                  checked={redactPhones}
                  onCheckedChange={setRedactPhones}
                />
                <ToggleRow
                  label="Anonymize JIDs"
                  description="Hash JIDs to opaque IDs throughout"
                  checked={anonymizeJids}
                  onCheckedChange={setAnonymizeJids}
                />
                <ToggleRow
                  label="Strip quoted reply bodies"
                  checked={stripQuoted}
                  onCheckedChange={setStripQuoted}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={downloading}>
          Cancel
        </Button>
        <Button onClick={handleDownload} disabled={downloading}>
          {downloading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Download
            </>
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="text-sm">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
