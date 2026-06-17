import { useEffect, useState } from "react"
import { useAuthStore } from "@/stores/auth"

// LRU of media objectURLs. Entries are revoked on evict; Virtuoso only mounts
// visible bubbles, so ~150 entries comfortably covers a long scroll session.
const MAX_ENTRIES = 150
const cache = new Map<string, string>() // insertion order = recency
const inflight = new Map<string, Promise<string | null>>()

function touch(id: string, url: string): void {
  cache.delete(id)
  cache.set(id, url)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    URL.revokeObjectURL(cache.get(oldest)!)
    cache.delete(oldest)
  }
}

async function fetchMedia(mediaId: string): Promise<string | null> {
  const existing = inflight.get(mediaId)
  if (existing) return existing

  const task = (async () => {
    try {
      const apiKey = useAuthStore.getState().apiKey
      const res = await fetch(`/api/media/${encodeURIComponent(mediaId)}/download`, {
        headers: apiKey ? { "x-api-key": apiKey } : undefined,
      })
      if (!res.ok) return null
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      touch(mediaId, url)
      return url
    } catch {
      return null
    } finally {
      inflight.delete(mediaId)
    }
  })()

  inflight.set(mediaId, task)
  return task
}

export interface MediaBlobState {
  url: string | null
  loading: boolean
  failed: boolean
}

/** Authenticated media bytes as an objectURL (LRU-cached). */
export function useMediaBlob(mediaId?: string, enabled = true): MediaBlobState {
  const key = enabled ? mediaId : undefined
  const [state, setState] = useState<{ key?: string; value: MediaBlobState }>(() => {
    const hit = key ? cache.get(key) : undefined
    return { key, value: { url: hit ?? null, loading: Boolean(key && !hit), failed: false } }
  })

  // Render-time adjustment when the media id changes.
  if (state.key !== key) {
    const hit = key ? cache.get(key) : undefined
    setState({ key, value: { url: hit ?? null, loading: Boolean(key && !hit), failed: false } })
  }

  useEffect(() => {
    if (!key) return
    const hit = cache.get(key)
    if (hit) {
      touch(key, hit)
      return
    }
    let cancelled = false
    fetchMedia(key).then((url) => {
      if (!cancelled) {
        setState((s) =>
          s.key === key ? { key, value: { url, loading: false, failed: url === null } } : s
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return state.value
}

/** Imperative variant for downloads (e.g. "Save as" menu actions). */
export async function getMediaBlobUrl(mediaId: string): Promise<string | null> {
  return cache.get(mediaId) ?? fetchMedia(mediaId)
}
