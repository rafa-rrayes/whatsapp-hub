import { lazy, Suspense, useState } from "react"
import { Plus } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const EmojiPicker = lazy(() => import("emoji-picker-react"))

const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

export function ReactionPicker({
  children,
  onPick,
  open,
  onOpenChange,
}: {
  children: React.ReactNode
  onPick: (emoji: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const pick = (emoji: string) => {
    onPick(emoji)
    onOpenChange(false)
    setExpanded(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setExpanded(false)
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" className="w-auto border-none bg-wa-dropdown p-1.5 shadow-lg">
        {expanded ? (
          <Suspense fallback={<div className="h-[380px] w-[320px]" />}>
            <EmojiPicker
              theme={"dark" as never}
              width={320}
              height={380}
              onEmojiClick={(e) => pick(e.emoji)}
              previewConfig={{ showPreview: false }}
            />
          </Suspense>
        ) : (
          <div className="flex items-center gap-1">
            {QUICK.map((emoji) => (
              <button
                key={emoji}
                onClick={() => pick(emoji)}
                className="rounded-full p-1.5 text-xl hover:bg-wa-panel-active"
              >
                {emoji}
              </button>
            ))}
            <button
              onClick={() => setExpanded(true)}
              className="rounded-full bg-wa-panel p-2 text-wa-icon hover:bg-wa-panel-active"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
