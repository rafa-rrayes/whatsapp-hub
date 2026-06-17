import { useNavigate } from "react-router-dom"
import { Pin, VolumeX, Archive, CheckCheck, MailOpen } from "lucide-react"
import type { Chat } from "@/lib/types"
import { ChatAvatar } from "./chat-avatar"
import { MessageTicks } from "./message-ticks"
import { formatListTime, previewText, displayName } from "./format"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu"
import { useArchiveChat, usePinChat, useMuteChat, useMarkChatRead } from "@/hooks/use-device-chats"
import { cn } from "@/lib/utils"

const MUTE_8H = 8 * 60 * 60 * 1000
const MUTE_1W = 7 * 24 * 60 * 60 * 1000

export function ChatListItem({ chat, selected }: { chat: Chat; selected: boolean }) {
  const navigate = useNavigate()
  const archive = useArchiveChat()
  const pin = usePinChat()
  const mute = useMuteChat()
  const markRead = useMarkChatRead()

  const unread = chat.unread_count > 0
  const preview = previewText(chat)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={() => navigate(`/device/${encodeURIComponent(chat.jid)}`)}
          className={cn(
            "flex w-full items-center text-left",
            selected ? "bg-wa-panel-active" : "hover:bg-wa-panel"
          )}
        >
          <div className="flex h-[72px] items-center pl-3 pr-[13px]">
            <ChatAvatar jid={chat.jid} isGroup={chat.is_group} size={49} />
          </div>
          <div className="flex h-[72px] min-w-0 flex-1 flex-col justify-center border-b border-wa-border pr-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[17px] leading-snug text-wa-text">
                {displayName(chat.name, chat.jid)}
              </span>
              <span
                className={cn(
                  "shrink-0 text-xs",
                  unread ? "font-medium text-wa-accent" : "text-wa-text-muted"
                )}
              >
                {formatListTime(chat.last_message_ts)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 truncate text-sm text-wa-text-muted">
                {chat.last_message_from_me && chat.last_message_type !== "call_log" && (
                  <MessageTicks status={chat.last_message_receipt_status ?? "sent"} />
                )}
                <span className="truncate">{preview || " "}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {chat.is_muted && <VolumeX className="h-4 w-4 text-wa-text-muted" />}
                {chat.is_pinned && <Pin className="h-4 w-4 rotate-45 text-wa-text-muted" />}
                {unread && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-wa-accent px-1.5 text-xs font-medium text-wa-bg">
                    {chat.unread_count > 99 ? "99+" : chat.unread_count}
                  </span>
                )}
              </span>
            </div>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="border-none bg-wa-dropdown text-wa-text-strong">
        <ContextMenuItem
          className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
          onClick={() => archive.mutate({ jid: chat.jid, archived: !chat.is_archived })}
        >
          <Archive className="h-4 w-4" />
          {chat.is_archived ? "Unarchive chat" : "Archive chat"}
        </ContextMenuItem>
        <ContextMenuItem
          className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
          onClick={() => pin.mutate({ jid: chat.jid, pinned: !chat.is_pinned })}
        >
          <Pin className="h-4 w-4" />
          {chat.is_pinned ? "Unpin chat" : "Pin chat"}
        </ContextMenuItem>
        <ContextMenuItem
          className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
          onClick={() =>
            mute.mutate({
              jid: chat.jid,
              until: chat.is_muted ? null : Date.now() + MUTE_8H,
            })
          }
        >
          <VolumeX className="h-4 w-4" />
          {chat.is_muted ? "Unmute chat" : "Mute for 8 hours"}
        </ContextMenuItem>
        {!chat.is_muted && (
          <ContextMenuItem
            className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
            onClick={() => mute.mutate({ jid: chat.jid, until: Date.now() + MUTE_1W })}
          >
            <VolumeX className="h-4 w-4" />
            Mute for 1 week
          </ContextMenuItem>
        )}
        {unread && (
          <ContextMenuItem
            className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
            onClick={() => markRead.mutate(chat.jid)}
          >
            <CheckCheck className="h-4 w-4" />
            Mark as read
          </ContextMenuItem>
        )}
        {!unread && (
          <ContextMenuItem
            className="h-10 px-4 text-[14.5px] focus:bg-wa-hover-deep focus:text-wa-text-strong"
            disabled
          >
            <MailOpen className="h-4 w-4" />
            Mark as read
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
