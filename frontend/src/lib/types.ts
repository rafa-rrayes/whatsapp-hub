export interface Message {
  id: string
  remote_jid: string
  from_jid?: string
  from_me: boolean
  participant?: string
  timestamp: number
  push_name?: string
  message_type?: string
  body?: string
  quoted_id?: string
  quoted_body?: string
  is_forwarded: boolean
  forward_score: number
  is_starred: boolean
  is_broadcast: boolean
  is_ephemeral: boolean
  ephemeral_duration?: number
  edit_type: number
  edited_at?: string
  is_deleted: boolean
  deleted_at?: string
  has_media: boolean
  media_id?: string
  media_mime_type?: string
  media_size?: number
  media_filename?: string
  media_duration?: number
  media_width?: number
  media_height?: number
  media_transcription?: string | null
  media_transcription_status?: "pending" | "done" | "failed" | "skipped" | null
  reaction_emoji?: string
  reaction_target_id?: string
  poll_name?: string
  poll_options?: string
  latitude?: number
  longitude?: number
  location_name?: string
  location_address?: string
  receipt_status?: "sent" | "delivered" | "read" | "played"
  raw_message?: string
  created_at: string
}

export interface MessageQueryResult {
  data: Message[]
  total: number
}

export interface Contact {
  jid: string
  name?: string
  notify_name?: string
  short_name?: string
  phone_number?: string
  is_business: boolean
  is_group: boolean
  profile_pic_url?: string
  status_text?: string
  first_seen_at: string
  updated_at: string
}

export interface Group {
  jid: string
  name?: string
  description?: string
  owner_jid?: string
  creation_time?: number
  participant_count: number
  is_announce: boolean
  is_restrict: boolean
  profile_pic_url?: string
  invite_code?: string
  first_seen_at: string
  updated_at: string
  participants?: GroupParticipant[]
}

export interface GroupParticipant {
  group_jid: string
  participant_jid: string
  phone_jid?: string
  name?: string
  notify_name?: string
  role: string
  added_at: string
}

export interface Media {
  id: string
  message_id?: string
  mime_type?: string
  file_size?: number
  filename?: string
  original_filename?: string
  file_path?: string
  file_hash?: string
  width?: number
  height?: number
  duration?: number
  thumbnail_path?: string
  download_status: string
  download_error?: string
  created_at: string
}

export interface MediaStats {
  total: number
  downloaded: number
  pending: number
  failed: number
  totalSize: number
  byType: Array<{ mime_type: string; count: number }>
}

export interface MessageStats {
  total: number
  byType: Array<{ message_type: string; count: number }>
  byChat: Array<{ remote_jid: string; count: number }>
  byDay: Array<{ day: string; count: number }>
  mediaCount: number
}

export interface MessageAnalytics {
  range: { days: number | null; firstTs: number | null; lastTs: number | null }
  totals: {
    total: number
    sent: number
    received: number
    media: number
    forwarded: number
    starred: number
    deleted: number
    edited: number
    reactions: number
    words: number
    activeDays: number
  }
  byDay: Array<{ day: string; total: number; sent: number; received: number }>
  byType: Array<{ message_type: string; count: number }>
  byHour: Array<{ hour: number; count: number; sent: number; received: number }>
  byWeekday: Array<{ weekday: number; count: number }>
  heatmap: Array<{ weekday: number; hour: number; count: number }>
  byChat: Array<{ remote_jid: string; count: number; sent: number; received: number; last_ts: number }>
  topSenders: Array<{ sender: string; count: number }>
  media: { total: number; totalSize: number; byKind: Array<{ kind: string; count: number; size: number }> }
  topEmojis: Array<{ emoji: string; count: number }>
}

export interface DashboardStats {
  messages: MessageStats
  contacts: number
  groups: number
  media: MediaStats
  calls: number
  chats: number
}

export interface ConnectionStatus {
  status: string
  jid?: string
  hasQR: boolean
}

export interface QRData {
  qr: string
  raw: string
}

export interface Webhook {
  id: string
  url: string
  secret?: string
  events: string
  is_active: number
  created_at: string
  updated_at: string
}

export interface EventLogEntry {
  id: number
  event_type: string
  payload?: string
  logged_at: string
}

export interface EventTypeCount {
  event_type: string
  count: number
}

export interface Chat {
  jid: string
  name?: string
  is_group: boolean
  is_archived: boolean
  is_pinned: boolean
  is_muted: boolean
  mute_expiry?: number
  unread_count: number
  last_message_ts?: number
  last_message_body?: string
  last_message_id?: string
  last_message_type?: string
  last_message_from_me?: boolean
  last_message_receipt_status?: "sent" | "delivered" | "read" | "played"
  updated_at: string
}

export interface HubEvent {
  type: string
  timestamp: number
  data: unknown
}

export interface SettingItem {
  key: string
  value: unknown
  defaultValue: unknown
  isOverridden: boolean
  /** True for secret settings (e.g. API keys) — value is never returned. */
  isSecret?: boolean
  /** For secret settings: whether a value is currently configured. */
  isSet?: boolean
}
