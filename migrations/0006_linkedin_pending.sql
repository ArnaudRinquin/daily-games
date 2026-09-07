-- A link asked for by profile slug before that profile has ever appeared on
-- the captain's leaderboard. The import resolves it into linkedin_links the
-- first time the slug shows up, so a player can link before playing and the
-- operator can pre-feed the group.
CREATE TABLE IF NOT EXISTS linkedin_pending (
  public_identifier TEXT PRIMARY KEY,           -- the /in/<slug>, lower-cased
  user_id           INTEGER NOT NULL UNIQUE REFERENCES players(user_id),
  source            TEXT NOT NULL,              -- 'self' | 'admin'
  created_at        INTEGER NOT NULL
);
