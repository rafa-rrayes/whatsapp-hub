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
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import { config } from '../config.js';
import { eventBus } from '../events/bus.js';
import { sanitizeVCardField } from '../utils/security.js';

const logger = pino({ level: config.logLevel });

export type ConnectionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected';

type Socket = ReturnType<typeof makeWASocket>;

class ConnectionManager {
  private sock: Socket | null = null;
  private retryCount = 0;
  private maxRetries = 10;
  private qrCode: string | null = null;
  private status: ConnectionStatus = 'disconnected';
  private myJid: string | null = null;

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

  async connect(): Promise<void> {
    if (!fs.existsSync(config.authDir)) {
      fs.mkdirSync(config.authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.status = 'connecting';
    eventBus.publish('connection.status', { status: this.status });

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: true,
      logger,
      generateHighQualityLinkPreview: true,
      syncFullHistory: true,
      markOnlineOnConnect: true,
    });

    // Save credentials on update
    this.sock.ev.on('creds.update', saveCreds);

    // Connection updates
    this.sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrCode = qr;
        this.status = 'qr';
        eventBus.publish('connection.qr', { qr });
        eventBus.publish('connection.status', { status: this.status });
        console.log('[WA] QR code generated — scan with WhatsApp');
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
          console.log(
            `[WA] Connection closed. Reconnecting in ${delay / 1000}s (attempt ${this.retryCount}/${this.maxRetries})...`
          );
          setTimeout(() => this.connect(), delay);
        } else if (!shouldReconnect) {
          console.log('[WA] Logged out. Delete auth folder and restart to re-authenticate.');
          eventBus.publish('connection.logged_out', {});
        } else {
          console.log('[WA] Max reconnection attempts reached.');
          eventBus.publish('connection.failed', { retries: this.retryCount });
        }
      }

      if (connection === 'open') {
        this.status = 'connected';
        this.retryCount = 0;
        this.qrCode = null;
        this.myJid = this.sock?.user?.id || null;
        eventBus.publish('connection.status', { status: this.status, jid: this.myJid });
        console.log(`[WA] Connected as ${this.myJid}`);
      }
    });

    // Forward ALL Baileys events to the event bus
    this.registerEventForwarding();
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
      this.sock.ev.on(eventName as any, (data: any) => {
        eventBus.publish(`wa.${eventName}`, data);
      });
    }
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        // Logout may fail if session is already dead — just end the socket
        this.sock.end(undefined);
      }
      this.sock = null;
    }
    this.status = 'disconnected';
    this.qrCode = null;
    this.myJid = null;
    eventBus.publish('connection.status', { status: this.status });
  }

  async restart(): Promise<void> {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.retryCount = 0;
    await this.connect();
  }

  async newQR(): Promise<void> {
    // End existing socket without trying to logout (which requires active session)
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
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
    if (!this.sock) throw new Error('Not connected');
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
    return this.sock.sendMessage(jid, { text }, { quoted });
  }

  async sendImage(jid: string, buffer: Buffer, caption?: string, mimeType?: string): Promise<WAMessage | undefined> {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.sendMessage(jid, {
      image: buffer,
      caption,
      mimetype: mimeType as any,
    });
  }

  async sendDocument(jid: string, buffer: Buffer, filename: string, mimeType: string, caption?: string): Promise<WAMessage | undefined> {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.sendMessage(jid, {
      document: buffer,
      fileName: filename,
      mimetype: mimeType,
      caption,
    });
  }

  async sendAudio(jid: string, buffer: Buffer, ptt = false): Promise<WAMessage | undefined> {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.sendMessage(jid, {
      audio: buffer,
      ptt,
      mimetype: 'audio/ogg; codecs=opus',
    });
  }

  async sendVideo(jid: string, buffer: Buffer, caption?: string): Promise<WAMessage | undefined> {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.sendMessage(jid, {
      video: buffer,
      caption,
    });
  }

  async sendSticker(jid: string, buffer: Buffer): Promise<WAMessage | undefined> {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.sendMessage(jid, { sticker: buffer });
  }

  async sendLocation(jid: string, lat: number, lng: number, name?: string, address?: string): Promise<WAMessage | undefined> {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.sendMessage(jid, {
      location: {
        degreesLatitude: lat,
        degreesLongitude: lng,
        name,
        address,
      },
    });
  }

  async sendContact(jid: string, contactJid: string, name: string): Promise<WAMessage | undefined> {
    if (!this.sock) throw new Error('Not connected');
    const safeName = sanitizeVCardField(name);
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${safeName}\nTEL;type=CELL;type=VOICE;waid=${contactJid.split('@')[0]}:+${contactJid.split('@')[0]}\nEND:VCARD`;
    return this.sock.sendMessage(jid, {
      contacts: { displayName: name, contacts: [{ vcard }] },
    });
  }

  async sendReaction(jid: string, messageId: string, emoji: string): Promise<WAMessage | undefined> {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.sendMessage(jid, {
      react: { text: emoji, key: { remoteJid: jid, id: messageId } as WAMessageKey },
    });
  }

  async markRead(jid: string, messageIds: string[]): Promise<void> {
    if (!this.sock) throw new Error('Not connected');
    await this.sock.readMessages(
      messageIds.map((id) => ({ remoteJid: jid, id }) as WAMessageKey)
    );
  }

  async sendPresenceUpdate(type: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused', jid?: string): Promise<void> {
    if (!this.sock) throw new Error('Not connected');
    await this.sock.sendPresenceUpdate(type, jid);
  }

  async getProfilePicUrl(jid: string): Promise<string | undefined> {
    if (!this.sock) throw new Error('Not connected');
    try {
      return await this.sock.profilePictureUrl(jid, 'image');
    } catch {
      return undefined;
    }
  }

  async updateProfileStatus(status: string): Promise<void> {
    if (!this.sock) throw new Error('Not connected');
    await this.sock.updateProfileStatus(status);
  }

  async getGroupMetadata(jid: string) {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.groupMetadata(jid);
  }

  async getGroupInviteCode(jid: string): Promise<string | undefined> {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.groupInviteCode(jid);
  }

  async groupUpdateSubject(jid: string, subject: string): Promise<void> {
    if (!this.sock) throw new Error('Not connected');
    await this.sock.groupUpdateSubject(jid, subject);
  }

  async groupUpdateDescription(jid: string, description: string): Promise<void> {
    if (!this.sock) throw new Error('Not connected');
    await this.sock.groupUpdateDescription(jid, description);
  }

  async groupParticipantsUpdate(jid: string, participants: string[], action: 'add' | 'remove' | 'promote' | 'demote') {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.groupParticipantsUpdate(jid, participants, action);
  }

  async downloadMedia(msg: WAMessage): Promise<Buffer> {
    if (!this.sock) throw new Error('Not connected');
    return downloadMediaMessage(msg, 'buffer', {}) as Promise<Buffer>;
  }
}

export const connectionManager = new ConnectionManager();
