import { useEffect, useRef } from "react"
import { useAuthStore } from "@/stores/auth"
import { useWebSocketStore } from "@/stores/websocket"
import { useQueryClient } from "@tanstack/react-query"
import type { HubEvent } from "@/lib/types"

const MAX_RETRIES = 10

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

    function connect() {
      if (retryCountRef.current >= MAX_RETRIES) {
        setStatus("error")
        return
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const host = window.location.host
      const ws = new WebSocket(`${protocol}//${host}/ws?api_key=${encodeURIComponent(apiKey)}`)
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
