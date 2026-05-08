import type { ExportRequest } from '../api/schemas.js';
import type { ChatRow } from '../database/repositories/chats.js';
import type { MessageRow } from '../database/repositories/messages.js';
import type { MediaRow } from '../database/repositories/media.js';

export type ExportOptions = ExportRequest;

export interface ResolvedTimeWindow {
  from: number;
  to: number;
}

export interface SelectedChat {
  chat: ChatRow;
  message_count: number;
  participant_jids?: string[];
}

export interface SelectedMessage extends MessageRow {
  media_row?: MediaRow;
  reactions_to_self?: Array<{ emoji: string; from_jid?: string; from_label: string }>;
}

export interface ExportContext {
  options: ExportOptions;
  window: ResolvedTimeWindow;
  baseUrl: string;
  generatedAt: Date;
  resolveName: (jid: string | undefined, fallbackPushName?: string) => string;
  resolveChatLabel: (jid: string) => string;
  formatTime: (unixSeconds: number) => string;
  formatDate: (unixSeconds: number) => string;
  formatDateGroup: (unixSeconds: number) => string;
  fields: Set<MessageField>;
}

export type MessageField =
  | 'timestamp' | 'sender' | 'body' | 'media' | 'reply' | 'reactions'
  | 'id' | 'edits' | 'forwarded' | 'starred';

export const PRESETS: Record<string, MessageField[]> = {
  concise: ['timestamp', 'sender', 'body'],
  full: ['timestamp', 'sender', 'body', 'media', 'reply', 'reactions', 'edits', 'forwarded', 'starred'],
  llm: ['timestamp', 'sender', 'body', 'media', 'reply', 'id', 'edits'],
  archive: ['timestamp', 'sender', 'body', 'media', 'reply', 'reactions', 'id', 'edits', 'forwarded', 'starred'],
};
