import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Trash2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { sendMediaMessage } from "@/hooks/use-send-message"
import { fileToBase64 } from "./attach-utils"
import { formatDuration } from "./format"
import { SendGlyph } from "./icons"

export function VoiceRecorder({ jid, onDone }: { jid: string; onDone: () => void }) {
  const qc = useQueryClient()
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [seconds, setSeconds] = useState(0)
  const [sending, setSending] = useState(false)
  // "send" | "cancel" decided at stop time
  const intentRef = useRef<"send" | "cancel">("cancel")

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    let stream: MediaStream | undefined

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        stream = s
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm"
        const rec = new MediaRecorder(s, { mimeType: mime })
        recorderRef.current = rec
        chunksRef.current = []
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        rec.onstop = async () => {
          stream?.getTracks().forEach((t) => t.stop())
          if (intentRef.current === "send" && chunksRef.current.length > 0) {
            setSending(true)
            try {
              const blob = new Blob(chunksRef.current, { type: mime })
              const base64 = await fileToBase64(blob)
              await sendMediaMessage(qc, jid, {
                kind: "audio",
                base64,
                mimeType: mime,
                ptt: true,
              })
            } catch {
              toast.error("Failed to send voice message")
            }
          }
          onDone()
        }
        rec.start(250)
        timer = setInterval(() => setSeconds((v) => v + 1), 1000)
      })
      .catch(() => {
        toast.error("Microphone access denied")
        onDone()
      })

    return () => {
      clearInterval(timer)
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop()
      } else {
        stream?.getTracks().forEach((t) => t.stop())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = (intent: "send" | "cancel") => {
    intentRef.current = intent
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop()
    } else {
      onDone()
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-end gap-4 px-2">
      <button onClick={() => stop("cancel")} className="text-wa-icon hover:text-wa-danger" title="Discard">
        <Trash2 className="h-5 w-5" />
      </button>
      <span className="flex items-center gap-2 text-[15px] text-wa-danger">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-wa-danger" />
        {formatDuration(seconds)}
      </span>
      <button
        onClick={() => stop("send")}
        disabled={sending}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-wa-accent text-wa-bg disabled:opacity-60"
        title="Send"
      >
        {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendGlyph className="h-5 w-5" />}
      </button>
    </div>
  )
}
