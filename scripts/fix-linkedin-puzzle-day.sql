-- One-off: LinkedIn rows imported between 04:00 and 09:00 Paris (02-07Z in
-- summer) were yesterday's board filed under today. Move them back a day when
-- yesterday has no row, else drop them. Run once after deploying the fix:
--   pnpm exec wrangler d1 execute daily-games --remote --file=scripts/fix-linkedin-puzzle-day.sql -y
UPDATE scores SET play_date = date(play_date, '-1 day')
WHERE raw LIKE '{"source":"linkedin"%'
  AND CAST(strftime('%H', created_at, 'unixepoch') AS INTEGER) BETWEEN 2 AND 6
  AND NOT EXISTS (
    SELECT 1 FROM scores p
    WHERE p.user_id = scores.user_id AND p.game = scores.game
      AND p.play_date = date(scores.play_date, '-1 day'));
DELETE FROM scores
WHERE raw LIKE '{"source":"linkedin"%'
  AND CAST(strftime('%H', created_at, 'unixepoch') AS INTEGER) BETWEEN 2 AND 6;
