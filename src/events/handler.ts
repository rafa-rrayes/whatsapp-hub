import { proto, isJidGroup, WAMessage, Contact } from '@whiskeysockets/baileys';
import type { PresenceData } from '@whiskeysockets/baileys';
import { eventBus } from './bus.js';
import { getDb } from '../database/index.js';
import { messagesRepo } from '../database/repositories/messages.js';
import { contactsRepo } from '../database/repositories/contacts.js';
import { groupsRepo } from '../database/repositories/groups.js';
import { chatsRepo } from '../database/repositories/chats.js';
import { eventsRepo } from '../database/repositories/events.js';
import { mediaManager } from '../media/manager.js';
import { connectionManager } from '../connection/manager.js';
import { normalizeJid, resolveToPhoneJid } from '../utils/jid.js';
import { log } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

interface MediaMessageFields {
  mimetype?: string | null;
  fileLength?: number | Long | null;
  fileName?: string | null;
  seconds?: number | null;
  width?: number | null;
  height?: number | null;
}

interface Long {
  toNumber(): number;
}

function fetchGroupMetadataAsync(jid: string): void {
  connectionManager.getGroupMetadata(jid).then((metadata) => {
    if (metadata) {
      groupsRepo.upsert({
        jid: metadata.id,
        name: metadata.subject,
        description: metadata.desc || undefined,
        owner_jid: metadata.owner || undefined,
        creation_time: metadata.creation,
        participant_count: metadata.participants?.length || 0,
        is_announce: metadata.announce ? 1 : 0,
        is_restrict: metadata.restrict ? 1 : 0,
      });
      if (metadata.participants) {
        groupsRepo.setParticipants(
          metadata.id,
          metadata.participants.map((p) => ({
            jid: p.id,
            role: p.admin || 'member',
          }))
        );
      }
      // Also update chat name from group subject
      if (metadata.subject) {
        chatsRepo.upsert({
          jid: metadata.id,
          name: metadata.subject,
          is_group: 1,
        });
      }
    }
  }).catch((err) => {
    log.event.error({ err, groupJid: jid }, 'Failed to fetch group metadata');
  });
}

function getMessageType(msg: proto.IMessage | null | undefined): string {
  if (!msg) return 'unknown';
  if (msg.conversation || msg.extendedTextMessage) return 'text';
  if (msg.imageMessage) return 'image';
  if (msg.videoMessage) return 'video';
  if (msg.audioMessage) return 'audio';
  if (msg.documentMessage || msg.documentWithCaptionMessage) return 'document';
  if (msg.stickerMessage) return 'sticker';
  if (msg.contactMessage || msg.contactsArrayMessage) return 'contact';
  if (msg.locationMessage || msg.liveLocationMessage) return 'location';
  if (msg.reactionMessage) return 'reaction';
  if (msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3) return 'poll';
  if (msg.pollUpdateMessage) return 'poll_update';
  if (msg.protocolMessage) return 'protocol';
  if (msg.viewOnceMessage || msg.viewOnceMessageV2) return 'view_once';
  if (msg.listMessage) return 'list';
  if (msg.buttonsMessage || msg.templateMessage) return 'buttons';
  if (msg.orderMessage) return 'order';
  if (msg.productMessage) return 'product';
  if (msg.editedMessage) return 'edited';
  return 'unknown';
}

function extractTextBody(msg: proto.IMessage | null | undefined): string | undefined {
  if (!msg) return undefined;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    msg.listMessage?.description ||
    msg.buttonsMessage?.contentText ||
    msg.pollCreationMessage?.name ||
    msg.pollCreationMessageV2?.name ||
    msg.pollCreationMessageV3?.name ||
    undefined
  );
}

function hasMedia(msg: proto.IMessage | null | undefined): boolean {
  if (!msg) return false;
  return !!(
    msg.imageMessage ||
    msg.videoMessage ||
    msg.audioMessage ||
    msg.documentMessage ||
    msg.stickerMessage ||
    msg.documentWithCaptionMessage?.message?.documentMessage
  );
}

function getMediaInfo(msg: proto.IMessage | null | undefined) {
  if (!msg) return {};
  const media =
    msg.imageMessage ||
    msg.videoMessage ||
    msg.audioMessage ||
    msg.documentMessage ||
    msg.stickerMessage ||
    msg.documentWithCaptionMessage?.message?.documentMessage;

  if (!media) return {};

  const m = media as MediaMessageFields;
  return {
    mime_type: m.mimetype ?? undefined,
    size: m.fileLength ? Number(m.fileLength) : undefined,
    filename: m.fileName ?? undefined,
    duration: m.seconds ? Number(m.seconds) : undefined,
    width: m.width ? Number(m.width) : undefined,
    height: m.height ? Number(m.height) : undefined,
  };
}

export function registerEventHandlers(): void {
  // ===== MESSAGES =====
  eventBus.on('wa.messages.upsert', (event) => {
    const { type, messages } = event.data as { type: string; messages: WAMessage[] };

    for (const msg of messages) {
      try {
        const key = msg.key;
        if (!key?.id || !key?.remoteJid) continue;

        // Normalize LID ↔ phone JID: always prefer @s.whatsapp.net
        const remoteJidAlt = (key as Record<string, unknown>).remoteJidAlt as string | undefined;
        const remoteJid = normalizeJid(key.remoteJid, remoteJidAlt);

        const innerMsg = msg.message;
        const msgType = getMessageType(innerMsg);

        // Skip protocol messages (read receipts, etc.)
        if (msgType === 'protocol') continue;

        const mediaInfo = getMediaInfo(innerMsg);
        let mediaId: string | undefined;

        if (hasMedia(innerMsg)) {
          mediaId = uuid();
          mediaManager.queueDownload(mediaId, msg);
        }

        // Handle reactions specially
        const reaction = innerMsg?.reactionMessage;
        const location = innerMsg?.locationMessage || innerMsg?.liveLocationMessage;

        // Handle quoted messages
        const contextInfo =
          innerMsg?.extendedTextMessage?.contextInfo ||
          innerMsg?.imageMessage?.contextInfo ||
          innerMsg?.videoMessage?.contextInfo ||
          innerMsg?.audioMessage?.contextInfo ||
          innerMsg?.documentMessage?.contextInfo;

        // Normalize from_jid (resolve LID → phone where possible)
        const rawFromJid = key.fromMe ? undefined : (key.participant || remoteJid);
        const fromJid = rawFromJid ? resolveToPhoneJid(rawFromJid) : undefined;

        messagesRepo.upsert({
          id: key.id,
          remote_jid: remoteJid,
          from_jid: fromJid,
          from_me: key.fromMe ? 1 : 0,
          participant: key.participant || undefined,
          timestamp: typeof msg.messageTimestamp === 'number'
            ? msg.messageTimestamp
            : Number(msg.messageTimestamp),
          push_name: msg.pushName || undefined,
          message_type: msgType,
          body: extractTextBody(innerMsg),
          quoted_id: contextInfo?.stanzaId || undefined,
          quoted_body: contextInfo?.quotedMessage
            ? extractTextBody(contextInfo.quotedMessage)
            : undefined,
          is_forwarded: contextInfo?.isForwarded ? 1 : 0,
          forward_score: contextInfo?.forwardingScore || 0,
          is_broadcast: remoteJid?.endsWith('@broadcast') ? 1 : 0,
          has_media: hasMedia(innerMsg) ? 1 : 0,
          media_id: mediaId,
          media_mime_type: mediaInfo.mime_type,
          media_size: mediaInfo.size,
          media_filename: mediaInfo.filename,
          media_duration: mediaInfo.duration,
          media_width: mediaInfo.width,
          media_height: mediaInfo.height,
          reaction_emoji: reaction?.text || undefined,
          reaction_target_id: reaction?.key?.id || undefined,
          poll_name: innerMsg?.pollCreationMessage?.name || innerMsg?.pollCreationMessageV2?.name || undefined,
          poll_options: innerMsg?.pollCreationMessage?.options
            ? JSON.stringify(innerMsg.pollCreationMessage.options.map((o) => o.optionName))
            : undefined,
          latitude: location?.degreesLatitude || undefined,
          longitude: location?.degreesLongitude || undefined,
          location_name: innerMsg?.locationMessage?.name || undefined,
          location_address: innerMsg?.locationMessage?.address || undefined,
          raw_message: JSON.stringify(msg),
        });

        // Update chat metadata
        const textBody = extractTextBody(innerMsg);
        chatsRepo.upsert({
          jid: remoteJid,
          is_group: isJidGroup(remoteJid) ? 1 : 0,
          last_message_ts: typeof msg.messageTimestamp === 'number'
            ? msg.messageTimestamp
            : Number(msg.messageTimestamp),
          last_message_body: textBody?.slice(0, 200),
        });

        // Ensure group exists in groups table when we receive a group message
        if (isJidGroup(remoteJid)) {
          const existing = groupsRepo.getByJid(remoteJid);
          if (!existing) {
            groupsRepo.upsert({
              jid: remoteJid,
              participant_count: 0,
            });
            // Try to fetch full metadata asynchronously
            fetchGroupMetadataAsync(remoteJid);
          }
        }

        // Update contact from push name (use normalized JID)
        if (msg.pushName && (key.participant || (!key.fromMe && remoteJid))) {
          const rawContactJid = key.participant || remoteJid;
          const contactJid = resolveToPhoneJid(rawContactJid);
          if (!isJidGroup(contactJid)) {
            contactsRepo.upsert({
              jid: contactJid,
              notify_name: msg.pushName,
            });
          }
        }

        eventsRepo.log('message.received', {
          id: key.id,
          jid: remoteJid,
          type: msgType,
          fromMe: key.fromMe,
        });
      } catch (err) {
        log.event.error({ err }, 'Error processing message');
      }
    }
  });

  // ===== MESSAGE UPDATES (edits, deletes) =====
  eventBus.on('wa.messages.update', (event) => {
    const updates = event.data as Array<{ key: WAMessage['key']; update: Record<string, unknown> }>;
    for (const update of updates) {
      try {
        if ((update.update as { message?: proto.IMessage }).message) {
          const newBody = extractTextBody((update.update as { message: proto.IMessage }).message);
          if (newBody && update.key?.id) {
            messagesRepo.markEdited(update.key.id, newBody);
            eventsRepo.log('message.edited', { id: update.key.id });
          }
        }
        if ((update.update as { starred?: boolean }).starred !== undefined && update.key?.id) {
          const db = getDb();
          db.prepare('UPDATE messages SET is_starred = ? WHERE id = ?').run(
            (update.update as { starred: boolean }).starred ? 1 : 0,
            update.key.id
          );
        }
      } catch (err) {
        log.event.error({ err }, 'Error processing message update');
      }
    }
  });

  // ===== MESSAGE DELETES =====
  eventBus.on('wa.messages.delete', (event) => {
    try {
      const data = event.data as { keys?: Array<{ id?: string }> };
      if (data.keys) {
        for (const key of data.keys) {
          if (key.id) {
            messagesRepo.markDeleted(key.id);
            eventsRepo.log('message.deleted', { id: key.id });
          }
        }
      }
    } catch (err) {
      log.event.error({ err }, 'Error processing message delete');
    }
  });

  // ===== MESSAGE RECEIPTS =====
  eventBus.on('wa.message-receipt.update', (event) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO message_receipts (message_id, recipient_jid, status, timestamp)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id, recipient_jid) DO UPDATE SET
        status = excluded.status,
        timestamp = excluded.timestamp,
        updated_at = datetime('now')
    `);

    const receipts = event.data as Array<{
      key: { id?: string };
      receipt: {
        readTimestamp?: number;
        playedTimestamp?: number;
        receiptTimestamp?: number;
        userJid?: string;
      };
    }>;

    for (const update of receipts) {
      try {
        if (update.key?.id && update.receipt) {
          const status =
            update.receipt.readTimestamp ? 'read' :
            update.receipt.playedTimestamp ? 'played' :
            update.receipt.receiptTimestamp ? 'delivered' : 'sent';

          const ts = update.receipt.readTimestamp ||
            update.receipt.playedTimestamp ||
            update.receipt.receiptTimestamp;

          if (update.receipt.userJid) {
            stmt.run(update.key.id, update.receipt.userJid, status, ts);
          }
        }
      } catch (err) {
        log.event.error({ err }, 'Error processing receipt');
      }
    }
  });

  // ===== PRESENCE =====
  eventBus.on('wa.presence.update', (event) => {
    const db = getDb();
    const data = event.data as { id?: string; presences?: Record<string, PresenceData> };
    try {
      if (data.id && data.presences) {
        for (const [jid, presence] of Object.entries(data.presences)) {
          db.prepare(
            'INSERT INTO presence_log (jid, status, last_seen) VALUES (?, ?, ?)'
          ).run(jid, presence.lastKnownPresence, presence.lastSeen || null);
        }
      }
    } catch (err) {
      log.event.error({ err }, 'Error processing presence');
    }
  });

  // ===== CONTACTS =====
  eventBus.on('wa.contacts.upsert', (event) => {
    const contacts = event.data as Contact[];
    for (const contact of contacts) {
      try {
        contactsRepo.upsert({
          jid: contact.id,
          name: contact.name,
          notify_name: contact.notify,
          short_name: (contact as unknown as Record<string, unknown>).shortName as string | undefined,
          phone_number: contact.id?.split('@')[0],
        });
      } catch (err) {
        log.event.error({ err }, 'Error processing contact');
      }
    }
  });

  eventBus.on('wa.contacts.update', (event) => {
    const contacts = event.data as Partial<Contact>[];
    for (const contact of contacts) {
      try {
        if (contact.id) {
          contactsRepo.upsert({
            jid: contact.id,
            name: contact.name,
            notify_name: contact.notify,
            status_text: contact.status ?? undefined,
            profile_pic_url: contact.imgUrl ?? undefined,
          });
        }
      } catch (err) {
        log.event.error({ err }, 'Error processing contact update');
      }
    }
  });

  // ===== CHATS =====
  eventBus.on('wa.chats.upsert', (event) => {
    const chats = event.data as Array<{
      id: string; name?: string; archived?: boolean; pinned?: number;
      mute?: number; unreadCount?: number;
    }>;
    for (const chat of chats) {
      try {
        chatsRepo.upsert({
          jid: chat.id,
          name: chat.name || undefined,
          is_group: isJidGroup(chat.id) ? 1 : 0,
          is_archived: chat.archived ? 1 : 0,
          is_pinned: chat.pinned ? 1 : 0,
          is_muted: chat.mute ? 1 : 0,
          mute_expiry: chat.mute || undefined,
          unread_count: chat.unreadCount ?? 0,
        });
      } catch (err) {
        log.event.error({ err }, 'Error processing chat');
      }
    }
  });

  eventBus.on('wa.chats.update', (event) => {
    const chats = event.data as Array<{
      id?: string; name?: string; archived?: boolean; pinned?: number;
      mute?: number; unreadCount?: number;
    }>;
    for (const chat of chats) {
      try {
        if (chat.id) {
          chatsRepo.upsert({
            jid: chat.id,
            name: chat.name || undefined,
            is_archived: chat.archived !== undefined ? (chat.archived ? 1 : 0) : undefined,
            is_pinned: chat.pinned !== undefined ? (chat.pinned ? 1 : 0) : undefined,
            is_muted: chat.mute !== undefined ? (chat.mute ? 1 : 0) : undefined,
            unread_count: chat.unreadCount,
          });
        }
      } catch (err) {
        log.event.error({ err }, 'Error processing chat update');
      }
    }
  });

  // ===== GROUPS =====
  eventBus.on('wa.groups.upsert', (event) => {
    const groups = event.data as Array<{
      id: string; subject: string; desc?: string; owner?: string;
      creation?: number; participants?: Array<{ id: string; admin?: string }>;
      announce?: boolean; restrict?: boolean;
    }>;
    for (const group of groups) {
      try {
        groupsRepo.upsert({
          jid: group.id,
          name: group.subject,
          description: group.desc || undefined,
          owner_jid: group.owner || undefined,
          creation_time: group.creation,
          participant_count: group.participants?.length || 0,
          is_announce: group.announce ? 1 : 0,
          is_restrict: group.restrict ? 1 : 0,
        });

        if (group.participants) {
          groupsRepo.setParticipants(
            group.id,
            group.participants.map((p) => ({
              jid: p.id,
              role: p.admin || 'member',
            }))
          );
        }
      } catch (err) {
        log.event.error({ err }, 'Error processing group');
      }
    }
  });

  eventBus.on('wa.groups.update', (event) => {
    const groups = event.data as Array<{
      id?: string; subject?: string; desc?: string;
      announce?: boolean; restrict?: boolean;
    }>;
    for (const group of groups) {
      try {
        if (group.id) {
          groupsRepo.upsert({
            jid: group.id,
            name: group.subject || undefined,
            description: group.desc || undefined,
            is_announce: group.announce !== undefined ? (group.announce ? 1 : 0) : undefined,
            is_restrict: group.restrict !== undefined ? (group.restrict ? 1 : 0) : undefined,
          });
        }
      } catch (err) {
        log.event.error({ err }, 'Error processing group update');
      }
    }
  });

  eventBus.on('wa.group-participants.update', (event) => {
    try {
      const { id, participants, action } = event.data as {
        id: string; participants: string[]; action: string;
      };
      eventsRepo.log('group.participants_update', { groupJid: id, participants, action });
      // Re-fetch full participant list to keep it in sync
      fetchGroupMetadataAsync(id);
    } catch (err) {
      log.event.error({ err }, 'Error processing group participants update');
    }
  });

  // ===== CALLS =====
  eventBus.on('wa.call', (event) => {
    const db = getDb();
    const calls = event.data as Array<{
      id?: string; from: string; isGroup?: boolean; isVideo?: boolean; status: string;
    }>;
    for (const call of calls) {
      try {
        db.prepare(`
          INSERT OR REPLACE INTO call_log (id, from_jid, is_group, is_video, status, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          call.id || uuid(),
          call.from,
          call.isGroup ? 1 : 0,
          call.isVideo ? 1 : 0,
          call.status,
          Math.floor(Date.now() / 1000)
        );
        eventsRepo.log('call', { from: call.from, status: call.status, isVideo: call.isVideo });
      } catch (err) {
        log.event.error({ err }, 'Error processing call');
      }
    }
  });

  // ===== HISTORY SYNC =====
  eventBus.on('wa.messaging-history.set', (event) => {
    const { chats, contacts, messages, isLatest } = event.data as {
      chats?: Array<{
        id: string; name?: string; archived?: boolean; pinned?: number;
        mute?: number; unreadCount?: number;
      }>;
      contacts?: Contact[];
      messages?: unknown[];
      isLatest?: boolean;
    };
    log.event.info(
      { chats: chats?.length || 0, contacts: contacts?.length || 0, messages: messages?.length || 0, isLatest },
      'History sync'
    );

    // Process chats from history sync
    if (chats) {
      for (const chat of chats) {
        try {
          chatsRepo.upsert({
            jid: chat.id,
            name: chat.name || undefined,
            is_group: isJidGroup(chat.id) ? 1 : 0,
            is_archived: chat.archived ? 1 : 0,
            is_pinned: chat.pinned ? 1 : 0,
            is_muted: chat.mute ? 1 : 0,
            unread_count: chat.unreadCount ?? 0,
          });

          // Create stub group entries for group chats, then fetch metadata
          if (isJidGroup(chat.id)) {
            const existing = groupsRepo.getByJid(chat.id);
            if (!existing) {
              groupsRepo.upsert({
                jid: chat.id,
                name: chat.name || undefined,
                participant_count: 0,
              });
            }
            fetchGroupMetadataAsync(chat.id);
          }
        } catch (err) {
          log.event.error({ err }, 'Error processing history chat');
        }
      }
    }

    // Process contacts from history sync
    if (contacts) {
      for (const contact of contacts) {
        try {
          contactsRepo.upsert({
            jid: contact.id,
            name: contact.name,
            notify_name: contact.notify,
            short_name: (contact as unknown as Record<string, unknown>).shortName as string | undefined,
            phone_number: contact.id?.split('@')[0],
          });
        } catch (err) {
          log.event.error({ err }, 'Error processing history contact');
        }
      }
    }

    eventsRepo.log('history.sync', {
      chats: chats?.length || 0,
      contacts: contacts?.length || 0,
      messages: messages?.length || 0,
      isLatest,
    });
  });

  // ===== LOG ALL EVENTS =====
  eventBus.on('*', (event) => {
    // Don't double-log events we already log specifically
    const skipLog = [
      'wa.messages.upsert',
      'wa.message-receipt.update',
      'wa.presence.update',
      'wa.messaging-history.set',
    ];
    if (!skipLog.includes(event.type) && event.type.startsWith('wa.')) {
      eventsRepo.log(event.type, { summary: true });
    }
  });

  log.event.info('All event handlers registered');
}
