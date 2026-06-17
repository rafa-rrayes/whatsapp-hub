import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { toast } from "sonner"
import type { Message } from "@/lib/types"
import {
  appendMessage,
  patchMessage,
  replaceTempMessage,
  type DeviceMessage,
} from "@/hooks/use-device-messages"
import { patchChat } from "@/hooks/use-device-chats"

interface SendResult {
  success: boolean
  key: { id: string; remoteJid: string; fromMe: boolean }
}

/** Local-preview URL for optimistic media bubbles. */
export type OptimisticMessage = DeviceMessage & { _localUrl?: string }

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function makeTempMessage(jid: string, fields: Partial<Message>): OptimisticMessage {
  return {
    id: `temp-${crypto.randomUUID()}`,
    remote_jid: jid,
    from_me: true,
    timestamp: nowSeconds(),
    message_type: "text",
    is_forwarded: false,
    forward_score: 0,
    is_starred: false,
    is_broadcast: false,
    is_ephemeral: false,
    edit_type: 0,
    is_deleted: false,
    has_media: false,
    created_at: new Date().toISOString(),
    ...fields,
  }
}

/** Update the chat-list preview for an outgoing message. */
function bumpOwnPreview(qc: QueryClient, jid: string, m: OptimisticMessage): void {
  patchChat(qc, jid, {
    last_message_ts: m.timestamp,
    last_message_body: m.body ?? undefined,
    last_message_id: m.id,
    last_message_type: m.message_type,
    last_message_from_me: true,
    last_message_receipt_status: undefined,
  })
}

async function dispatch(
  qc: QueryClient,
  jid: string,
  temp: OptimisticMessage,
  post: () => Promise<SendResult>
): Promise<void> {
  appendMessage(qc, jid, temp)
  bumpOwnPreview(qc, jid, temp)
  try {
    const res = await post()
    replaceTempMessage(qc, jid, temp.id, { ...temp, id: res.key.id })
    patchChat(qc, jid, { last_message_id: res.key.id })
  } catch (err) {
    patchMessage(qc, jid, temp.id, { _failed: true })
    toast.error(err instanceof Error ? err.message : "Failed to send message")
  }
}

export async function sendTextMessage(
  qc: QueryClient,
  jid: string,
  text: string,
  quoted?: Message | null
): Promise<void> {
  const temp = makeTempMessage(jid, {
    body: text,
    quoted_id: quoted?.id,
    quoted_body: quoted?.body,
  })
  await dispatch(qc, jid, temp, () =>
    api.post<SendResult>("/api/actions/send/text", {
      jid,
      text,
      quoted_id: quoted?.id,
    })
  )
}

export interface MediaSendInput {
  kind: "image" | "video" | "document" | "audio"
  base64: string
  mimeType: string
  caption?: string
  filename?: string
  /** objectURL of the local file for the optimistic bubble */
  localUrl?: string
  ptt?: boolean
}

export async function sendMediaMessage(
  qc: QueryClient,
  jid: string,
  input: MediaSendInput
): Promise<void> {
  const typeMap = { image: "image", video: "video", document: "document", audio: "audio" } as const
  const temp = makeTempMessage(jid, {
    message_type: typeMap[input.kind],
    body: input.caption,
    has_media: true,
    media_mime_type: input.mimeType,
    media_filename: input.filename,
  })
  ;(temp as OptimisticMessage)._localUrl = input.localUrl

  const post = () => {
    switch (input.kind) {
      case "image":
        return api.post<SendResult>("/api/actions/send/image", {
          jid,
          base64: input.base64,
          caption: input.caption,
          mime_type: input.mimeType,
        })
      case "video":
        return api.post<SendResult>("/api/actions/send/video", {
          jid,
          base64: input.base64,
          caption: input.caption,
        })
      case "document":
        return api.post<SendResult>("/api/actions/send/document", {
          jid,
          base64: input.base64,
          filename: input.filename || "file",
          mime_type: input.mimeType,
          caption: input.caption,
        })
      case "audio":
        return api.post<SendResult>("/api/actions/send/audio", {
          jid,
          base64: input.base64,
          ptt: input.ptt,
        })
    }
  }
  await dispatch(qc, jid, temp, post)
}

/** Re-send a failed optimistic text message. */
export async function retrySendText(qc: QueryClient, jid: string, failed: DeviceMessage): Promise<void> {
  patchMessage(qc, jid, failed.id, { _failed: false })
  try {
    const res = await api.post<SendResult>("/api/actions/send/text", {
      jid,
      text: failed.body ?? "",
      quoted_id: failed.quoted_id,
    })
    replaceTempMessage(qc, jid, failed.id, { ...failed, _failed: false, id: res.key.id })
  } catch (err) {
    patchMessage(qc, jid, failed.id, { _failed: true })
    toast.error(err instanceof Error ? err.message : "Failed to send message")
  }
}

export async function sendReaction(
  qc: QueryClient,
  jid: string,
  targetId: string,
  emoji: string
): Promise<void> {
  // Optimistic synthetic reaction row; the flatten keeps latest-per-sender.
  appendMessage(qc, jid, {
    ...makeTempMessage(jid, {
      message_type: "reaction",
      reaction_emoji: emoji,
      reaction_target_id: targetId,
    }),
  })
  try {
    await api.post("/api/actions/react", { jid, message_id: targetId, emoji: emoji || "" })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to react")
  }
}

export function useChatJidClient(): QueryClient {
  return useQueryClient()
}
