import { create } from "zustand"
import type { HubEvent } from "@/lib/types"

interface WebSocketState {
  status: "disconnected" | "connecting" | "connected" | "error"
  eventCount: number
  recentEvents: HubEvent[]
  paused: boolean
  setStatus: (status: WebSocketState["status"]) => void
  addEvent: (event: HubEvent) => void
  incrementCount: () => void
  togglePaused: () => void
  clearEvents: () => void
}

export const useWebSocketStore = create<WebSocketState>((set) => ({
  status: "disconnected",
  eventCount: 0,
  recentEvents: [],
  paused: false,
  setStatus: (status) => set({ status }),
  addEvent: (event) =>
    set((state) => ({
      recentEvents: [event, ...state.recentEvents].slice(0, 50),
      eventCount: state.eventCount + 1,
    })),
  incrementCount: () => set((state) => ({ eventCount: state.eventCount + 1 })),
  togglePaused: () => set((state) => ({ paused: !state.paused })),
  clearEvents: () => set({ recentEvents: [], eventCount: 0 }),
}))
