import { format, isToday, isYesterday, isThisWeek, isThisYear } from "date-fns"
import type { Chat, Message } from "@/lib/types"

/** Chat-list row time: HH:mm today, "Yesterday", weekday this week, else date. */
export function formatListTime(ts?: number): string {
  if (!ts) return ""
  const date = new Date(ts * 1000)
  if (isToday(date)) return format(date, "HH:mm")
  if (isYesterday(date)) return "Yesterday"
  if (isThisWeek(date)) return format(date, "EEEE")
  return format(date, "dd/MM/yyyy")
}

export function formatBubbleTime(ts: number): string {
  return format(new Date(ts * 1000), "HH:mm")
}

export function formatDayDivider(ts: number): string {
  const date = new Date(ts * 1000)
  if (isToday(date)) return "Today"
  if (isYesterday(date)) return "Yesterday"
  if (isThisWeek(date)) return format(date, "EEEE")
  if (isThisYear(date)) return format(date, "d MMMM")
  return format(date, "d MMMM yyyy")
}

export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

export function formatLastSeen(ts?: number | null): string {
  if (!ts) return ""
  const date = new Date(ts * 1000)
  if (isToday(date)) return `last seen today at ${format(date, "HH:mm")}`
  if (isYesterday(date)) return `last seen yesterday at ${format(date, "HH:mm")}`
  return `last seen ${format(date, "dd/MM/yyyy")} at ${format(date, "HH:mm")}`
}

const URL_RE = /(https?:\/\/[^\s<]+)/g

/** Split text into alternating [text, url, text, ...] segments for rendering. */
export function linkify(text: string): Array<{ type: "text" | "link"; value: string }> {
  const out: Array<{ type: "text" | "link"; value: string }> = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    if (m.index! > last) out.push({ type: "text", value: text.slice(last, m.index) })
    out.push({ type: "link", value: m[0] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) })
  return out
}

// WhatsApp's group-sender name palette
const SENDER_COLORS = [
  "#53bdeb", "#06cf9c", "#e542a3", "#ffbc38", "#7f66ff",
  "#fa6533", "#91ab01", "#02a698", "#f15c6d", "#9368cf",
]

export function senderColor(jid: string): string {
  let hash = 0
  for (let i = 0; i < jid.length; i++) {
    hash = (hash * 31 + jid.charCodeAt(i)) | 0
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length]
}

const TYPE_GLYPHS: Record<string, string> = {
  image: "📷 Photo",
  video: "🎥 Video",
  audio: "🎤 Voice message",
  sticker: "💟 Sticker",
  document: "📄 Document",
  location: "📍 Location",
  contact: "👤 Contact",
  poll: "📊 Poll",
  call_log: "📞 Call",
}

/** Chat-list preview text for the latest message. */
export function previewText(chat: Chat): string {
  const type = chat.last_message_type
  const body = chat.last_message_body
  if (type && type !== "text" && type !== "extended_text" && TYPE_GLYPHS[type]) {
    return body ? `${TYPE_GLYPHS[type].split(" ")[0]} ${body}` : TYPE_GLYPHS[type]
  }
  return body ?? ""
}

/** Bubble-independent one-line description of a message (used in reply quotes). */
export function messagePreview(m: Message): string {
  const type = m.message_type
  if (m.is_deleted) return "Message deleted"
  if (type && TYPE_GLYPHS[type]) {
    return m.body ? `${TYPE_GLYPHS[type].split(" ")[0]} ${m.body}` : TYPE_GLYPHS[type]
  }
  return m.body ?? ""
}

/** Display name for a chat or sender. */
export function displayName(name?: string | null, jid?: string): string {
  if (name) return name
  if (!jid) return "Unknown"
  const num = jid.split("@")[0].split(":")[0]
  return jid.includes("@s.whatsapp.net") ? `+${num}` : num
}
