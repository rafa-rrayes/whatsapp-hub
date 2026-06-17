import { Loader2, VideoOff } from "lucide-react"
import { useMediaBlob } from "@/hooks/use-media-blob"
import type { Message } from "@/lib/types"

export function VideoAttachment({ message }: { message: Message }) {
  const { url, loading } = useMediaBlob(message.media_id)

  const w = message.media_width || 330
  const h = message.media_height || 240
  const ratio = h / w
  const width = Math.min(330, w)
  const height = Math.min(width * ratio, 440)

  if (!url) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-wa-bubble-in-deep text-wa-text-muted"
        style={{ width, height }}
      >
        {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <VideoOff className="h-6 w-6" />}
      </div>
    )
  }

  return (
    <video
      src={url}
      controls
      preload="metadata"
      className="rounded-md bg-black"
      style={{ width, maxHeight: 440 }}
    />
  )
}
