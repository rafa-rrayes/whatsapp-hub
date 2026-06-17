import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Chat } from "@/lib/types"

export const DEVICE_CHATS_KEY = ["device-chats"] as const

async function fetchAllChats(): Promise<Chat[]> {
  const all: Chat[] = []
  let offset = 0
  for (;;) {
    const page = await api.get<{ data: Chat[]; total: number }>(
      `/api/chats?limit=500&offset=${offset}`
    )
    all.push(...page.data)
    if (page.data.length < 500) break
    offset += 500
  }
  return all
}

export function useDeviceChats() {
  return useQuery({
    queryKey: DEVICE_CHATS_KEY,
    queryFn: fetchAllChats,
    staleTime: 30_000,
    refetchInterval: 60_000, // safety net under the WS patches
  })
}

/** Merge a partial update into one chat in the cache (no refetch). */
export function patchChat(qc: QueryClient, jid: string, patch: Partial<Chat>): boolean {
  let found = false
  qc.setQueryData<Chat[]>(DEVICE_CHATS_KEY, (old) => {
    if (!old) return old
    return old.map((c) => {
      if (c.jid !== jid) return c
      found = true
      return { ...c, ...patch }
    })
  })
  return found
}

/** Replace or insert a full chat row (server-shaped) in the cache. */
export function upsertChat(qc: QueryClient, chat: Chat): void {
  qc.setQueryData<Chat[]>(DEVICE_CHATS_KEY, (old) => {
    if (!old) return old
    const idx = old.findIndex((c) => c.jid === chat.jid)
    if (idx === -1) return [chat, ...old]
    const next = old.slice()
    next[idx] = { ...next[idx], ...chat }
    return next
  })
}

export function useMarkChatRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jid: string) =>
      api.post<{ success: boolean; read_count: number }>(
        `/api/chats/${encodeURIComponent(jid)}/read`,
        {}
      ),
    onMutate: async (jid) => {
      patchChat(qc, jid, { unread_count: 0 })
    },
  })
}

export function useArchiveChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jid, archived }: { jid: string; archived: boolean }) =>
      api.post(`/api/chats/${encodeURIComponent(jid)}/archive`, { archived }),
    onMutate: async ({ jid, archived }) => {
      patchChat(qc, jid, { is_archived: archived })
    },
    onError: (_e, { jid, archived }) => {
      patchChat(qc, jid, { is_archived: !archived })
    },
  })
}

export function usePinChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jid, pinned }: { jid: string; pinned: boolean }) =>
      api.post(`/api/chats/${encodeURIComponent(jid)}/pin`, { pinned }),
    onMutate: async ({ jid, pinned }) => {
      patchChat(qc, jid, { is_pinned: pinned })
    },
    onError: (_e, { jid, pinned }) => {
      patchChat(qc, jid, { is_pinned: !pinned })
    },
  })
}

export function useMuteChat() {
  const qc = useQueryClient()
  return useMutation({
    // until: absolute epoch-ms, or null to unmute
    mutationFn: ({ jid, until }: { jid: string; until: number | null }) =>
      api.post(`/api/chats/${encodeURIComponent(jid)}/mute`, { until }),
    onMutate: async ({ jid, until }) => {
      patchChat(qc, jid, { is_muted: until !== null, mute_expiry: until ?? undefined })
    },
  })
}
