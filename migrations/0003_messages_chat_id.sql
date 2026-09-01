-- Group ingestion means the same user can produce message id 5 in a DM and
-- message id 5 in a group: Telegram numbers messages per chat, not per user.
-- The old UNIQUE (user_id, tg_message_id) would silently treat the second one
-- as a redelivery and drop it. The key has to include the chat.
CREATE TABLE IF NOT EXISTS messages_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id       INTEGER NOT NULL,
  tg_message_id INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  sent_at       INTEGER NOT NULL,
  text          TEXT NOT NULL,
  matched_games TEXT,
  UNIQUE (chat_id, tg_message_id)
);

-- Existing rows are all DMs, where chat id and user id are the same value.
INSERT OR IGNORE INTO messages_v2 (id, chat_id, tg_message_id, user_id, sent_at, text, matched_games)
  SELECT id, user_id, tg_message_id, user_id, sent_at, text, matched_games FROM messages;

DROP TABLE messages;
ALTER TABLE messages_v2 RENAME TO messages;

CREATE INDEX IF NOT EXISTS idx_messages_unmatched ON messages (sent_at) WHERE matched_games IS NULL;
