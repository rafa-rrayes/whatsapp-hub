import { toast } from "sonner"
import { formatBytes } from "@/lib/utils"
import type { MediaSendInput } from "@/hooks/use-send-message"

const MAX_SIZE = 64 * 1024 * 1024

export interface PendingAttachment {
  file: File
  kind: MediaSendInput["kind"]
}

function kindForFile(file: File, asDocument: boolean): MediaSendInput["kind"] {
  if (asDocument) return "document"
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  return "document"
}

export function pendingFromFile(file: File, asDocument = false): PendingAttachment | null {
  if (file.size > MAX_SIZE) {
    toast.error(`File too large (${formatBytes(file.size)}). Max 64 MB.`)
    return null
  }
  return { file, kind: kindForFile(file, asDocument) }
}

export async function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(",") + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
