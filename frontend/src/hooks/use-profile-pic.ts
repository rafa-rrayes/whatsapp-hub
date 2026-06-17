import { useEffect, useState } from "react"
import { useAuthStore } from "@/stores/auth"

// Module-level cache: jid → objectURL (or null when the contact has no
// picture). Object URLs live for the session; ~400 avatars is a few MB.
const cache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()
const MAX_ENTRIES = 400

// Gentle concurrency cap: the hub API allows 200 req/min and an avatar miss
// costs an upstream WhatsApp call, so scrolling a long list must trickle.
const MAX_CONCURRENT = 3
let active = 0
const queue: Array<() => void> = []

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return
  }
  await new Promise<void>((resolve) => queue.push(resolve))
  active++
}

function releaseSlot(): void {
  active--
  queue.shift()?.()
}

async function fetchAvatar(jid: string): Promise<string | null> {
  const existing = inflight.get(jid)
  if (existing) return existing

  const task = (async () => {
    await acquireSlot()
    try {
      const apiKey = useAuthStore.getState().apiKey
      const res = await fetch(`/api/avatar/${encodeURIComponent(jid)}`, {
        headers: apiKey ? { "x-api-key": apiKey } : undefined,
      })
      if (!res.ok) return null
      const blob = await res.blob()
      return URL.createObjectURL(blob)
    } catch {
      return null
    } finally {
      releaseSlot()
      inflight.delete(jid)
    }
  })()

  inflight.set(jid, task)
  const url = await task
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) {
      const old = cache.get(oldest)
      if (old) URL.revokeObjectURL(old)
      cache.delete(oldest)
    }
  }
  cache.set(jid, url)
  return url
}

/** Profile picture as an objectURL, or null when none / still loading. */
export function useProfilePic(jid?: string): string | null {
  const [state, setState] = useState<{ jid?: string; url: string | null }>(() => ({
    jid,
    url: jid ? cache.get(jid) ?? null : null,
  }))

  // Render-time adjustment when the jid prop changes (avoids an effect flash).
  if (state.jid !== jid) {
    setState({ jid, url: jid ? cache.get(jid) ?? null : null })
  }

  useEffect(() => {
    if (!jid || cache.has(jid)) return
    let cancelled = false
    fetchAvatar(jid).then((url) => {
      if (!cancelled) setState((s) => (s.jid === jid ? { jid, url } : s))
    })
    return () => {
      cancelled = true
    }
  }, [jid])

  return state.url
}
