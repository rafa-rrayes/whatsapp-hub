import { create } from "zustand"

export type SyncScope = "all" | "chat"

/** Per-chat row in the progress panel. Binary: pending → done (one on-demand batch per request). */
export interface SyncChatRow {
  jid: string
  received: number
  done: boolean
}

// ── WebSocket event payloads (mirror src/events/sync-progress.ts) ─────────────
export interface SyncStartedEvent { sessionId: string; scope: SyncScope; total: number; count: number }
export interface SyncRequestedEvent {
  sessionId: string
  jid: string
  didRequest: boolean
  processed: number
  total: number
  requested: number
  skipped: number
}
export interface SyncReceivedEvent { jid: string; count: number }
export interface SyncFinishedEvent { sessionId: string; requested: number; skipped: number; total: number }

interface SyncProgressState {
  active: boolean
  scope: SyncScope | null
  sessionId: string | null
  total: number
  count: number
  processed: number
  requested: number
  skipped: number
  requestingDone: boolean
  chats: Record<string, SyncChatRow>

  /** Optimistically open the panel on button click, before the `started` event arrives. */
  begin: (scope: SyncScope) => void
  onStarted: (p: SyncStartedEvent) => void
  onRequested: (p: SyncRequestedEvent) => void
  onReceived: (p: SyncReceivedEvent) => void
  onFinished: (p: SyncFinishedEvent) => void
  close: () => void
}

const initial = {
  active: false,
  scope: null as SyncScope | null,
  sessionId: null as string | null,
  total: 0,
  count: 0,
  processed: 0,
  requested: 0,
  skipped: 0,
  requestingDone: false,
  chats: {} as Record<string, SyncChatRow>,
}

export const useSyncProgressStore = create<SyncProgressState>((set) => ({
  ...initial,

  begin: (scope) => set({ ...initial, active: true, scope }),

  onStarted: ({ sessionId, scope, total, count }) =>
    set({ ...initial, active: true, sessionId, scope, total, count }),

  onRequested: ({ jid, didRequest, processed, total, requested, skipped }) =>
    set((s) => {
      const chats = { ...s.chats }
      // Add a pending row as soon as a chat is requested (received may arrive later).
      if (didRequest && !chats[jid]) {
        chats[jid] = { jid, received: 0, done: false }
      }
      return { active: true, processed, total, requested, skipped, chats }
    }),

  onReceived: ({ jid, count }) =>
    set((s) => {
      // Ignore stray history batches when no panel is open (e.g. MCP-triggered syncs).
      if (!s.active) return s
      const prev = s.chats[jid] ?? { jid, received: 0, done: false }
      return {
        chats: { ...s.chats, [jid]: { jid, received: prev.received + count, done: true } },
      }
    }),

  onFinished: ({ requested, skipped, total }) =>
    // The request loop is done — no further requests will fire. WhatsApp sends history
    // responses asynchronously and gives no per-chat "complete" signal, and chats with
    // no older messages never produce a `received` event at all. So settle every
    // outstanding row here instead of leaving it spinning "pending" forever; late
    // receipts still increment `received` via onReceived (which keeps done: true).
    set((s) => {
      const chats: Record<string, SyncChatRow> = {}
      for (const [jid, r] of Object.entries(s.chats)) {
        chats[jid] = r.done ? r : { ...r, done: true }
      }
      return { requested, skipped, total, requestingDone: true, chats }
    }),

  close: () => set({ ...initial }),
}))
