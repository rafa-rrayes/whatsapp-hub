import { FileText, Download } from "lucide-react"
import { getMediaBlobUrl } from "@/hooks/use-media-blob"
import { formatBytes } from "@/lib/utils"
import type { Message } from "@/lib/types"

const EXT_COLORS: Record<string, string> = {
  pdf: "#f15c6d",
  doc: "#53bdeb",
  docx: "#53bdeb",
  xls: "#06cf9c",
  xlsx: "#06cf9c",
  csv: "#06cf9c",
  ppt: "#fa6533",
  pptx: "#fa6533",
  zip: "#ffbc38",
  rar: "#ffbc38",
}

export function DocumentTile({ message }: { message: Message }) {
  const name = message.media_filename || "Document"
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const color = EXT_COLORS[ext] ?? "#8696a0"

  const download = async () => {
    if (!message.media_id) return
    const url = await getMediaBlobUrl(message.media_id)
    if (!url) return
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
  }

  return (
    <button
      onClick={download}
      className="flex w-[280px] items-center gap-3 rounded-md bg-black/15 p-3 text-left hover:bg-black/25"
    >
      <FileText className="h-9 w-9 shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-wa-text">{name}</div>
        <div className="text-xs uppercase text-wa-text-muted">
          {ext}
          {message.media_size ? ` · ${formatBytes(message.media_size)}` : ""}
        </div>
      </div>
      <Download className="h-5 w-5 shrink-0 text-wa-text-muted" />
    </button>
  )
}
