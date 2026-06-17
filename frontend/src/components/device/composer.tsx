import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Plus, Smile, Mic, X, Image as ImageIcon, FileText, Camera } from "lucide-react"
import { api } from "@/lib/api"
import { useDeviceStore } from "@/stores/device"
import { sendTextMessage } from "@/hooks/use-send-message"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AttachPreviewDialog } from "./attach-preview-dialog"
import { pendingFromFile, type PendingAttachment } from "./attach-utils"
import { VoiceRecorder } from "./voice-recorder"
import { SendGlyph } from "./icons"
import { displayName, messagePreview } from "./format"

const EmojiPicker = lazy(() => import("emoji-picker-react"))

const TYPING_RESEND_MS = 8000
const TYPING_PAUSE_MS = 3000

export function Composer({ jid }: { jid: string }) {
  const qc = useQueryClient()
  const replyTo = useDeviceStore((s) => s.replyTo)
  const setReplyTo = useDeviceStore((s) => s.setReplyTo)
  const [text, setText] = useState("")
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState<PendingAttachment | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mediaInputRef = useRef<HTMLInputElement | null>(null)
  const docInputRef = useRef<HTMLInputElement | null>(null)
  const lastComposingRef = useRef(0)
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // The composer remounts per chat (parent is keyed by jid), so draft state
  // resets naturally; only the typing-pause timer needs cleanup.
  useEffect(() => () => clearTimeout(pauseTimerRef.current), [])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [jid, replyTo])

  const sendPresence = (type: "composing" | "paused") => {
    api.post("/api/actions/presence", { type, jid }).catch(() => {})
  }

  const onType = (value: string) => {
    setText(value)
    const now = Date.now()
    if (value && now - lastComposingRef.current > TYPING_RESEND_MS) {
      lastComposingRef.current = now
      sendPresence("composing")
    }
    clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = setTimeout(() => {
      if (lastComposingRef.current) {
        lastComposingRef.current = 0
        sendPresence("paused")
      }
    }, TYPING_PAUSE_MS)
  }

  const autoGrow = () => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 5 * 22)}px`
  }

  const send = () => {
    const value = text.trim()
    if (!value) return
    setText("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    clearTimeout(pauseTimerRef.current)
    if (lastComposingRef.current) {
      lastComposingRef.current = 0
      sendPresence("paused")
    }
    const quoted = replyTo
    setReplyTo(null)
    void sendTextMessage(qc, jid, value, quoted)
  }

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current
    if (!ta) {
      setText((t) => t + emoji)
      return
    }
    const start = ta.selectionStart ?? text.length
    const end = ta.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + emoji.length
    })
  }

  const onFilePicked = (file: File | undefined, asDocument: boolean) => {
    if (!file) return
    const p = pendingFromFile(file, asDocument)
    if (p) setPending(p)
  }

  return (
    <div className="shrink-0 bg-wa-panel">
      {/* Reply bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 pt-2">
          <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg bg-wa-panel-active" style={{ borderLeft: "4px solid #00a884" }}>
            <div className="min-w-0 px-3 py-1.5">
              <div className="text-[12.5px] font-medium text-wa-accent">
                {replyTo.from_me ? "You" : displayName(replyTo.push_name, replyTo.participant || replyTo.from_jid || jid)}
              </div>
              <div className="truncate text-[13px] text-wa-text-muted">{messagePreview(replyTo)}</div>
            </div>
          </div>
          <button onClick={() => setReplyTo(null)} className="shrink-0 text-wa-icon hover:text-wa-text">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      <div className="flex min-h-[62px] items-end gap-2 px-4 py-2.5">
        {recording ? (
          <VoiceRecorder jid={jid} onDone={() => setRecording(false)} />
        ) : (
          <>
            {/* Attach */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="mb-1.5 shrink-0 text-wa-icon hover:text-wa-text" title="Attach">
                  <Plus className="h-6 w-6" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="border-none bg-wa-dropdown text-wa-text-strong">
                <DropdownMenuItem
                  className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
                  onClick={() => mediaInputRef.current?.click()}
                >
                  <ImageIcon className="h-4 w-4 text-wa-blue" /> Photos & videos
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
                  onClick={() => docInputRef.current?.click()}
                >
                  <FileText className="h-4 w-4 text-wa-accent" /> Document
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
                  disabled
                >
                  <Camera className="h-4 w-4 text-wa-danger" /> Camera
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                onFilePicked(e.target.files?.[0], false)
                e.target.value = ""
              }}
            />
            <input
              ref={docInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                onFilePicked(e.target.files?.[0], true)
                e.target.value = ""
              }}
            />

            {/* Emoji */}
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button className="mb-1.5 shrink-0 text-wa-icon hover:text-wa-text" title="Emoji">
                  <Smile className="h-6 w-6" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-auto border-none bg-wa-dropdown p-0 shadow-lg">
                <Suspense fallback={<div className="h-[400px] w-[340px]" />}>
                  <EmojiPicker
                    theme={"dark" as never}
                    width={340}
                    height={400}
                    onEmojiClick={(e) => insertEmoji(e.emoji)}
                    previewConfig={{ showPreview: false }}
                  />
                </Suspense>
              </PopoverContent>
            </Popover>

            {/* Input */}
            <textarea
              ref={textareaRef}
              value={text}
              rows={1}
              onChange={(e) => {
                onType(e.target.value)
                autoGrow()
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
                if (e.key === "Escape" && replyTo) setReplyTo(null)
              }}
              placeholder="Type a message"
              className="max-h-[110px] min-h-[42px] flex-1 resize-none rounded-lg bg-wa-panel-active px-3 py-2.5 text-[15px] leading-[22px] text-wa-text outline-none placeholder:text-wa-text-muted"
            />

            {/* Send / mic */}
            {text.trim() ? (
              <button
                onClick={send}
                className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center text-wa-icon hover:text-wa-text"
                title="Send"
              >
                <SendGlyph className="h-6 w-6" />
              </button>
            ) : (
              <button
                onClick={() => setRecording(true)}
                className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center text-wa-icon hover:text-wa-text"
                title="Voice message"
              >
                <Mic className="h-6 w-6" />
              </button>
            )}
          </>
        )}
      </div>

      <AttachPreviewDialog jid={jid} pending={pending} onClose={() => setPending(null)} />
    </div>
  )
}
