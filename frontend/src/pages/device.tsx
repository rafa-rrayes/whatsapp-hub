import { useParams } from "react-router-dom"
import { useConnectionStatus } from "@/hooks/use-api"
import { useDeviceChats } from "@/hooks/use-device-chats"
import { useDeviceEvents } from "@/hooks/use-device-events"
import { useDeviceStore } from "@/stores/device"
import { ChatList } from "@/components/device/chat-list"
import { Conversation } from "@/components/device/conversation"
import { InfoPanel } from "@/components/device/info-panel"

function EmptyState() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 border-b-[6px] border-wa-accent bg-wa-empty px-10 text-center">
      <svg viewBox="0 0 303 172" width="250" className="opacity-90">
        <path
          fill="#364147"
          d="M229.6 0H73.4C32.9 0 0 32.9 0 73.4v25.2C0 139.1 32.9 172 73.4 172h156.2c40.5 0 73.4-32.9 73.4-73.4V73.4C303 32.9 270.1 0 229.6 0zm0 156H73.4c-31.7 0-57.4-25.7-57.4-57.4V73.4C16 41.7 41.7 16 73.4 16h156.2c31.7 0 57.4 25.7 57.4 57.4v25.2c0 31.7-25.7 57.4-57.4 57.4z"
        />
        <circle fill="#364147" cx="151.5" cy="86" r="40" />
      </svg>
      <h2 className="text-[28px] font-light text-wa-text-strong">WhatsApp Hub Device</h2>
      <p className="max-w-md text-sm leading-relaxed text-wa-text-muted">
        A live replica of your WhatsApp. Select a chat to read the full conversation, send
        messages, and watch new activity arrive in real time.
      </p>
    </div>
  )
}

export function DevicePage() {
  const { jid } = useParams()
  useDeviceEvents()
  const { data: connection } = useConnectionStatus()
  const waConnected = !connection || connection.status === "connected"
  const { data: chats } = useDeviceChats()
  const infoPanelOpen = useDeviceStore((s) => s.infoPanelOpen)

  const decodedJid = jid ? decodeURIComponent(jid) : undefined
  const chat = decodedJid ? chats?.find((c) => c.jid === decodedJid) : undefined

  return (
    <div className="flex h-full flex-col font-wa">
      {!waConnected && (
        <div className="shrink-0 bg-wa-e2e/15 px-4 py-1.5 text-center text-[13px] text-wa-e2e">
          WhatsApp connection lost — showing stored data; sending is unavailable.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* Chat list pane */}
        <div className="w-[30%] min-w-[340px] max-w-[480px] border-r border-wa-border">
          <ChatList />
        </div>

        {/* Conversation pane */}
        {chat ? (
          <>
            <Conversation key={chat.jid} chat={chat} />
            {infoPanelOpen && <InfoPanel chat={chat} />}
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  )
}
