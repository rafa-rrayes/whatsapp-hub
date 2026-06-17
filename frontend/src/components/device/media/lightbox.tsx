import { useEffect } from "react"
import { X, Download } from "lucide-react"
import { useDeviceStore } from "@/stores/device"
import { useMediaBlob, getMediaBlobUrl } from "@/hooks/use-media-blob"

export function Lightbox() {
  const lightbox = useDeviceStore((s) => s.lightbox)
  const close = useDeviceStore((s) => s.closeLightbox)
  const { url } = useMediaBlob(lightbox?.mediaId)

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [lightbox, close])

  if (!lightbox) return null

  const isVideo = lightbox.mimeType?.startsWith("video/")

  const download = async () => {
    const u = await getMediaBlobUrl(lightbox.mediaId)
    if (!u) return
    const a = document.createElement("a")
    a.href = u
    a.download = lightbox.filename || "media"
    a.click()
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-wa-bg-deep/95" onClick={close}>
      <div className="flex h-[59px] shrink-0 items-center justify-end gap-5 px-5 text-wa-icon">
        <button
          onClick={(e) => {
            e.stopPropagation()
            download()
          }}
          className="hover:text-wa-text"
          title="Download"
        >
          <Download className="h-5 w-5" />
        </button>
        <button onClick={close} className="hover:text-wa-text" title="Close">
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden p-6">
        {url &&
          (isVideo ? (
            <video
              src={url}
              controls
              autoPlay
              className="max-h-full max-w-full"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={url}
              alt=""
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ))}
      </div>
    </div>
  )
}
