import { useQuery } from "@tanstack/react-query"
import { Search, EllipsisVertical } from "lucide-react"
import { api } from "@/lib/api"
import type { Chat } from "@/lib/types"
import { useDeviceStore } from "@/stores/device"
import { ChatAvatar } from "./chat-avatar"
import { displayName, formatLastSeen } from "./format"

function useSubtitle(chat: Chat): string {
  const presence = useDeviceStore((s) => s.presence[chat.jid])
  const isGroup = chat.is_group

  const { data: lastKnown } = useQuery({
    queryKey: ["device-presence", chat.jid],
    queryFn: () =>
      api.get<{ status: string | null; last_seen: number | null }>(
        `/api/presence/${encodeURIComponent(chat.jid)}`
      ),
    enabled: !isGroup,
    staleTime: 60_000,
  })

  if (presence) {
    if (presence.status === "composing") {
      return isGroup && presence.participant
        ? `${displayName(undefined, presence.participant)} is typing…`
        : "typing…"
    }
    if (presence.status === "recording") return "recording audio…"
    if (presence.status === "available") return "online"
    if (presence.status === "unavailable" && presence.lastSeen) {
      return formatLastSeen(presence.lastSeen)
    }
  }
  if (isGroup) return "click here for group info"
  if (lastKnown?.status === "available") return "online"
  if (lastKnown?.last_seen) return formatLastSeen(lastKnown.last_seen)
  return ""
}

export function ConversationHeader({ chat }: { chat: Chat }) {
  const setInfoPanelOpen = useDeviceStore((s) => s.setInfoPanelOpen)
  const infoPanelOpen = useDeviceStore((s) => s.infoPanelOpen)
  const subtitle = useSubtitle(chat)

  return (
    <header className="flex h-[59px] shrink-0 items-center justify-between bg-wa-panel px-4">
      <button
        onClick={() => setInfoPanelOpen(!infoPanelOpen)}
        className="flex min-w-0 items-center gap-3 text-left"
      >
        <ChatAvatar jid={chat.jid} isGroup={chat.is_group} size={40} />
        <div className="min-w-0">
          <div className="truncate text-[16px] leading-tight text-wa-text">
            {displayName(chat.name, chat.jid)}
          </div>
          {subtitle && (
            <div className="truncate text-[13px] leading-tight text-wa-text-muted">{subtitle}</div>
          )}
        </div>
      </button>
      <div className="flex items-center gap-5 text-wa-icon">
        <button title="Search" className="hover:text-wa-text">
          <Search className="h-5 w-5" />
        </button>
        <button
          title="Menu"
          className="hover:text-wa-text"
          onClick={() => setInfoPanelOpen(!infoPanelOpen)}
        >
          <EllipsisVertical className="h-5 w-5" />
        </button>
      </div>
    </header>
  )
}
