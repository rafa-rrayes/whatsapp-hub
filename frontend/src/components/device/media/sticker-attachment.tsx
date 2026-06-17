import { Loader2 } from "lucide-react"
import { useMediaBlob } from "@/hooks/use-media-blob"
import type { Message } from "@/lib/types"

export function StickerAttachment({ message }: { message: Message }) {
  const { url, loading } = useMediaBlob(message.media_id)

  if (!url) {
    return (
      <div className="flex h-[190px] w-[190px] items-center justify-center rounded-md bg-wa-panel/40 text-wa-text-muted">
        {loading && <Loader2 className="h-5 w-5 animate-spin" />}
      </div>
    )
  }

  return <img src={url} alt="" className="h-[190px] w-[190px] object-contain" draggable={false} />
}
