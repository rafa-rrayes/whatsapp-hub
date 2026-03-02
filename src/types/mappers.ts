import type { MessageRow } from '../database/repositories/messages.js';
import type { ContactRow } from '../database/repositories/contacts.js';
import type { GroupRow } from '../database/repositories/groups.js';
import type { ChatRow } from '../database/repositories/chats.js';
import type { MediaRow } from '../database/repositories/media.js';
import type { ApiMessage, ApiContact, ApiGroup, ApiChat, ApiMedia } from './api.js';

/** Convert integer (0/1) to boolean. */
function bool(v: number): boolean {
  return v === 1;
}

export function toApiMessage(row: MessageRow): ApiMessage {
  return {
    id: row.id,
    remote_jid: row.remote_jid,
    from_jid: row.from_jid,
    from_me: bool(row.from_me),
    participant: row.participant,
    timestamp: row.timestamp,
    push_name: row.push_name,
    message_type: row.message_type,
    body: row.body,
    quoted_id: row.quoted_id,
    quoted_body: row.quoted_body,
    is_forwarded: bool(row.is_forwarded),
    forward_score: row.forward_score,
    is_starred: bool(row.is_starred),
    is_broadcast: bool(row.is_broadcast),
    is_ephemeral: bool(row.is_ephemeral),
    ephemeral_duration: row.ephemeral_duration,
    edit_type: row.edit_type,
    edited_at: row.edited_at,
    is_deleted: bool(row.is_deleted),
    deleted_at: row.deleted_at,
    has_media: bool(row.has_media),
    media_id: row.media_id,
    media_mime_type: row.media_mime_type,
    media_size: row.media_size,
    media_filename: row.media_filename,
    media_duration: row.media_duration,
    media_width: row.media_width,
    media_height: row.media_height,
    reaction_emoji: row.reaction_emoji,
    reaction_target_id: row.reaction_target_id,
    poll_name: row.poll_name,
    poll_options: row.poll_options,
    latitude: row.latitude,
    longitude: row.longitude,
    location_name: row.location_name,
    location_address: row.location_address,
    created_at: row.created_at,
  };
}

export function toApiContact(row: ContactRow): ApiContact {
  return {
    jid: row.jid,
    name: row.name,
    notify_name: row.notify_name,
    short_name: row.short_name,
    phone_number: row.phone_number,
    is_business: bool(row.is_business),
    profile_pic_url: row.profile_pic_url,
    status_text: row.status_text,
    first_seen_at: row.first_seen_at,
    updated_at: row.updated_at,
  };
}

export function toApiGroup(row: GroupRow): ApiGroup {
  return {
    jid: row.jid,
    name: row.name,
    description: row.description,
    owner_jid: row.owner_jid,
    creation_time: row.creation_time,
    participant_count: row.participant_count,
    is_announce: bool(row.is_announce),
    is_restrict: bool(row.is_restrict),
    profile_pic_url: row.profile_pic_url,
    invite_code: row.invite_code,
    first_seen_at: row.first_seen_at,
    updated_at: row.updated_at,
  };
}

export function toApiChat(row: ChatRow): ApiChat {
  return {
    jid: row.jid,
    name: row.name,
    is_group: bool(row.is_group),
    is_archived: bool(row.is_archived),
    is_pinned: bool(row.is_pinned),
    is_muted: bool(row.is_muted),
    mute_expiry: row.mute_expiry,
    unread_count: row.unread_count,
    last_message_ts: row.last_message_ts,
    last_message_body: row.last_message_body,
    updated_at: row.updated_at,
  };
}

export function toApiMedia(row: MediaRow): ApiMedia {
  return {
    id: row.id,
    message_id: row.message_id,
    mime_type: row.mime_type,
    file_size: row.file_size,
    filename: row.filename,
    original_filename: row.original_filename,
    file_path: row.file_path,
    file_hash: row.file_hash,
    width: row.width,
    height: row.height,
    duration: row.duration,
    download_status: row.download_status,
    download_error: row.download_error,
    created_at: row.created_at,
  };
}
