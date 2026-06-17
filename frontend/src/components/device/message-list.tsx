import { useRef, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { ChevronDown, Loader2 } from "lucide-react"
import type { ConversationItem } from "@/hooks/use-device-messages"
import { MessageBubble } from "./message-bubble"
import { DateDivider, UnreadDivider } from "./date-divider"

// Large base so older pages can prepend by decrementing (react-virtuoso's
// reverse-infinite pattern). The component remounts per chat (keyed parent),
// so all bookkeeping here is for a single conversation.
const BASE_INDEX = 10_000_000

export function MessageList({
  items,
  chatJid,
  isGroup,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onAtBottomChange,
}: {
  items: ConversationItem[]
  chatJid: string
  isGroup: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  onAtBottomChange?: (atBottom: boolean) => void
}) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(BASE_INDEX)
  const [atBottom, setAtBottom] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const [prev, setPrev] = useState(items)

  // Detect prepends (older history) vs appends (new messages) by key diffing,
  // adjusted during render so Virtuoso sees data + firstItemIndex in one commit.
  if (prev !== items) {
    setPrev(items)
    if (prev.length > 0 && items.length > 0) {
      const prependCount = items.findIndex((i) => i.key === prev[0].key)
      if (prependCount > 0) {
        setFirstItemIndex((v) => v - prependCount)
      }
      const prevLastKey = prev[prev.length - 1].key
      if (items[items.length - 1].key !== prevLastKey && !atBottom) {
        const prevLastIdx = items.findIndex((i) => i.key === prevLastKey)
        const appended = prevLastIdx === -1 ? [] : items.slice(prevLastIdx + 1)
        const incoming = appended.filter(
          (i) => i.kind === "message" && !i.message.from_me
        ).length
        if (incoming > 0) setNewCount((c) => c + incoming)
      }
    }
  }

  const handleAtBottomChange = (bottom: boolean) => {
    setAtBottom(bottom)
    if (bottom) setNewCount(0)
    onAtBottomChange?.(bottom)
  }

  const scrollToBottom = () => {
    virtuosoRef.current?.scrollToIndex({ index: items.length - 1, behavior: "smooth" })
  }

  return (
    <div className="relative h-full">
      {isFetchingNextPage && (
        <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-wa-panel p-1.5 shadow">
          <Loader2 className="h-4 w-4 animate-spin text-wa-accent" />
        </div>
      )}
      <Virtuoso
        ref={virtuosoRef}
        data={items}
        computeItemKey={(_i, item) => item.key}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(items.length - 1, 0)}
        startReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage()
        }}
        followOutput={(bottom) => (bottom ? "smooth" : false)}
        atBottomStateChange={handleAtBottomChange}
        atBottomThreshold={60}
        increaseViewportBy={{ top: 600, bottom: 200 }}
        className="h-full"
        itemContent={(_index, item) => {
          switch (item.kind) {
            case "divider":
              return <DateDivider ts={item.ts} />
            case "unread":
              return <UnreadDivider />
            case "message":
              return <MessageBubble item={item} chatJid={chatJid} isGroup={isGroup} />
          }
        }}
        components={{
          Header: () => <div className="h-2" />,
          Footer: () => <div className="h-2" />,
        }}
      />

      {/* Scroll-to-bottom FAB */}
      {!atBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-wa-panel text-wa-icon shadow-lg hover:text-wa-text"
        >
          {newCount > 0 && (
            <span className="absolute -top-2 left-1/2 flex h-5 min-w-5 -translate-x-1/2 items-center justify-center rounded-full bg-wa-accent px-1 text-xs font-medium text-wa-bg">
              {newCount}
            </span>
          )}
          <ChevronDown className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}
