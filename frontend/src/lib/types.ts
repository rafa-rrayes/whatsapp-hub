export interface Message {
  id: string
  remote_jid: string
  from_jid?: string
  from_me: number
  participant?: string
  timestamp: number
  push_name?: string
  message_type?: string
  body?: string
  quoted_id?: string
  quoted_body?: string
  is_forwarded: number
  forward_score: number
  is_starred: number
  is_broadcast: number
  is_ephemeral: number
  ephemeral_duration?: number
  edit_type: number
  edited_at?: string
  is_deleted: number
  deleted_at?: string
  has_media: number
  media_id?: string
  media_mime_type?: string
  media_size?: number
  media_filename?: string
  media_duration?: number
  media_width?: number
  media_height?: number
  reaction_emoji?: string
  reaction_target_id?: string
  poll_name?: string
  poll_options?: string
  latitude?: number
  longitude?: number
  location_name?: string
  location_address?: string
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
  is_business: number
  is_group: number
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
  is_announce: number
  is_restrict: number
  profile_pic_url?: string
  invite_code?: string
  first_seen_at: string
  updated_at: string
  participants?: GroupParticipant[]
}

export interface GroupParticipant {
  group_jid: string
  participant_jid: string
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
  is_group: number
  is_archived: number
  is_pinned: number
  is_muted: number
  mute_expiry?: number
  unread_count: number
  last_message_ts?: number
  last_message_body?: string
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
}
