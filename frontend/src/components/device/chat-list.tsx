import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { Search, Archive, ArrowLeft, SquarePen, EllipsisVertical, Loader2 } from "lucide-react"
import { useDeviceChats } from "@/hooks/use-device-chats"
import { useDeviceStore } from "@/stores/device"
import { ChatFilterTabs } from "./chat-filter-tabs"
import { ChatListItem } from "./chat-list-item"
import { NewChatDialog } from "./new-chat-dialog"
import type { Chat } from "@/lib/types"

function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return Number(b.is_pinned) - Number(a.is_pinned)
    return (b.last_message_ts ?? 0) - (a.last_message_ts ?? 0)
  })
}

export function ChatList() {
  const { jid: selectedJid } = useParams()
  const { data: chats, isLoading } = useDeviceChats()
  const filterTab = useDeviceStore((s) => s.filterTab)
  const searchQuery = useDeviceStore((s) => s.searchQuery)
  const setSearchQuery = useDeviceStore((s) => s.setSearchQuery)
  const archivedView = useDeviceStore((s) => s.archivedView)
  const setArchivedView = useDeviceStore((s) => s.setArchivedView)
  const [newChatOpen, setNewChatOpen] = useState(false)

  const { active, archived } = useMemo(() => {
    const all = chats ?? []
    const q = searchQuery.trim().toLowerCase()
    const matches = (c: Chat) => {
      if (q && !(c.name ?? c.jid).toLowerCase().includes(q)) return false
      if (filterTab === "unread" && c.unread_count === 0) return false
      if (filterTab === "favourites" && !c.is_pinned) return false
      if (filterTab === "groups" && !c.is_group) return false
      return true
    }
    return {
      active: sortChats(all.filter((c) => !c.is_archived && matches(c))),
      archived: sortChats(all.filter((c) => c.is_archived && matches(c))),
    }
  }, [chats, searchQuery, filterTab])

  const list = archivedView ? archived : active

  return (
    <div className="flex h-full flex-col bg-wa-bg">
      {/* Header */}
      <header className="flex h-[59px] shrink-0 items-center justify-between px-4">
        {archivedView ? (
          <div className="flex items-center gap-5">
            <button onClick={() => setArchivedView(false)} className="text-wa-icon hover:text-wa-text">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="text-[16px] font-medium text-wa-text">Archived</span>
          </div>
        ) : (
          <>
            <span className="text-[20px] font-semibold text-wa-text">Chats</span>
            <div className="flex items-center gap-4 text-wa-icon">
              <button title="New chat" onClick={() => setNewChatOpen(true)} className="hover:text-wa-text">
                <SquarePen className="h-5 w-5" />
              </button>
              <button title="Menu" className="hover:text-wa-text">
                <EllipsisVertical className="h-5 w-5" />
              </button>
            </div>
          </>
        )}
      </header>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex h-[35px] items-center gap-3 rounded-lg bg-wa-panel px-3">
          <Search className="h-4 w-4 shrink-0 text-wa-text-muted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search or start a new chat"
            className="w-full bg-transparent text-sm text-wa-text outline-none placeholder:text-wa-text-muted"
          />
        </div>
      </div>

      {!archivedView && <ChatFilterTabs />}

      {/* Archived entry row */}
      {!archivedView && archived.length > 0 && (
        <button
          onClick={() => setArchivedView(true)}
          className="flex h-[49px] shrink-0 items-center gap-3 px-3 hover:bg-wa-panel"
        >
          <span className="flex w-[49px] items-center justify-center">
            <Archive className="h-5 w-5 text-wa-accent" />
          </span>
          <span className="flex flex-1 items-center justify-between border-b border-wa-border pr-3 text-[17px] text-wa-text">
            Archived
            <span className="text-xs text-wa-accent">{archived.length}</span>
          </span>
        </button>
      )}

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-wa-text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-wa-text-muted">
            {searchQuery ? "No chats found" : archivedView ? "No archived chats" : "No chats yet"}
          </div>
        ) : (
          list.map((chat) => (
            <ChatListItem key={chat.jid} chat={chat} selected={chat.jid === selectedJid} />
          ))
        )}
      </div>

      <NewChatDialog open={newChatOpen} onOpenChange={setNewChatOpen} />
    </div>
  )
}
