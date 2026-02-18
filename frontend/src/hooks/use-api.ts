import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type {
  ConnectionStatus,
  QRData,
  DashboardStats,
  MessageQueryResult,
  MessageStats,
  Contact,
  Group,
  Media,
  MediaStats,
  Webhook,
  EventLogEntry,
  EventTypeCount,
  Chat,
} from "@/lib/types"

// ─── Connection ───────────────────────────────────────────────

export function useConnectionStatus() {
  return useQuery({
    queryKey: ["connection", "status"],
    queryFn: () => api.get<ConnectionStatus>("/api/connection/status"),
    refetchInterval: 10_000,
  })
}

export function useQRCode(enabled: boolean) {
  return useQuery({
    queryKey: ["connection", "qr"],
    queryFn: () => api.get<QRData>("/api/connection/qr"),
    refetchInterval: 15_000,
    enabled,
  })
}

export function useRestartConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post("/api/connection/restart"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connection"] }),
  })
}

export function useNewQR() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post("/api/connection/new-qr"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connection"] }),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post("/api/connection/logout"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connection"] }),
  })
}

// ─── Stats ────────────────────────────────────────────────────

export function useDashboardStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => api.get<DashboardStats>("/api/stats"),
    refetchInterval: 30_000,
  })
}

// ─── Messages ─────────────────────────────────────────────────

export interface MessageQueryParams {
  chat?: string
  from?: string
  from_me?: string
  type?: string
  search?: string
  before?: string
  after?: string
  has_media?: string
  limit?: number
  offset?: number
  order?: "asc" | "desc"
}

export function useMessages(params: MessageQueryParams) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") searchParams.set(k, String(v))
  })
  const qs = searchParams.toString()
  return useQuery({
    queryKey: ["messages", params],
    queryFn: () => api.get<MessageQueryResult>(`/api/messages${qs ? `?${qs}` : ""}`),
  })
}

export function useMessageStats() {
  return useQuery({
    queryKey: ["messages", "stats"],
    queryFn: () => api.get<MessageStats>("/api/messages/stats"),
  })
}

// ─── Chats ────────────────────────────────────────────────────

export function useChats(params?: { search?: string; limit?: number }) {
  const searchParams = new URLSearchParams()
  if (params?.search) searchParams.set("search", params.search)
  if (params?.limit) searchParams.set("limit", String(params.limit))
  const qs = searchParams.toString()
  return useQuery({
    queryKey: ["chats", params],
    queryFn: () => api.get<{ data: Chat[]; total: number }>(`/api/chats${qs ? `?${qs}` : ""}`),
  })
}

// ─── Contacts ─────────────────────────────────────────────────

export function useContacts(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : ""
  return useQuery({
    queryKey: ["contacts", search],
    queryFn: () => api.get<{ data: Contact[]; total: number }>(`/api/contacts${qs}`),
  })
}

export function useContact(jid: string) {
  return useQuery({
    queryKey: ["contacts", jid],
    queryFn: () => api.get<Contact>(`/api/contacts/${encodeURIComponent(jid)}`),
    enabled: !!jid,
  })
}

// ─── Groups ───────────────────────────────────────────────────

export function useGroups(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : ""
  return useQuery({
    queryKey: ["groups", search],
    queryFn: () => api.get<{ data: Group[]; total: number }>(`/api/groups${qs}`),
  })
}

export function useSyncGroups() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ synced: number; failed: number; total: number }>("/api/groups/sync"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  })
}

export function useGroup(jid: string) {
  return useQuery({
    queryKey: ["groups", jid],
    queryFn: () => api.get<Group & { participants: Group["participants"] }>(
      `/api/groups/${encodeURIComponent(jid)}`
    ),
    enabled: !!jid,
  })
}

export function useGroupInviteCode(jid: string) {
  return useQuery({
    queryKey: ["groups", jid, "invite-code"],
    queryFn: () => api.get<{ code: string }>(`/api/groups/${encodeURIComponent(jid)}/invite-code`),
    enabled: !!jid,
  })
}

export function useUpdateGroupSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jid, subject }: { jid: string; subject: string }) =>
      api.put(`/api/groups/${encodeURIComponent(jid)}/subject`, { subject }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  })
}

export function useUpdateGroupDescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jid, description }: { jid: string; description: string }) =>
      api.put(`/api/groups/${encodeURIComponent(jid)}/description`, { description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  })
}

export function useGroupParticipants() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      jid,
      participants,
      action,
    }: {
      jid: string
      participants: string[]
      action: "add" | "remove" | "promote" | "demote"
    }) =>
      api.post(`/api/groups/${encodeURIComponent(jid)}/participants`, { participants, action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  })
}

// ─── Media ────────────────────────────────────────────────────

export function useMediaStats() {
  return useQuery({
    queryKey: ["media", "stats"],
    queryFn: () => api.get<MediaStats>("/api/media/stats"),
  })
}

export function useMediaItem(id: string) {
  return useQuery({
    queryKey: ["media", id],
    queryFn: () => api.get<Media>(`/api/media/${id}`),
    enabled: !!id,
  })
}

// ─── Webhooks ─────────────────────────────────────────────────

export function useWebhooks() {
  return useQuery({
    queryKey: ["webhooks"],
    queryFn: () => api.get<{ data: Webhook[] }>("/api/webhooks"),
  })
}

export function useCreateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { url: string; secret?: string; events?: string }) =>
      api.post("/api/webhooks", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  })
}

export function useDeleteWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/webhooks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  })
}

export function useToggleWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.put(`/api/webhooks/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  })
}

// ─── Events ───────────────────────────────────────────────────

export function useEvents(params: {
  type?: string
  limit?: number
  offset?: number
  after?: string
}) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") searchParams.set(k, String(v))
  })
  const qs = searchParams.toString()
  return useQuery({
    queryKey: ["events", params],
    queryFn: () =>
      api.get<{ data: EventLogEntry[] }>(`/api/stats/events${qs ? `?${qs}` : ""}`),
  })
}

export function useEventTypes() {
  return useQuery({
    queryKey: ["events", "types"],
    queryFn: () => api.get<{ data: EventTypeCount[] }>("/api/stats/events/types"),
  })
}

export function usePruneEvents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (days: number) =>
      api.delete<{ success: boolean; deleted: number }>(
        `/api/stats/events/prune?days=${days}`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] })
    },
  })
}

// ─── Actions ──────────────────────────────────────────────────

export function useSendText() {
  return useMutation({
    mutationFn: (data: { jid: string; text: string; quoted_id?: string }) =>
      api.post("/api/actions/send/text", data),
  })
}

export function useSendImage() {
  return useMutation({
    mutationFn: (data: { jid: string; url?: string; base64?: string; caption?: string }) =>
      api.post("/api/actions/send/image", data),
  })
}

export function useSendDocument() {
  return useMutation({
    mutationFn: (data: {
      jid: string
      url?: string
      base64?: string
      filename: string
      mime_type: string
      caption?: string
    }) => api.post("/api/actions/send/document", data),
  })
}

export function useSendAudio() {
  return useMutation({
    mutationFn: (data: { jid: string; url?: string; base64?: string; ptt?: boolean }) =>
      api.post("/api/actions/send/audio", data),
  })
}

export function useSendVideo() {
  return useMutation({
    mutationFn: (data: { jid: string; url?: string; base64?: string; caption?: string }) =>
      api.post("/api/actions/send/video", data),
  })
}

export function useSendSticker() {
  return useMutation({
    mutationFn: (data: { jid: string; url?: string; base64?: string }) =>
      api.post("/api/actions/send/sticker", data),
  })
}

export function useSendLocation() {
  return useMutation({
    mutationFn: (data: {
      jid: string
      latitude: number
      longitude: number
      name?: string
      address?: string
    }) => api.post("/api/actions/send/location", data),
  })
}

export function useSendContact() {
  return useMutation({
    mutationFn: (data: { jid: string; contact_jid: string; name: string }) =>
      api.post("/api/actions/send/contact", data),
  })
}

export function useReact() {
  return useMutation({
    mutationFn: (data: { jid: string; message_id: string; emoji: string }) =>
      api.post("/api/actions/react", data),
  })
}

export function useMarkRead() {
  return useMutation({
    mutationFn: (data: { jid: string; message_ids: string[] }) =>
      api.post("/api/actions/read", data),
  })
}

export function useSendPresence() {
  return useMutation({
    mutationFn: (data: { type: string; jid?: string }) =>
      api.post("/api/actions/presence", data),
  })
}

export function useUpdateProfileStatus() {
  return useMutation({
    mutationFn: (data: { status: string }) =>
      api.put("/api/actions/profile-status", data),
  })
}
