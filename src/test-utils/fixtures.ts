import type { MessageRow } from '../database/repositories/messages.js';
import type { MediaRow } from '../database/repositories/media.js';

let counter = 0;
function nextId(): string {
  return `test-id-${++counter}-${Date.now()}`;
}

/** Reset the ID counter (call in beforeEach if needed). */
export function resetFixtures(): void {
  counter = 0;
}

export function makeMessage(overrides: Partial<MessageRow> = {}): Partial<MessageRow> {
  const id = overrides.id || nextId();
  return {
    id,
    remote_jid: '5511999999999@s.whatsapp.net',
    from_jid: '5511999999999@s.whatsapp.net',
    from_me: 0,
    timestamp: Math.floor(Date.now() / 1000),
    message_type: 'text',
    body: `Test message ${id}`,
    is_forwarded: 0,
    forward_score: 0,
    is_starred: 0,
    is_broadcast: 0,
    is_ephemeral: 0,
    edit_type: 0,
    is_deleted: 0,
    has_media: 0,
    ...overrides,
  };
}

export function makeMedia(overrides: Partial<MediaRow> = {}): Partial<MediaRow> {
  return {
    id: overrides.id || nextId(),
    message_id: overrides.message_id || nextId(),
    mime_type: 'image/jpeg',
    file_size: 1024,
    download_status: 'pending',
    ...overrides,
  };
}
