import { useState } from "react"
import { Download, ImageOff, Loader2 } from "lucide-react"
import { useMediaBlob } from "@/hooks/use-media-blob"
import { useDeviceStore } from "@/stores/device"
import { api } from "@/lib/api"
import type { Message } from "@/lib/types"

export function ImageAttachment({ message }: { message: Message }) {
  const { url, loading, failed } = useMediaBlob(message.media_id)
  const openLightbox = useDeviceStore((s) => s.openLightbox)
  const [retrying, setRetrying] = useState(false)

  const w = message.media_width || 330
  const h = message.media_height || 330
  const ratio = h / w
  const width = Math.min(330, w)
  const height = Math.min(width * ratio, 440)

  const retry = async () => {
    if (!message.media_id || retrying) return
    setRetrying(true)
    try {
      await api.post(`/api/media/${encodeURIComponent(message.media_id)}/retry`)
    } catch {
      // server toast paths handle errors; placeholder stays
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      className="relative cursor-pointer overflow-hidden rounded-md bg-wa-bubble-in-deep"
      style={{ width, height }}
      onClick={() =>
        url &&
        message.media_id &&
        openLightbox({ mediaId: message.media_id, mimeType: message.media_mime_type, filename: message.media_filename })
      }
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-wa-text-muted">
          {loading || retrying ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : failed ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                retry()
              }}
              className="flex flex-col items-center gap-1 text-xs"
            >
              <Download className="h-7 w-7" />
              Tap to download
            </button>
          ) : (
            <ImageOff className="h-6 w-6" />
          )}
        </div>
      )}
    </div>
  )
}
