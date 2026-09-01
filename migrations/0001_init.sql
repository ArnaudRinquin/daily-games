-- Daily games bot — initial schema.
-- All dates are YYYY-MM-DD in Europe/Paris, produced by lib/time.ts playDate().
-- All timestamps are unix seconds (UTC).

CREATE TABLE IF NOT EXISTS players (
  user_id       INTEGER PRIMARY KEY,          -- Telegram user id
  username      TEXT,
  first_name    TEXT NOT NULL,
  reminder_hour INTEGER NOT NULL DEFAULT 9    -- Europe/Paris; clamped, see 1.4
                CHECK (reminder_hour BETWEEN 6 AND 22),
  active        INTEGER NOT NULL DEFAULT 1,
  joined_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_games (
  user_id INTEGER NOT NULL REFERENCES players(user_id),
  game    TEXT NOT NULL,
  PRIMARY KEY (user_id, game)
);

CREATE TABLE IF NOT EXISTS groups (
  chat_id   INTEGER PRIMARY KEY,
  title     TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,       -- 0 once the bot is removed
  joined_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  chat_id   INTEGER NOT NULL REFERENCES groups(chat_id),
  user_id   INTEGER NOT NULL REFERENCES players(user_id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

-- Every DM, parsed or not. Calibration corpus:
--   SELECT text FROM messages WHERE matched_games IS NULL ORDER BY sent_at DESC;
CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_message_id INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  sent_at       INTEGER NOT NULL,
  text          TEXT NOT NULL,
  matched_games TEXT,                         -- JSON array of game ids; NULL = nothing matched
  UNIQUE (user_id, tg_message_id)
);

-- One row per player per game per day. Re-submitting overwrites.
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES players(user_id),
  game       TEXT NOT NULL,
  play_date  TEXT NOT NULL,                   -- YYYY-MM-DD, Europe/Paris
  value      REAL NOT NULL,                   -- normalised, lower is always better
  display    TEXT NOT NULL,                   -- player-facing: "1:42", "4/6", "870 pts"
  raw        TEXT NOT NULL,                   -- original message, for re-parsing
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, game, play_date)
);

-- Idempotency guard: cron is at-least-once and fires 4x/hour.
CREATE TABLE IF NOT EXISTS reminders (
  user_id   INTEGER NOT NULL REFERENCES players(user_id),
  play_date TEXT NOT NULL,
  sent_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, play_date)
);

-- Idempotency guard for the completion-or-cutoff race.
CREATE TABLE IF NOT EXISTS digests (
  chat_id   INTEGER NOT NULL REFERENCES groups(chat_id),
  play_date TEXT NOT NULL,
  posted_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, play_date)
);

CREATE INDEX IF NOT EXISTS idx_scores_date ON scores (play_date);
CREATE INDEX IF NOT EXISTS idx_scores_game_date ON scores (game, play_date);
CREATE INDEX IF NOT EXISTS idx_messages_unmatched ON messages (sent_at) WHERE matched_games IS NULL;
