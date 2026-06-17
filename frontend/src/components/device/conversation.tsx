import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import type { Chat } from "@/lib/types"
import { useDeviceMessages } from "@/hooks/use-device-messages"
import { useMarkChatRead } from "@/hooks/use-device-chats"
import { useDeviceStore } from "@/stores/device"
import { ConversationHeader } from "./conversation-header"
import { MessageList } from "./message-list"
import { Composer } from "./composer"
import { Lightbox } from "./media/lightbox"

export function Conversation({ chat }: { chat: Chat }) {
  const jid = chat.jid
  const resetChatState = useDeviceStore((s) => s.resetChatState)
  const markRead = useMarkChatRead()
  const [atBottom, setAtBottom] = useState(true)

  // Snapshot the unread count at open so the "Unread messages" marker stays
  // put after mark-as-read zeroes the badge. The component remounts per chat
  // (keyed by jid in the page), so mount-time state is the open snapshot.
  const [initialUnread] = useState(() => chat.unread_count)

  const { items, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useDeviceMessages(
    jid,
    initialUnread
  )

  useEffect(() => {
    resetChatState()
    // Presence events only flow after an explicit per-jid subscription.
    api.post("/api/presence/subscribe", { jid }).catch(() => {})
  }, [jid, resetChatState])

  // Mark as read while the chat is open, focused, and scrolled to the bottom.
  const unread = chat.unread_count
  const marking = markRead.isPending
  useEffect(() => {
    if (unread <= 0 || !atBottom || marking) return
    const fire = () => {
      if (document.hasFocus()) markRead.mutate(jid)
    }
    fire()
    window.addEventListener("focus", fire)
    return () => window.removeEventListener("focus", fire)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jid, unread, atBottom, marking])

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <ConversationHeader chat={chat} />
      <div className="relative min-h-0 flex-1 bg-wa-bg-deep">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-wa-text-muted">
            Loading messages…
          </div>
        ) : (
          <MessageList
            items={items}
            chatJid={jid}
            isGroup={chat.is_group}
            hasNextPage={Boolean(hasNextPage)}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            onAtBottomChange={setAtBottom}
          />
        )}
      </div>
      <Composer jid={jid} />
      <Lightbox />
    </div>
  )
}
