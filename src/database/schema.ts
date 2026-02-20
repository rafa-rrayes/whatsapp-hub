import type Database from 'better-sqlite3-multiple-ciphers';

export function applySchema(db: Database.Database): void {
  db.exec(`
    -- ============================================================
    -- CONTACTS
    -- ============================================================
    CREATE TABLE IF NOT EXISTS contacts (
      jid             TEXT PRIMARY KEY,
      name            TEXT,
      notify_name     TEXT,
      short_name      TEXT,
      phone_number    TEXT,
      is_business     INTEGER DEFAULT 0,
      is_group        INTEGER DEFAULT 0,
      profile_pic_url TEXT,
      status_text     TEXT,
      first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- GROUPS
    -- ============================================================
    CREATE TABLE IF NOT EXISTS groups (
      jid             TEXT PRIMARY KEY,
      name            TEXT,
      description     TEXT,
      owner_jid       TEXT,
      creation_time   INTEGER,
      participant_count INTEGER DEFAULT 0,
      is_announce     INTEGER DEFAULT 0,
      is_restrict     INTEGER DEFAULT 0,
      profile_pic_url TEXT,
      invite_code     TEXT,
      first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_participants (
      group_jid       TEXT NOT NULL,
      participant_jid TEXT NOT NULL,
      role            TEXT DEFAULT 'member', -- admin, superadmin, member
      added_at        TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_jid, participant_jid)
    );

    -- ============================================================
    -- MESSAGES (the big one)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,           -- Baileys message key id
      remote_jid      TEXT NOT NULL,              -- chat jid
      from_jid        TEXT,                       -- sender jid
      from_me         INTEGER NOT NULL DEFAULT 0,
      participant     TEXT,                       -- in groups: actual sender
      timestamp       INTEGER NOT NULL,
      push_name       TEXT,
      message_type    TEXT,                       -- text, image, video, audio, document, sticker, reaction, poll, location, contact, etc.
      body            TEXT,                       -- text content / caption
      quoted_id       TEXT,                       -- id of quoted message
      quoted_body     TEXT,                       -- text of quoted message
      is_forwarded    INTEGER DEFAULT 0,
      forward_score   INTEGER DEFAULT 0,
      is_starred      INTEGER DEFAULT 0,
      is_broadcast    INTEGER DEFAULT 0,
      is_ephemeral    INTEGER DEFAULT 0,
      ephemeral_duration INTEGER,
      edit_type       INTEGER DEFAULT 0,          -- 0=none, 1=sender edit, 2=admin revoke
      edited_at       TEXT,
      is_deleted      INTEGER DEFAULT 0,
      deleted_at      TEXT,
      -- Media fields
      has_media       INTEGER DEFAULT 0,
      media_id        TEXT,                       -- FK to media table
      media_mime_type TEXT,
      media_size      INTEGER,
      media_filename  TEXT,
      media_duration  INTEGER,                    -- audio/video duration in seconds
      media_width     INTEGER,
      media_height    INTEGER,
      -- Reaction (if message_type = 'reaction')
      reaction_emoji  TEXT,
      reaction_target_id TEXT,
      -- Poll (if message_type = 'poll')
      poll_name       TEXT,
      poll_options    TEXT,                        -- JSON array
      -- Location (if message_type = 'location')
      latitude        REAL,
      longitude       REAL,
      location_name   TEXT,
      location_address TEXT,
      -- Raw data for anything we don't parse
      raw_message     TEXT,                        -- full JSON of the Baileys message
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_remote_jid ON messages(remote_jid);
    CREATE INDEX IF NOT EXISTS idx_messages_from_jid ON messages(from_jid);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
    CREATE INDEX IF NOT EXISTS idx_messages_body ON messages(body) WHERE body IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_remote_ts ON messages(remote_jid, timestamp);

    -- ============================================================
    -- MEDIA FILES
    -- ============================================================
    CREATE TABLE IF NOT EXISTS media (
      id              TEXT PRIMARY KEY,
      message_id      TEXT,
      mime_type       TEXT,
      file_size       INTEGER,
      filename        TEXT,
      original_filename TEXT,
      file_path       TEXT,                        -- relative path in media dir
      file_hash       TEXT,
      width           INTEGER,
      height          INTEGER,
      duration        INTEGER,
      thumbnail_path  TEXT,
      download_status TEXT DEFAULT 'pending',       -- pending, downloaded, failed, skipped
      download_error  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_media_message_id ON media(message_id);

    -- ============================================================
    -- MESSAGE STATUS / RECEIPTS
    -- ============================================================
    CREATE TABLE IF NOT EXISTS message_receipts (
      message_id      TEXT NOT NULL,
      recipient_jid   TEXT NOT NULL,
      status          TEXT NOT NULL,                -- sent, delivered, read, played
      timestamp       INTEGER,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, recipient_jid)
    );

    -- ============================================================
    -- PRESENCE LOG
    -- ============================================================
    CREATE TABLE IF NOT EXISTS presence_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      jid             TEXT NOT NULL,
      status          TEXT NOT NULL,                 -- available, unavailable, composing, recording, paused
      last_seen       INTEGER,
      logged_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_presence_jid ON presence_log(jid);
    CREATE INDEX IF NOT EXISTS idx_presence_logged ON presence_log(logged_at);

    -- ============================================================
    -- CALL LOG
    -- ============================================================
    CREATE TABLE IF NOT EXISTS call_log (
      id              TEXT PRIMARY KEY,
      from_jid        TEXT NOT NULL,
      is_group        INTEGER DEFAULT 0,
      is_video        INTEGER DEFAULT 0,
      status          TEXT,                          -- offer, accept, reject, timeout
      timestamp       INTEGER NOT NULL,
      duration        INTEGER,
      participants    TEXT,                           -- JSON array of jids
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- STATUS/STORY UPDATES
    -- ============================================================
    CREATE TABLE IF NOT EXISTS status_updates (
      id              TEXT PRIMARY KEY,
      from_jid        TEXT NOT NULL,
      timestamp       INTEGER NOT NULL,
      message_type    TEXT,
      body            TEXT,
      media_id        TEXT,
      raw_message     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- LABELS (WhatsApp Business labels)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS labels (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      color           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS label_associations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      label_id        TEXT NOT NULL,
      chat_jid        TEXT,
      message_id      TEXT,
      type            TEXT NOT NULL,                  -- chat, message
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_label_associations_unique
      ON label_associations(label_id, type, COALESCE(chat_jid, ''), COALESCE(message_id, ''));

    -- ============================================================
    -- WEBHOOK SUBSCRIPTIONS
    -- ============================================================
    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id              TEXT PRIMARY KEY,
      url             TEXT NOT NULL,
      secret          TEXT,
      events          TEXT NOT NULL DEFAULT '*',       -- comma-separated event types or '*'
      is_active       INTEGER DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- EVENT LOG (raw event audit trail)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS event_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type      TEXT NOT NULL,
      payload         TEXT,                            -- JSON
      logged_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_event_log_time ON event_log(logged_at);

    -- ============================================================
    -- JID ALIASES (LID ↔ phone number JID mapping)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS jid_aliases (
      lid           TEXT PRIMARY KEY,          -- e.g. 53047342428326@lid
      phone_jid     TEXT NOT NULL,             -- e.g. 5511941422626@s.whatsapp.net
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_jid_aliases_phone ON jid_aliases(phone_jid);

    -- ============================================================
    -- CHAT METADATA (aggregated per-chat info)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS chats (
      jid               TEXT PRIMARY KEY,
      name              TEXT,
      is_group          INTEGER DEFAULT 0,
      is_archived       INTEGER DEFAULT 0,
      is_pinned         INTEGER DEFAULT 0,
      is_muted          INTEGER DEFAULT 0,
      mute_expiry       INTEGER,
      unread_count      INTEGER DEFAULT 0,
      last_message_ts   INTEGER,
      last_message_body TEXT,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- RUNTIME SETTINGS (key-value overrides; .env provides defaults)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
