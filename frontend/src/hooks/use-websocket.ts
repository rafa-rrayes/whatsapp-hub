import { useEffect, useRef } from "react"
import { useAuthStore } from "@/stores/auth"
import { useWebSocketStore } from "@/stores/websocket"
import { useQueryClient } from "@tanstack/react-query"
import type { HubEvent } from "@/lib/types"

const MAX_RETRIES = 10

async function fetchTicket(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch("/api/ws/ticket", {
      method: "POST",
      headers: { "x-api-key": apiKey },
    })
    if (res.ok) {
      const data = await res.json()
      return data.ticket as string
    }
    // 404 means feature not enabled on server
    return null
  } catch {
    return null
  }
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const retryCountRef = useRef(0)
  const apiKey = useAuthStore((s) => s.apiKey)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const setStatus = useWebSocketStore((s) => s.setStatus)
  const addEvent = useWebSocketStore((s) => s.addEvent)
  const paused = useWebSocketStore((s) => s.paused)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!isAuthenticated || !apiKey) return

    async function connect() {
      if (retryCountRef.current >= MAX_RETRIES) {
        setStatus("error")
        return
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const host = window.location.host

      // Try ticket-based auth first, fall back to query param
      const ticket = await fetchTicket(apiKey)
      let wsUrl: string
      if (ticket) {
        wsUrl = `${protocol}//${host}/ws?ticket=${encodeURIComponent(ticket)}`
      } else {
        console.warn("[security] WebSocket ticket auth not available, falling back to query parameter. Enable SECURITY_WS_TICKET_AUTH=true on the server.")
        wsUrl = `${protocol}//${host}/ws?api_key=${encodeURIComponent(apiKey)}`
      }

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      setStatus("connecting")

      ws.onopen = () => {
        retryCountRef.current = 0
        setStatus("connected")
      }

      ws.onmessage = (e) => {
        if (paused) return
        try {
          const event: HubEvent = JSON.parse(e.data)
          addEvent(event)

          // Invalidate relevant queries based on event type
          if (event.type.startsWith("message.")) {
            queryClient.invalidateQueries({ queryKey: ["messages"] })
            queryClient.invalidateQueries({ queryKey: ["stats"] })
            queryClient.invalidateQueries({ queryKey: ["chats"] })
          } else if (event.type.startsWith("contact.")) {
            queryClient.invalidateQueries({ queryKey: ["contacts"] })
          } else if (event.type.startsWith("group.")) {
            queryClient.invalidateQueries({ queryKey: ["groups"] })
          } else if (event.type.startsWith("connection.")) {
            queryClient.invalidateQueries({ queryKey: ["connection"] })
          } else if (event.type.startsWith("media.")) {
            queryClient.invalidateQueries({ queryKey: ["media"] })
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onclose = () => {
        setStatus("disconnected")
        wsRef.current = null
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 60000)
        retryCountRef.current++
        reconnectTimerRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        setStatus("error")
        ws.close()
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimerRef.current)
      retryCountRef.current = 0
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
      setStatus("disconnected")
    }
  }, [isAuthenticated, apiKey, setStatus, addEvent, paused, queryClient])
}
