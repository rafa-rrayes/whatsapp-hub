import type { Message } from "@/lib/types"
import { cn } from "@/lib/utils"

export function AudioTranscription({ message }: { message: Message }) {
  if (!["audio", "ptt"].includes(message.message_type ?? "")) return null

  const text = message.media_transcription?.trim()
  const status = message.media_transcription_status
  if (!text && !status) return null

  const pending = status === "pending"
  const failed = status === "failed"

  return (
    <div
      className={cn(
        "mx-1.5 mt-1 border-t border-wa-text/10 px-0.5 pb-5 pt-2",
        failed ? "text-wa-text-muted" : "text-wa-text"
      )}
      role={pending ? "status" : undefined}
      aria-live={pending ? "polite" : undefined}
    >
      <div className="mb-0.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-wa-text-muted">
        {pending && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-wa-accent" />}
        Transcript
      </div>
      <p className={cn("whitespace-pre-wrap break-words text-[13.5px] leading-[18px]", pending && "italic")}>
        {pending
          ? "Transcribing audio…"
          : failed
            ? "Transcription failed"
            : text || "No speech detected"}
      </p>
    </div>
  )
}
