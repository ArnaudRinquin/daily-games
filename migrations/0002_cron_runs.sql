-- Every cron tick leaves a row. Cloudflare's scheduler is otherwise invisible:
-- a tick that does no work looks identical to a tick that never happened, and
-- `wrangler tail` cannot prove a negative.
CREATE TABLE IF NOT EXISTS cron_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at         INTEGER NOT NULL,
  source         TEXT NOT NULL,          -- 'schedule' | 'manual'
  reminders_sent INTEGER NOT NULL,
  digests_posted INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_ran_at ON cron_runs (ran_at DESC);
