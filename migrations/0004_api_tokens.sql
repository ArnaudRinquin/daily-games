-- A per-player secret so a phone Shortcut can submit results over HTTP,
-- bypassing the paste-into-Telegram step. /shortcut mints or rotates it.
ALTER TABLE players ADD COLUMN api_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_api_token ON players (api_token);
