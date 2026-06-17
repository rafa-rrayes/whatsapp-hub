import { useMemo } from "react"
import {
  useInfiniteQuery,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Message } from "@/lib/types"

const PAGE_SIZE = 50

interface MessagesPage {
  data: Message[]
  total: number
}

type MessagesData = InfiniteData<MessagesPage, number | undefined>

/** Frontend-only send state riding on the Message shape. */
export type DeviceMessage = Message & { _failed?: boolean }

export function isTempId(id: string): boolean {
  return id.startsWith("temp-")
}

export function deviceMessagesKey(jid: string) {
  return ["device-messages", jid] as const
}

async function fetchPage(jid: string, before?: number): Promise<MessagesPage> {
  const cursor = before ? `&before=${before}` : ""
  return api.get<MessagesPage>(
    `/api/messages?chat=${encodeURIComponent(jid)}&order=desc&limit=${PAGE_SIZE}${cursor}`
  )
}

export interface ReactionChip {
  emoji: string
  count: number
  mine: boolean
}

export type ConversationItem =
  | { kind: "divider"; key: string; ts: number }
  | { kind: "unread"; key: string }
  | {
      kind: "message"
      key: string
      message: DeviceMessage
      /** First bubble of a same-sender run — gets the tail. */
      firstOfGroup: boolean
      reactions?: ReactionChip[]
      /** My current reaction emoji on this message, if any. */
      myReaction?: string
    }

function senderKey(m: Message): string {
  if (m.from_me) return "me"
  return m.participant || m.from_jid || m.remote_jid
}

function dayKey(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * Conversation messages, oldest page last. `initialUnread` is the unread count
 * snapshotted when the chat was opened — used to place the unread marker
 * (it must not move when the badge is zeroed by mark-as-read).
 */
export function useDeviceMessages(jid: string, initialUnread: number) {
  const query = useInfiniteQuery({
    queryKey: deviceMessagesKey(jid),
    queryFn: ({ pageParam }) => fetchPage(jid, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage, allPages, lastPageParam) => {
      if (lastPage.data.length < PAGE_SIZE) return undefined
      // `before` is strict <, so the cursor minTs+1 re-includes boundary-second
      // rows; the flatten dedupes them. Stop when a page brings nothing new or
      // the cursor stops advancing (>50 rows in one second — pathological).
      const seen = new Set(allPages.slice(0, -1).flatMap((p) => p.data.map((m) => m.id)))
      if (lastPage.data.every((m) => seen.has(m.id))) return undefined
      const minTs = Math.min(...lastPage.data.map((m) => m.timestamp))
      const cursor = minTs + 1
      if (lastPageParam !== undefined && cursor >= lastPageParam) return undefined
      return cursor
    },
    staleTime: Infinity, // WS patches own this cache
    enabled: Boolean(jid),
  })

  const items = useMemo<ConversationItem[]>(() => {
    const pages = query.data?.pages ?? []
    const byId = new Map<string, DeviceMessage>()
    for (const page of pages) {
      for (const m of page.data) {
        if (!byId.has(m.id)) byId.set(m.id, m)
      }
    }

    // Split reaction rows out: latest reaction per (target, sender) wins;
    // empty emoji = reaction removed.
    const latestReaction = new Map<string, Map<string, Message>>()
    const messages: DeviceMessage[] = []
    for (const m of byId.values()) {
      if (m.message_type === "reaction" && m.reaction_target_id) {
        const inner = latestReaction.get(m.reaction_target_id) ?? new Map<string, Message>()
        const prev = inner.get(senderKey(m))
        if (!prev || m.timestamp >= prev.timestamp) inner.set(senderKey(m), m)
        latestReaction.set(m.reaction_target_id, inner)
        continue
      }
      if (m.message_type === "poll_update") continue
      messages.push(m)
    }

    messages.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))

    const chips = new Map<string, { list: ReactionChip[]; mine?: string }>()
    for (const [target, bySender] of latestReaction) {
      const counts = new Map<string, { count: number; mine: boolean }>()
      let mine: string | undefined
      for (const [sender, row] of bySender) {
        const emoji = row.reaction_emoji ?? ""
        if (!emoji) continue
        const entry = counts.get(emoji) ?? { count: 0, mine: false }
        entry.count++
        if (sender === "me") {
          entry.mine = true
          mine = emoji
        }
        counts.set(emoji, entry)
      }
      if (counts.size > 0) {
        chips.set(target, {
          list: [...counts.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
          mine,
        })
      }
    }

    // Unread marker goes right before the last `initialUnread` incoming messages.
    let unreadMarkerIndex = -1
    if (initialUnread > 0) {
      let remaining = initialUnread
      for (let i = messages.length - 1; i >= 0; i--) {
        if (!messages[i].from_me) {
          remaining--
          if (remaining === 0) {
            unreadMarkerIndex = i
            break
          }
        }
      }
    }

    const out: ConversationItem[] = []
    let prevDay = ""
    let prevSender = ""
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      const day = dayKey(m.timestamp)
      if (day !== prevDay) {
        out.push({ kind: "divider", key: `day-${day}`, ts: m.timestamp })
        prevDay = day
        prevSender = ""
      }
      if (i === unreadMarkerIndex) {
        out.push({ kind: "unread", key: "unread-marker" })
        prevSender = ""
      }
      const sk = senderKey(m)
      const reaction = chips.get(m.id)
      out.push({
        kind: "message",
        key: m.id,
        message: m,
        firstOfGroup: sk !== prevSender,
        reactions: reaction?.list,
        myReaction: reaction?.mine,
      })
      prevSender = sk
    }
    return out
  }, [query.data, initialUnread])

  return { ...query, items }
}

// ── Cache mutators (used by sends and the WS event wiring) ─────────────────

function mutate(qc: QueryClient, jid: string, fn: (old: MessagesData) => MessagesData): void {
  qc.setQueryData<MessagesData>(deviceMessagesKey(jid), (old) => (old ? fn(old) : old))
}

/** True if the message id exists anywhere in the cached pages. */
export function hasMessage(qc: QueryClient, jid: string, id: string): boolean {
  const data = qc.getQueryData<MessagesData>(deviceMessagesKey(jid))
  return Boolean(data?.pages.some((p) => p.data.some((m) => m.id === id)))
}

/** Prepend a new message to the newest page (id-deduped). */
export function appendMessage(qc: QueryClient, jid: string, message: DeviceMessage): void {
  mutate(qc, jid, (old) => {
    if (old.pages.some((p) => p.data.some((m) => m.id === message.id))) return old
    const pages = old.pages.slice()
    const first = pages[0] ?? { data: [], total: 0 }
    pages[0] = { ...first, data: [message, ...first.data], total: first.total + 1 }
    return { ...old, pages }
  })
}

/** Merge a partial patch into a message wherever it lives. */
export function patchMessage(
  qc: QueryClient,
  jid: string,
  id: string,
  patch: Partial<DeviceMessage> | ((m: DeviceMessage) => Partial<DeviceMessage>)
): void {
  mutate(qc, jid, (old) => ({
    ...old,
    pages: old.pages.map((p) => ({
      ...p,
      data: p.data.map((m) =>
        m.id === id ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m
      ),
    })),
  }))
}

const RECEIPT_ORDER: Record<string, number> = { sent: 1, delivered: 2, read: 3, played: 4 }

/** Upgrade-only receipt merge (never downgrades read → delivered). */
export function patchReceipt(
  qc: QueryClient,
  jid: string,
  id: string,
  status: "sent" | "delivered" | "read" | "played"
): void {
  patchMessage(qc, jid, id, (m) => {
    const cur = m.receipt_status ? RECEIPT_ORDER[m.receipt_status] : 0
    return RECEIPT_ORDER[status] > cur ? { receipt_status: status } : {}
  })
}

/** Swap an optimistic temp message for the server-confirmed one. */
export function replaceTempMessage(
  qc: QueryClient,
  jid: string,
  tempId: string,
  real: DeviceMessage
): void {
  mutate(qc, jid, (old) => {
    // The real message may have raced in over the WS already — then just drop the temp.
    const realExists = old.pages.some((p) => p.data.some((m) => m.id === real.id))
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        data: realExists
          ? p.data.filter((m) => m.id !== tempId)
          : p.data.map((m) => (m.id === tempId ? real : m)),
      })),
    }
  })
}

export function removeMessage(qc: QueryClient, jid: string, id: string): void {
  mutate(qc, jid, (old) => ({
    ...old,
    pages: old.pages.map((p) => ({ ...p, data: p.data.filter((m) => m.id !== id) })),
  }))
}

/** Append a reaction row; the flatten aggregates it (latest per sender wins). */
export function applyReactionRow(qc: QueryClient, jid: string, row: Message): void {
  appendMessage(qc, jid, row)
}

/**
 * Pull the newest 50 and merge: unknown rows are prepended, known rows are
 * refreshed in place (edits, deletes, transcriptions). Fallback for events the
 * patch handlers don't cover.
 */
export async function refreshNewest(qc: QueryClient, jid: string): Promise<void> {
  const fresh = await fetchPage(jid)
  mutate(qc, jid, (old) => {
    const known = new Set(old.pages.flatMap((p) => p.data.map((m) => m.id)))
    const newRows = fresh.data.filter((m) => !known.has(m.id))
    const freshById = new Map(fresh.data.map((m) => [m.id, m]))
    const pages = old.pages.map((p) => ({
      ...p,
      data: p.data.map((m) => {
        const updated = freshById.get(m.id)
        // Keep client-side receipt state if it's ahead of the server row.
        if (!updated) return m
        const cur = m.receipt_status ? RECEIPT_ORDER[m.receipt_status] : 0
        const next = updated.receipt_status ? RECEIPT_ORDER[updated.receipt_status] : 0
        return { ...m, ...updated, receipt_status: next >= cur ? updated.receipt_status : m.receipt_status }
      }),
    }))
    if (newRows.length > 0) {
      const first = pages[0] ?? { data: [], total: 0 }
      pages[0] = { ...first, data: [...newRows, ...first.data], total: first.total + newRows.length }
    }
    return { ...old, pages }
  })
}
