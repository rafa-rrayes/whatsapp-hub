import { X, Archive, VolumeX, Volume2 } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Chat, Contact, Group } from "@/lib/types"
import { useMessages } from "@/hooks/use-api"
import { useArchiveChat, useMuteChat } from "@/hooks/use-device-chats"
import { useDeviceStore } from "@/stores/device"
import { useMediaBlob } from "@/hooks/use-media-blob"
import { ChatAvatar } from "./chat-avatar"
import { displayName, senderColor } from "./format"
import { formatJid } from "@/lib/utils"

const MUTE_8H = 8 * 60 * 60 * 1000

function MediaThumb({ mediaId, mimeType }: { mediaId: string; mimeType?: string }) {
  const { url } = useMediaBlob(mediaId)
  const openLightbox = useDeviceStore((s) => s.openLightbox)
  if (!url) return <div className="aspect-square rounded bg-wa-panel" />
  return (
    <button
      onClick={() => openLightbox({ mediaId, mimeType })}
      className="aspect-square overflow-hidden rounded"
    >
      {mimeType?.startsWith("video/") ? (
        <video src={url} className="h-full w-full object-cover" />
      ) : (
        <img src={url} alt="" className="h-full w-full object-cover" />
      )}
    </button>
  )
}

export function InfoPanel({ chat }: { chat: Chat }) {
  const setInfoPanelOpen = useDeviceStore((s) => s.setInfoPanelOpen)
  const archive = useArchiveChat()
  const mute = useMuteChat()
  const isGroup = chat.is_group

  const { data: group } = useQuery({
    queryKey: ["device-group", chat.jid],
    queryFn: () => api.get<Group>(`/api/groups/${encodeURIComponent(chat.jid)}`),
    enabled: isGroup,
    staleTime: 60_000,
  })

  const { data: contact } = useQuery({
    queryKey: ["device-contact", chat.jid],
    queryFn: () => api.get<Contact>(`/api/contacts/${encodeURIComponent(chat.jid)}`),
    enabled: !isGroup,
    staleTime: 60_000,
    retry: false,
  })

  const { data: mediaMessages } = useMessages({
    chat: chat.jid,
    has_media: "true",
    limit: 30,
  })

  const thumbs = (mediaMessages?.data ?? [])
    .filter((m) => m.media_id && ["image", "video", "sticker"].includes(m.message_type ?? ""))
    .slice(0, 12)

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col overflow-y-auto border-l border-wa-border bg-wa-bg">
      <header className="flex h-[59px] shrink-0 items-center gap-5 bg-wa-panel px-4">
        <button onClick={() => setInfoPanelOpen(false)} className="text-wa-icon hover:text-wa-text">
          <X className="h-5 w-5" />
        </button>
        <span className="text-[16px] text-wa-text">{isGroup ? "Group info" : "Contact info"}</span>
      </header>

      {/* Hero */}
      <div className="flex flex-col items-center gap-3 bg-wa-bg px-6 py-7">
        <ChatAvatar jid={chat.jid} isGroup={isGroup} size={200} />
        <div className="text-center">
          <div className="text-[22px] leading-tight text-wa-text">{displayName(chat.name, chat.jid)}</div>
          <div className="mt-1 text-[15px] text-wa-text-muted">
            {isGroup
              ? `Group · ${group?.participant_count ?? "…"} members`
              : formatJid(chat.jid)}
          </div>
        </div>
      </div>

      {/* About / description */}
      {(contact?.status_text || group?.description) && (
        <div className="mt-2 bg-wa-bg px-7 py-4">
          <div className="text-[14px] text-wa-text-muted">{isGroup ? "Description" : "About"}</div>
          <div className="mt-1 whitespace-pre-wrap text-[15px] text-wa-text">
            {isGroup ? group?.description : contact?.status_text}
          </div>
        </div>
      )}

      {/* Shared media */}
      {thumbs.length > 0 && (
        <div className="mt-2 bg-wa-bg px-7 py-4">
          <div className="mb-2 text-[14px] text-wa-text-muted">Media</div>
          <div className="grid grid-cols-3 gap-1.5">
            {thumbs.map((m) => (
              <MediaThumb key={m.id} mediaId={m.media_id!} mimeType={m.media_mime_type} />
            ))}
          </div>
        </div>
      )}

      {/* Participants */}
      {isGroup && group?.participants && (
        <div className="mt-2 bg-wa-bg px-4 py-4">
          <div className="mb-1 px-3 text-[14px] text-wa-text-muted">
            {group.participants.length} members
          </div>
          {group.participants.map((p) => {
            const jid = p.phone_jid || p.participant_jid
            return (
              <div key={p.participant_jid} className="flex items-center gap-3 rounded px-3 py-2 hover:bg-wa-panel">
                <ChatAvatar jid={jid} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px]" style={{ color: senderColor(p.participant_jid) }}>
                    {displayName(p.name || p.notify_name, jid)}
                  </div>
                </div>
                {(p.role === "admin" || p.role === "superadmin") && (
                  <span className="rounded border border-wa-accent/50 px-1.5 py-0.5 text-[11px] text-wa-accent">
                    Group admin
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Actions */}
      <div className="mt-2 bg-wa-bg px-4 py-2">
        <button
          onClick={() =>
            mute.mutate({ jid: chat.jid, until: chat.is_muted ? null : Date.now() + MUTE_8H })
          }
          className="flex w-full items-center gap-4 rounded px-3 py-3 text-left text-[15px] text-wa-text hover:bg-wa-panel"
        >
          {chat.is_muted ? (
            <>
              <Volume2 className="h-5 w-5 text-wa-icon" /> Unmute notifications
            </>
          ) : (
            <>
              <VolumeX className="h-5 w-5 text-wa-icon" /> Mute notifications
            </>
          )}
        </button>
        <button
          onClick={() => archive.mutate({ jid: chat.jid, archived: !chat.is_archived })}
          className="flex w-full items-center gap-4 rounded px-3 py-3 text-left text-[15px] text-wa-text hover:bg-wa-panel"
        >
          <Archive className="h-5 w-5 text-wa-icon" />
          {chat.is_archived ? "Unarchive chat" : "Archive chat"}
        </button>
      </div>
    </aside>
  )
}
