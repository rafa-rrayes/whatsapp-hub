import { useCallback, useState } from "react"
import { Download, Copy, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"

interface ExportMarkdownMenuProps {
  /** Filename used for the downloaded .md file. */
  filename: string
  /** Produces the markdown. May be sync (built locally) or async (fetched). */
  getMarkdown: () => string | Promise<string>
  label?: string
}

export function ExportMarkdownMenu({
  filename,
  getMarkdown,
  label = "Export as MD",
}: ExportMarkdownMenuProps) {
  // Cache the markdown for the component's lifetime. Prefetching on open keeps
  // the clipboard write inside the user-gesture window even when getMarkdown
  // is an async fetch (Safari rejects clipboard writes after the gesture ends).
  const [cached, setCached] = useState<string | null>(null)

  const resolve = useCallback(async () => {
    if (cached != null) return cached
    const text = await getMarkdown()
    setCached(text)
    return text
  }, [cached, getMarkdown])

  const prefetch = useCallback(
    (open: boolean) => {
      if (open && cached == null) {
        void Promise.resolve(getMarkdown()).then(setCached).catch(() => {})
      }
    },
    [cached, getMarkdown]
  )

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(await resolve())
      toast.success("Copied to clipboard")
    } catch {
      toast.error("Failed to copy to clipboard")
    }
  }, [resolve])

  const handleDownload = useCallback(async () => {
    try {
      const md = await resolve()
      const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }))
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success(`Downloaded ${filename}`)
    } catch {
      toast.error("Failed to export markdown")
    }
  }, [resolve, filename])

  return (
    <DropdownMenu onOpenChange={prefetch}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Download className="h-3.5 w-3.5" />
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void handleCopy()}>
          <Copy className="h-3.5 w-3.5" />
          Copy to clipboard
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleDownload()}>
          <Download className="h-3.5 w-3.5" />
          Download .md
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
