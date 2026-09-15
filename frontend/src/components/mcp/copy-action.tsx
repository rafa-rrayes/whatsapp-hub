import { Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export function CopyAction({ text, label = "Copy", primary = false, disabled = false }: {
  text: string; label?: string; primary?: boolean; disabled?: boolean
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label.replace(/^Copy /, "")} copied`)
    } catch {
      toast.error("Clipboard unavailable. Reveal the text, select it, and copy manually.")
    }
  }
  return <Button variant={primary ? "default" : "outline"} onClick={() => void copy()} disabled={disabled}>
    <Copy className="h-4 w-4" />{label}
  </Button>
}
