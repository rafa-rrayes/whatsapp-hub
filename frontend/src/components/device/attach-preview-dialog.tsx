import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { FileText, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { sendMediaMessage } from "@/hooks/use-send-message"
import { formatBytes } from "@/lib/utils"
import { fileToBase64, type PendingAttachment } from "./attach-utils"
import { SendGlyph } from "./icons"

export function AttachPreviewDialog({
  jid,
  pending,
  onClose,
}: {
  jid: string
  pending: PendingAttachment | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [caption, setCaption] = useState("")
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!pending) return
    const url = URL.createObjectURL(pending.file)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
      setPreviewUrl(null)
      setCaption("")
    }
  }, [pending])

  if (!pending) return null

  const send = async () => {
    if (sending) return
    setSending(true)
    try {
      const base64 = await fileToBase64(pending.file)
      // Keep a fresh objectURL alive for the optimistic bubble.
      const localUrl = URL.createObjectURL(pending.file)
      onClose()
      await sendMediaMessage(qc, jid, {
        kind: pending.kind,
        base64,
        mimeType: pending.file.type || "application/octet-stream",
        caption: caption.trim() || undefined,
        filename: pending.file.name,
        localUrl,
      })
    } catch {
      toast.error("Failed to read file")
    } finally {
      setSending(false)
    }
  }

  const isImage = pending.kind === "image"
  const isVideo = pending.kind === "video"

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-none bg-wa-panel p-0 sm:max-w-[480px]" showCloseButton={false}>
        <div className="flex items-center justify-between px-4 pt-3">
          <DialogTitle className="text-[15px] font-normal text-wa-text">
            {pending.file.name}
          </DialogTitle>
          <button onClick={onClose} className="text-wa-icon hover:text-wa-text">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex max-h-[420px] min-h-[200px] items-center justify-center overflow-hidden px-4">
          {isImage && previewUrl ? (
            <img src={previewUrl} alt="" className="max-h-[400px] max-w-full object-contain" />
          ) : isVideo && previewUrl ? (
            <video src={previewUrl} controls className="max-h-[400px] max-w-full" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-wa-text-muted">
              <FileText className="h-16 w-16" />
              <span className="text-sm">{formatBytes(pending.file.size)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 p-3">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Add a caption"
            className="h-10 flex-1 rounded-lg bg-wa-panel-active px-3 text-[15px] text-wa-text outline-none placeholder:text-wa-text-muted"
          />
          <button
            onClick={send}
            disabled={sending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-accent text-wa-bg disabled:opacity-60"
          >
            <SendGlyph className="h-5 w-5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
