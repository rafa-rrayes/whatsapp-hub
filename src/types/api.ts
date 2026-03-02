/** Public API response types — decoupled from internal DB rows. */

export interface ApiMessage {
  id: string;
  remote_jid: string;
  from_jid?: string;
  from_me: boolean;
  participant?: string;
  timestamp: number;
  push_name?: string;
  message_type?: string;
  body?: string;
  quoted_id?: string;
  quoted_body?: string;
  is_forwarded: boolean;
  forward_score: number;
  is_starred: boolean;
  is_broadcast: boolean;
  is_ephemeral: boolean;
  ephemeral_duration?: number;
  edit_type: number;
  edited_at?: string;
  is_deleted: boolean;
  deleted_at?: string;
  has_media: boolean;
  media_id?: string;
  media_mime_type?: string;
  media_size?: number;
  media_filename?: string;
  media_duration?: number;
  media_width?: number;
  media_height?: number;
  reaction_emoji?: string;
  reaction_target_id?: string;
  poll_name?: string;
  poll_options?: string;
  latitude?: number;
  longitude?: number;
  location_name?: string;
  location_address?: string;
  created_at: string;
}

export interface ApiContact {
  jid: string;
  name?: string;
  notify_name?: string;
  short_name?: string;
  phone_number?: string;
  is_business: boolean;
  profile_pic_url?: string;
  status_text?: string;
  first_seen_at: string;
  updated_at: string;
}

export interface ApiGroup {
  jid: string;
  name?: string;
  description?: string;
  owner_jid?: string;
  creation_time?: number;
  participant_count: number;
  is_announce: boolean;
  is_restrict: boolean;
  profile_pic_url?: string;
  invite_code?: string;
  first_seen_at: string;
  updated_at: string;
}

export interface ApiChat {
  jid: string;
  name?: string;
  is_group: boolean;
  is_archived: boolean;
  is_pinned: boolean;
  is_muted: boolean;
  mute_expiry?: number;
  unread_count: number;
  last_message_ts?: number;
  last_message_body?: string;
  updated_at: string;
}

export interface ApiMedia {
  id: string;
  message_id?: string;
  mime_type?: string;
  file_size?: number;
  filename?: string;
  original_filename?: string;
  file_path?: string;
  file_hash?: string;
  width?: number;
  height?: number;
  duration?: number;
  download_status: string;
  download_error?: string;
  created_at: string;
}
