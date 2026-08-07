import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronDown, Forward, Ban, AlertCircle, MapPin, User } from "lucide-react"
import { toast } from "sonner"
import type { Message } from "@/lib/types"
import { useDeviceStore } from "@/stores/device"
import {
  deviceMessagesKey,
  type ConversationItem,
  type DeviceMessage,
  isTempId,
} from "@/hooks/use-device-messages"
import { sendReaction, retrySendText, type OptimisticMessage } from "@/hooks/use-send-message"
import { getMediaBlobUrl } from "@/hooks/use-media-blob"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { TailOut, TailIn } from "./icons"
import { MessageTicks } from "./message-ticks"
import { ReactionPicker } from "./reaction-picker"
import { ImageAttachment } from "./media/image-attachment"
import { VideoAttachment } from "./media/video-attachment"
import { AudioPlayer } from "./media/audio-player"
import { AudioTranscription } from "./media/audio-transcription"
import { DocumentTile } from "./media/document-tile"
import { StickerAttachment } from "./media/sticker-attachment"
import { formatBubbleTime, linkify, senderColor, displayName } from "./format"
import { cn } from "@/lib/utils"

type MessageItem = Extract<ConversationItem, { kind: "message" }>

function LinkifiedText({ text }: { text: string }) {
  const parts = linkify(text)
  return (
    <>
      {parts.map((p, i) =>
        p.type === "link" ? (
          <a
            key={i}
            href={p.value}
            target="_blank"
            rel="noreferrer"
            className="break-all text-wa-blue underline"
          >
            {p.value}
          </a>
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </>
  )
}

function QuotedBlock({ chatJid, message }: { chatJid: string; message: DeviceMessage }) {
  const qc = useQueryClient()
  // Best-effort sender resolution from the already-loaded pages.
  const data = qc.getQueryData<{ pages: Array<{ data: Message[] }> }>(deviceMessagesKey(chatJid))
  const quoted = data?.pages.flatMap((p) => p.data).find((m) => m.id === message.quoted_id)
  const label = quoted
    ? quoted.from_me
      ? "You"
      : displayName(quoted.push_name, quoted.participant || quoted.from_jid || chatJid)
    : "Quoted"
  const color = quoted && !quoted.from_me ? senderColor(quoted.participant || quoted.from_jid || chatJid) : "#00a884"

  return (
    <div
      className="mb-1 flex overflow-hidden rounded-md bg-black/20"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="min-w-0 px-2.5 py-1.5">
        <div className="text-[12.5px] font-medium" style={{ color }}>
          {label}
        </div>
        <div className="truncate text-[13px] text-wa-text-muted">
          {message.quoted_body || "Media message"}
        </div>
      </div>
    </div>
  )
}

function MediaContent({ message }: { message: OptimisticMessage }) {
  // Optimistic local preview before the server row lands.
  if (message._localUrl) {
    if (message.message_type === "image") {
      return (
        <img src={message._localUrl} alt="" className="max-h-[440px] max-w-[330px] rounded-md object-cover" />
      )
    }
    if (message.message_type === "video") {
      return <video src={message._localUrl} controls className="max-w-[330px] rounded-md" />
    }
  }
  switch (message.message_type) {
    case "image":
      return <ImageAttachment message={message} />
    case "video":
      return <VideoAttachment message={message} />
    case "audio":
    case "ptt":
      return <AudioPlayer message={message} />
    case "document":
      return <DocumentTile message={message} />
    default:
      return null
  }
}

export function MessageBubble({ item, chatJid, isGroup }: { item: MessageItem; chatJid: string; isGroup: boolean }) {
  const qc = useQueryClient()
  const setReplyTo = useDeviceStore((s) => s.setReplyTo)
  const [pickerOpen, setPickerOpen] = useState(false)
  const m = item.message as OptimisticMessage
  const out = m.from_me
  const temp = isTempId(m.id)

  // Stickers render without a bubble.
  if (m.message_type === "sticker") {
    return (
      <div className={cn("flex px-[5%] md:px-[8%]", out ? "justify-end" : "justify-start", item.firstOfGroup ? "mt-3" : "mt-0.5")}>
        <div className="flex flex-col items-end gap-0.5">
          <StickerAttachment message={m} />
          <span className="flex items-center gap-1 text-[11px] text-wa-text-muted">
            {formatBubbleTime(m.timestamp)}
            {out && <MessageTicks status={temp ? "pending" : m.receipt_status ?? "sent"} />}
          </span>
        </div>
      </div>
    )
  }

  const react = (emoji: string) => sendReaction(qc, chatJid, m.id, emoji)
  const copy = () => {
    const text = m.body || m.media_transcription
    if (text) {
      navigator.clipboard.writeText(text)
      toast.success("Copied")
    }
  }
  const download = async () => {
    if (!m.media_id) return
    const url = await getMediaBlobUrl(m.media_id)
    if (!url) {
      toast.error("Media not available")
      return
    }
    const a = document.createElement("a")
    a.href = url
    a.download = m.media_filename || m.media_id
    a.click()
  }

  const senderJid = m.participant || m.from_jid || chatJid
  const showSender = isGroup && !out && item.firstOfGroup
  const hasMediaBody = ["image", "video", "audio", "ptt", "document"].includes(m.message_type ?? "")
  const hasTranscriptionPanel = ["audio", "ptt"].includes(m.message_type ?? "")
    && Boolean(m.media_transcription || m.media_transcription_status)
  const hasBubbleText = Boolean(m.body || hasTranscriptionPanel)

  return (
    <div
      className={cn(
        "group/bubble flex px-[5%] md:px-[8%]",
        out ? "justify-end" : "justify-start",
        item.firstOfGroup ? "mt-3" : "mt-0.5",
        item.reactions?.length ? "mb-3" : undefined
      )}
    >
      <div
        className={cn(
          "relative max-w-[65%] rounded-[7.5px] text-[14.2px] leading-[19px] text-wa-text shadow-[0_1px_.5px_rgba(11,20,26,0.13)]",
          out ? "bg-wa-bubble-out" : "bg-wa-bubble-in",
          item.firstOfGroup && (out ? "rounded-tr-none" : "rounded-tl-none"),
          hasMediaBody && !m.is_deleted ? "p-[3px]" : "py-1.5 pl-[9px] pr-[7px]"
        )}
      >
        {item.firstOfGroup && (
          <span className={cn("absolute top-0", out ? "-right-2 text-wa-bubble-out" : "-left-2 text-wa-bubble-in")}>
            {out ? <TailOut /> : <TailIn />}
          </span>
        )}

        {/* Hover actions */}
        {!temp && !m.is_deleted && (
          <div
            className={cn(
              "absolute right-1 top-1 z-10 flex items-center rounded-full opacity-0 transition-opacity group-hover/bubble:opacity-100",
              out ? "bg-wa-bubble-out" : "bg-wa-bubble-in"
            )}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-0.5 text-wa-icon hover:text-wa-text">
                  <ChevronDown className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-none bg-wa-dropdown text-wa-text-strong">
                <DropdownMenuItem
                  className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
                  onClick={() => setPickerOpen(true)}
                >
                  React
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
                  onClick={() => setReplyTo(m)}
                >
                  Reply
                </DropdownMenuItem>
                {(m.body || m.media_transcription) && (
                  <DropdownMenuItem
                    className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
                    onClick={copy}
                  >
                    Copy
                  </DropdownMenuItem>
                )}
                {m.has_media && m.media_id && (
                  <DropdownMenuItem
                    className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
                    onClick={download}
                  >
                    Download
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <ReactionPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={react}>
          {/* Anchor for the reaction popover */}
          <span className="absolute left-1/2 top-0" />
        </ReactionPicker>

        <div className={cn(hasMediaBody && !m.is_deleted && "flex flex-col")}>
          {showSender && (
            <div
              className={cn("text-[12.8px] font-medium", hasMediaBody && "px-1.5 pt-1")}
              style={{ color: senderColor(senderJid) }}
            >
              {displayName(m.push_name, senderJid)}
            </div>
          )}

          {m.is_forwarded && !m.is_deleted && (
            <div className={cn("flex items-center gap-1 text-[12.5px] italic text-wa-text-muted", hasMediaBody && "px-1.5 pt-0.5")}>
              <Forward className="h-3.5 w-3.5" /> Forwarded
            </div>
          )}

          {m.quoted_id && !m.is_deleted && <QuotedBlock chatJid={chatJid} message={m} />}

          {m.is_deleted ? (
            <div className="flex items-center gap-1.5 italic text-wa-text-muted">
              <Ban className="h-4 w-4" /> This message was deleted
            </div>
          ) : (
            <>
              <MediaContent message={m} />
              <AudioTranscription message={m} />

              {m.message_type === "location" && (
                <a
                  className="flex items-center gap-2 text-wa-blue underline"
                  href={`https://maps.google.com/?q=${m.latitude},${m.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="h-5 w-5" />
                  {m.location_name || m.location_address || "Location"}
                </a>
              )}

              {m.message_type === "contact" && (
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5 text-wa-icon" />
                  {m.body || "Contact"}
                </div>
              )}

              {m.body && !["location", "contact"].includes(m.message_type ?? "") && (
                <div className={cn("whitespace-pre-wrap break-words", hasMediaBody && "px-1.5 pt-1")}>
                  <LinkifiedText text={m.body} />
                  {/* spacer so the floated meta never overlaps the last line */}
                  <span className="inline-block w-[74px]" />
                </div>
              )}
            </>
          )}

          {/* Meta row */}
          <span
            className={cn(
              "pointer-events-none absolute bottom-[3px] right-[7px] flex items-center gap-1 text-[11px]",
              hasMediaBody && !hasBubbleText ? "rounded bg-black/40 px-1 text-white/90" : "text-wa-bubble-meta",
              hasMediaBody && !hasBubbleText && "bottom-[6px] right-[8px]"
            )}
          >
            {m._failed ? (
              <AlertCircle className="h-3.5 w-3.5 text-wa-danger" />
            ) : (
              <>
                {(m.edit_type > 0 || m.edited_at) && <span className="italic">edited</span>}
                {formatBubbleTime(m.timestamp)}
                {out && <MessageTicks status={temp ? "pending" : m.receipt_status ?? "sent"} />}
              </>
            )}
          </span>
        </div>

        {/* Failed-send retry strip */}
        {m._failed && (
          <button
            onClick={() => retrySendText(qc, chatJid, m)}
            className="mt-1 flex items-center gap-1 text-[12px] text-wa-danger"
          >
            <AlertCircle className="h-3.5 w-3.5" /> Not sent — tap to retry
          </button>
        )}

        {/* Reaction chips */}
        {item.reactions && item.reactions.length > 0 && (
          <div className={cn("absolute -bottom-[16px] flex gap-0.5", out ? "right-1" : "left-1")}>
            {item.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => (r.mine ? react("") : react(r.emoji))}
                className={cn(
                  "flex items-center gap-0.5 rounded-full border border-wa-bg-deep bg-wa-panel px-1.5 py-0.5 text-[13px] shadow-sm",
                  r.mine && "ring-1 ring-wa-accent/60"
                )}
              >
                {r.emoji}
                {r.count > 1 && <span className="text-[11px] text-wa-text-muted">{r.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
