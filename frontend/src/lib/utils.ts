import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatJid(jid: string): string {
  if (!jid) return ""
  if (jid.endsWith("@g.us")) {
    return jid.replace("@g.us", " (group)")
  }
  if (jid.endsWith("@s.whatsapp.net")) {
    return "+" + jid.replace("@s.whatsapp.net", "")
  }
  if (jid.endsWith("@lid")) {
    return jid.replace("@lid", "")
  }
  return jid
}

export function formatTimestamp(ts: number): string {
  if (!ts) return ""
  const date = new Date(ts * 1000)
  if (isToday(date)) return format(date, "'Today' HH:mm")
  if (isYesterday(date)) return format(date, "'Yesterday' HH:mm")
  return format(date, "MMM d, yyyy HH:mm")
}

export function formatRelativeTime(ts: number): string {
  if (!ts) return ""
  return formatDistanceToNow(new Date(ts * 1000), { addSuffix: true })
}

export function formatDatetime(dateStr: string): string {
  if (!dateStr) return ""
  const date = new Date(dateStr)
  if (isToday(date)) return format(date, "'Today' HH:mm:ss")
  if (isYesterday(date)) return format(date, "'Yesterday' HH:mm:ss")
  return format(date, "MMM d, yyyy HH:mm:ss")
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B"
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`
}

export function truncate(str: string, len: number): string {
  if (!str) return ""
  return str.length > len ? str.slice(0, len) + "..." : str
}
