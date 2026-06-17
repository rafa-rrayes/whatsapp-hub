import type { HubEvent } from "@/lib/types"

type Listener = (event: HubEvent) => void

// Module-level fan-out for raw WebSocket events. The device view subscribes
// here so it receives every event regardless of the Events page pause state.
const listeners = new Set<Listener>()

export function subscribeWs(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitWs(event: HubEvent): void {
  for (const fn of listeners) {
    try {
      fn(event)
    } catch (err) {
      console.error("[ws-bus] listener error", err)
    }
  }
}
