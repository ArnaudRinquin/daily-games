-- LinkedIn scores arrive by themselves: the cron reads the captain's
-- connections leaderboard through LinkedIn's internal API and needs to know
-- which LinkedIn profile is which Telegram player.

-- Every profile the leaderboard has ever shown, mapped or not. The unmapped
-- ones are what /admin/linkedin lists, and the names are what auto-linking
-- matches against.
CREATE TABLE IF NOT EXISTS linkedin_profiles (
  profile_urn       TEXT PRIMARY KEY,           -- urn:li:fsd_profile:ACoAA…, stable
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  public_identifier TEXT,                       -- the /in/<slug> vanity, for /linkedin <url>
  last_seen         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS linkedin_links (
  profile_urn TEXT PRIMARY KEY REFERENCES linkedin_profiles(profile_urn),
  user_id     INTEGER NOT NULL UNIQUE REFERENCES players(user_id),
  source      TEXT NOT NULL,                    -- 'auto' | 'self' | 'admin'
  linked_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_public ON linkedin_profiles (public_identifier);

-- Operator state for the import: the captain's own profile urn (so a lapsed
-- session knows whom to tell) and when they were last told.
CREATE TABLE IF NOT EXISTS linkedin_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
