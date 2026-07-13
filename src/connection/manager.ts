import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  BaileysEventMap,
  proto,
  isJidGroup,
  ConnectionState,
  WAMessageKey,
  WAMessage,
  downloadMediaMessage,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { NotConnectedError } from '../api/errors.js';
import fs from 'fs';
import { config } from '../config.js';
import { eventBus } from '../events/bus.js';
import { sanitizeVCardField } from '../utils/security.js';
import { logger, log } from '../utils/logger.js';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected';

type Socket = ReturnType<typeof makeWASocket>;

class ConnectionManager {
  private sock: Socket | null = null;
  private retryCount = 0;
  private maxRetries = 10;
  private qrCode: string | null = null;
  private status: ConnectionStatus = 'disconnected';
  private myJid: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;

  getSocket(): Socket | null {
    return this.sock;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getQR(): string | null {
    return this.qrCode;
  }

  getMyJid(): string | null {
    return this.myJid;
  }

  private requireSocket(): Socket {
    if (!this.sock) throw new NotConnectedError();
    return this.sock;
  }

  /** Cancel a pending reconnect so a stale timer can't spawn a second loop. */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Close the current socket and drop our reference. Nulling `this.sock` is
   * what neutralizes the old socket: its `connection.update` handler bails on
   * the `this.sock !== sock` guard, so a dying socket can't schedule its own
   * reconnect or clobber shared state after we've moved on to a new one.
   */
  private teardownSocket(): void {
    if (!this.sock) return;
    try {
      this.sock.end(undefined);
    } catch {
      /* already closed */
    }
    this.sock = null;
  }

  async connect(): Promise<void> {
    // Cancel any pending reconnect and drop the previous socket first, so
    // connect loops can never stack on top of each other — overlapping loops
    // are what make the QR/status flap and the UI reload every second.
    this.clearReconnectTimer();
    if (this.connecting) return;
    this.connecting = true;

    try {
      this.teardownSocket();

      if (!fs.existsSync(config.authDir)) {
        fs.mkdirSync(config.authDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
      const { version } = await fetchLatestBaileysVersion();

      this.status = 'connecting';
      eventBus.publish('connection.status', { status: this.status });

      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: true,
        logger,
        browser: Browsers.macOS('Desktop'),
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => true,
        markOnlineOnConnect: true,
      });
      this.sock = sock;

      // Save credentials on update
      sock.ev.on('creds.update', saveCreds);

      // Connection updates — ignore anything from a socket we've since replaced.
      sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
        if (this.sock !== sock) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          this.status = 'qr';
          eventBus.publish('connection.qr', { qr });
          eventBus.publish('connection.status', { status: this.status });
          log.wa.info('QR code generated — scan with WhatsApp');
        }

        if (connection === 'close') {
          this.status = 'disconnected';
          this.qrCode = null;
          eventBus.publish('connection.status', { status: this.status });

          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          if (shouldReconnect && this.retryCount < this.maxRetries) {
            this.retryCount++;
            const delay = Math.min(1000 * Math.pow(2, this.retryCount), 60000);
            log.wa.info(
              { delay: delay / 1000, attempt: this.retryCount, maxRetries: this.maxRetries },
              'Connection closed, reconnecting'
            );
            this.clearReconnectTimer();
            this.reconnectTimer = setTimeout(() => this.connect(), delay);
          } else if (!shouldReconnect) {
            log.wa.warn('Logged out. Delete auth folder and restart to re-authenticate.');
            eventBus.publish('connection.logged_out', {});
          } else {
            log.wa.error('Max reconnection attempts reached');
            eventBus.publish('connection.failed', { retries: this.retryCount });
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.retryCount = 0;
          this.qrCode = null;
          this.myJid = sock.user?.id || null;
          eventBus.publish('connection.status', { status: this.status, jid: this.myJid });
          log.wa.info({ jid: this.myJid }, 'Connected');
        }
      });

      // Forward ALL Baileys events to the event bus
      this.registerEventForwarding();
    } finally {
      this.connecting = false;
    }
  }

  private forwardEvent<E extends keyof BaileysEventMap>(event: E): void {
    this.sock!.ev.on(event, (data: BaileysEventMap[E]) => {
      eventBus.publish(`wa.${event}`, data);
    });
  }

  private registerEventForwarding(): void {
    if (!this.sock) return;

    const eventsToForward: (keyof BaileysEventMap)[] = [
      'messaging-history.set',
      'messages.upsert',
      'messages.update',
      'messages.delete',
      'messages.reaction',
      'message-receipt.update',
      'presence.update',
      'chats.upsert',
      'chats.update',
      'chats.delete',
      'contacts.upsert',
      'contacts.update',
      'groups.upsert',
      'groups.update',
      'group-participants.update',
      'labels.association',
      'labels.edit',
      'call',
    ];

    for (const eventName of eventsToForward) {
      this.forwardEvent(eventName);
    }
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    if (this.sock) {
      const sock = this.sock;
      // Drop our reference first so the logout-triggered 'close' can't reconnect
      // (its handler bails on the `this.sock !== sock` guard).
      this.sock = null;
      try {
        await sock.logout();
      } catch (err) {
        log.wa.warn({ err }, 'Logout failed, forcing socket close');
        sock.end(undefined);
      }
    }
    this.status = 'disconnected';
    this.qrCode = null;
    this.myJid = null;
    eventBus.publish('connection.status', { status: this.status });
  }

  async restart(): Promise<void> {
    this.clearReconnectTimer();
    this.teardownSocket();
    this.retryCount = 0;
    await this.connect();
  }

  async newQR(): Promise<void> {
    // End existing socket without trying to logout (which requires active session)
    this.clearReconnectTimer();
    this.teardownSocket();
    this.status = 'disconnected';
    this.qrCode = null;
    this.myJid = null;
    this.retryCount = 0;

    // Delete auth folder to force fresh QR generation
    if (fs.existsSync(config.authDir)) {
      fs.rmSync(config.authDir, { recursive: true, force: true });
    }

    eventBus.publish('connection.status', { status: this.status });
    await this.connect();
  }

  // ===== ACTION METHODS =====
  // All send methods return WAMessage (Baileys v7 type) or undefined

  async sendTextMessage(jid: string, text: string, quotedId?: string): Promise<WAMessage | undefined> {
    const sock = this.requireSocket();
    let quoted: WAMessage | undefined;
    if (quotedId) {
      try {
        const { messagesRepo } = await import('../database/repositories/messages.js');
        const dbMsg = messagesRepo.getById(quotedId);
        if (dbMsg?.raw_message) {
          quoted = JSON.parse(dbMsg.raw_message) as WAMessage;
        }
      } catch {
        // If DB lookup fails, skip quoting
      }
    }
    return sock.sendMessage(jid, { text }, { quoted });
  }

  async sendImage(jid: string, buffer: Buffer, caption?: string, mimeType?: string): Promise<WAMessage | undefined> {
    const sock = this.requireSocket();
    return sock.sendMessage(jid, {
      image: buffer,
      caption,
      mimetype: mimeType,
    });
  }

  async sendDocument(jid: string, buffer: Buffer, filename: string, mimeType: string, caption?: string): Promise<WAMessage | undefined> {
    const sock = this.requireSocket();
    return sock.sendMessage(jid, {
      document: buffer,
      fileName: filename,
      mimetype: mimeType,
      caption,
    });
  }

  async sendAudio(jid: string, buffer: Buffer, ptt = false): Promise<WAMessage | undefined> {
    const sock = this.requireSocket();
    return sock.sendMessage(jid, {
      audio: buffer,
      ptt,
      mimetype: 'audio/ogg; codecs=opus',
    });
  }

  async sendVideo(jid: string, buffer: Buffer, caption?: string): Promise<WAMessage | undefined> {
    const sock = this.requireSocket();
    return sock.sendMessage(jid, {
      video: buffer,
      caption,
    });
  }

  async sendSticker(jid: string, buffer: Buffer): Promise<WAMessage | undefined> {
    const sock = this.requireSocket();
    return sock.sendMessage(jid, { sticker: buffer });
  }

  async sendLocation(jid: string, lat: number, lng: number, name?: string, address?: string): Promise<WAMessage | undefined> {
    const sock = this.requireSocket();
    return sock.sendMessage(jid, {
      location: {
        degreesLatitude: lat,
        degreesLongitude: lng,
        name,
        address,
      },
    });
  }

  async sendContact(jid: string, contactJid: string, name: string): Promise<WAMessage | undefined> {
    const sock = this.requireSocket();
    const safeName = sanitizeVCardField(name);
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${safeName}\nTEL;type=CELL;type=VOICE;waid=${contactJid.split('@')[0]}:+${contactJid.split('@')[0]}\nEND:VCARD`;
    return sock.sendMessage(jid, {
      contacts: { displayName: name, contacts: [{ vcard }] },
    });
  }

  async sendReaction(jid: string, messageId: string, emoji: string): Promise<WAMessage | undefined> {
    const sock = this.requireSocket();
    return sock.sendMessage(jid, {
      react: { text: emoji, key: { remoteJid: jid, id: messageId } as WAMessageKey },
    });
  }

  async markRead(jid: string, messageIds: string[]): Promise<void> {
    const sock = this.requireSocket();
    await sock.readMessages(
      messageIds.map((id) => ({ remoteJid: jid, id }) as WAMessageKey)
    );
  }

  async sendPresenceUpdate(type: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused', jid?: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.sendPresenceUpdate(type, jid);
  }

  async presenceSubscribe(jid: string): Promise<void> {
    await this.requireSocket().presenceSubscribe(jid);
  }

  async getProfilePicUrl(jid: string): Promise<string | undefined> {
    const sock = this.requireSocket();
    try {
      return await sock.profilePictureUrl(jid, 'image');
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve a phone JID (@s.whatsapp.net) to its user-level LID (@lid).
   * Uses the signal LID store, which performs a USync server query on a cache
   * miss. Returns the user-level LID (device suffix stripped) or null.
   */
  async resolveLidForPn(phoneJid: string): Promise<string | null> {
    if (!phoneJid.endsWith('@s.whatsapp.net')) return null;
    const sock = this.sock;
    if (!sock) return null;
    try {
      const lid = await sock.signalRepository.lidMapping.getLIDForPN(phoneJid);
      if (!lid) return null;
      // Normalize device-specific LID (e.g. "1234:5@lid") to user level ("1234@lid")
      return `${lid.split('@')[0].split(':')[0]}@lid`;
    } catch (err) {
      log.wa.warn({ err, phoneJid }, 'Failed to resolve LID for PN');
      return null;
    }
  }

  /**
   * Resolve a LID (@lid) to its phone JID (@s.whatsapp.net) from the signal
   * store cache. Returns null if unknown.
   */
  async resolvePnForLid(lid: string): Promise<string | null> {
    if (!lid.endsWith('@lid')) return null;
    const sock = this.sock;
    if (!sock) return null;
    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(lid);
      if (!pn) return null;
      return `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
    } catch (err) {
      log.wa.warn({ err, lid }, 'Failed to resolve PN for LID');
      return null;
    }
  }

  async updateProfileStatus(status: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.updateProfileStatus(status);
  }

  async getGroupMetadata(jid: string) {
    const sock = this.requireSocket();
    return sock.groupMetadata(jid);
  }

  async getGroupInviteCode(jid: string): Promise<string | undefined> {
    const sock = this.requireSocket();
    return sock.groupInviteCode(jid);
  }

  async groupUpdateSubject(jid: string, subject: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.groupUpdateSubject(jid, subject);
  }

  async groupUpdateDescription(jid: string, description: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.groupUpdateDescription(jid, description);
  }

  async groupParticipantsUpdate(jid: string, participants: string[], action: 'add' | 'remove' | 'promote' | 'demote') {
    const sock = this.requireSocket();
    return sock.groupParticipantsUpdate(jid, participants, action);
  }

  async downloadMedia(msg: WAMessage): Promise<Buffer> {
    this.requireSocket();
    return downloadMediaMessage(msg, 'buffer', {}) as Promise<Buffer>;
  }

  /**
   * Ask WhatsApp for older chat history before a known message. `cursorKey` is
   * the key of the oldest message we already have; `oldestTimestamp` its unix
   * timestamp (seconds). Returns a Baileys request id; the resulting messages
   * arrive asynchronously via the `messaging-history.set` event.
   */
  async requestHistorySync(cursorKey: WAMessageKey, oldestTimestamp: number, count: number): Promise<string> {
    return this.requireSocket().fetchMessageHistory(count, cursorKey, oldestTimestamp);
  }
}

export const connectionManager = new ConnectionManager();
