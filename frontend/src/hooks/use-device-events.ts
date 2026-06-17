import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { subscribeWs } from "@/lib/ws-bus"
import type { Chat, Message } from "@/lib/types"
import { useDeviceStore } from "@/stores/device"
import {
  appendMessage,
  patchMessage,
  hasMessage,
  patchReceipt,
  refreshNewest,
  deviceMessagesKey,
} from "@/hooks/use-device-messages"
import { DEVICE_CHATS_KEY, upsertChat, patchChat } from "@/hooks/use-device-chats"

const RECEIPT_ORDER: Record<string, number> = { sent: 1, delivered: 2, read: 3, played: 4 }

interface MessageNewEvent {
  chat_jid: string
  message: Message
}

interface MessageReceiptEvent {
  message_id: string
  chat_jid: string
  recipient_jid: string
  receipt_status: "sent" | "delivered" | "read" | "played"
}

interface PresenceUpdateEvent {
  id: string
  presences?: Record<string, { lastKnownPresence?: string; lastSeen?: number }>
}

/**
 * Live wiring for the device view. Mounted once on the device page; translates
 * hub WS events into query-cache patches (no refetch storms). The connection
 * banner uses useConnectionStatus() (REST, invalidated on connection.* events)
 * rather than raw WS frames — the WS welcome frame reuses the connection.status
 * type with a 'ws_connected' payload that is not a WhatsApp status.
 */
export function useDeviceEvents(): void {
  const qc = useQueryClient()
  const setPresence = useDeviceStore((s) => s.setPresence)

  useEffect(() => {
    // Debounced refreshNewest per chat for events we don't patch directly.
    const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const scheduleRefresh = (jid: string) => {
      // Only bother for conversations that have been opened.
      if (!qc.getQueryData(deviceMessagesKey(jid))) return
      clearTimeout(refreshTimers.get(jid))
      refreshTimers.set(
        jid,
        setTimeout(() => {
          refreshTimers.delete(jid)
          void refreshNewest(qc, jid)
        }, 400)
      )
    }

    const unsubscribe = subscribeWs((event) => {
      switch (event.type) {
        case "message.new": {
          const { chat_jid, message } = event.data as MessageNewEvent
          if (!chat_jid || !message) return
          if (qc.getQueryData(deviceMessagesKey(chat_jid))) {
            if (hasMessage(qc, chat_jid, message.id)) {
              // Optimistic row already there — refresh it with the stored truth
              // (media ids, server timestamp), keeping the better receipt.
              patchMessage(qc, chat_jid, message.id, (m) => {
                const cur = m.receipt_status ? RECEIPT_ORDER[m.receipt_status] : 0
                const next = message.receipt_status ? RECEIPT_ORDER[message.receipt_status] : 0
                return { ...message, receipt_status: next >= cur ? message.receipt_status : m.receipt_status }
              })
            } else {
              appendMessage(qc, chat_jid, message)
            }
          }
          // Chat-list preview fields not carried by chat.updated.
          if (message.message_type !== "reaction") {
            const known = qc
              .getQueryData<Chat[]>(DEVICE_CHATS_KEY)
              ?.some((c) => c.jid === chat_jid)
            if (known) {
              patchChat(qc, chat_jid, {
                last_message_id: message.id,
                last_message_type: message.message_type,
                last_message_from_me: message.from_me,
                last_message_receipt_status: message.receipt_status,
              })
            } else {
              void qc.invalidateQueries({ queryKey: DEVICE_CHATS_KEY })
            }
          }
          return
        }

        case "chat.updated": {
          const { chat } = event.data as { chat: Chat }
          if (chat?.jid) upsertChat(qc, chat)
          return
        }

        case "message.receipt": {
          const r = event.data as MessageReceiptEvent
          if (!r?.message_id || !r.chat_jid) return
          if (qc.getQueryData(deviceMessagesKey(r.chat_jid))) {
            patchReceipt(qc, r.chat_jid, r.message_id, r.receipt_status)
          }
          // Upgrade the chat-list tick when it's the previewed message.
          const chat = qc.getQueryData<Chat[]>(DEVICE_CHATS_KEY)?.find((c) => c.jid === r.chat_jid)
          if (chat?.last_message_id === r.message_id) {
            const cur = chat.last_message_receipt_status
              ? RECEIPT_ORDER[chat.last_message_receipt_status]
              : 0
            if (RECEIPT_ORDER[r.receipt_status] > cur) {
              patchChat(qc, r.chat_jid, { last_message_receipt_status: r.receipt_status })
            }
          }
          return
        }

        case "wa.messages.update": {
          // Edits / deletes / transcriptions — re-pull the newest page of the
          // affected chats rather than mapping raw Baileys protos client-side.
          const updates = event.data as Array<{ key?: { remoteJid?: string } }>
          if (!Array.isArray(updates)) return
          for (const u of updates) {
            if (u?.key?.remoteJid) scheduleRefresh(u.key.remoteJid)
          }
          return
        }

        case "wa.presence.update": {
          const data = event.data as PresenceUpdateEvent
          if (!data?.id || !data.presences) return
          const entries = Object.entries(data.presences)
          if (entries.length === 0) return
          // Prefer an actively typing/recording participant.
          const active =
            entries.find(([, p]) =>
              ["composing", "recording"].includes(p.lastKnownPresence ?? "")
            ) ?? entries[0]
          const [participant, p] = active
          setPresence(data.id, {
            status: p.lastKnownPresence,
            lastSeen: p.lastSeen,
            participant,
          })
          return
        }

      }
    })

    return () => {
      unsubscribe()
      for (const t of refreshTimers.values()) clearTimeout(t)
    }
  }, [qc, setPresence])
}
