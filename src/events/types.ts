import type { Contact } from '@whiskeysockets/baileys';

export interface Long {
  toNumber(): number;
}

export interface MediaMessageFields {
  mimetype?: string | null;
  fileLength?: number | Long | null;
  fileName?: string | null;
  seconds?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface ContactWithShortName extends Contact {
  shortName?: string;
}
