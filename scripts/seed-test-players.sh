#!/usr/bin/env bash
#
# Adds fake players to the TEST group only, so you can see ranking, ties and
# absences on a real digest without recruiting anyone.
#
# They are inserted with active = 0, which is exactly what a test dummy needs:
#   - never DM'd  (getPlayersDue filters on active = 1, and the bot cannot DM
#                  a user id that never started it anyway)
#   - never blocks the digest (isComplete only waits on active members)
#   - still ranked, and still counted in the field size
#
# Usage:
#   TEST_CHAT=-100123 SEED_FROM_USER=456 bash scripts/seed-test-players.sh
#   bash scripts/seed-test-players.sh --undo
set -euo pipefail
cd "$(dirname "$0")/.."

DAY="$(TZ=Europe/Paris date +%F)"
DB=daily-games

run() { pnpm exec wrangler d1 execute "$DB" --remote -y --command "$1" >/dev/null; }

if [ "${1:-}" = "--undo" ]; then
  run "DELETE FROM scores      WHERE user_id BETWEEN 999000001 AND 999000999;
       DELETE FROM player_games WHERE user_id BETWEEN 999000001 AND 999000999;
       DELETE FROM memberships  WHERE user_id BETWEEN 999000001 AND 999000999;
       DELETE FROM players      WHERE user_id BETWEEN 999000001 AND 999000999;"
  echo "removed the fake players"
  exit 0
fi

# Your own ids, kept out of the repo. Find the chat id in the groups table:
#   wrangler d1 execute daily-games --remote -y --command "SELECT chat_id, title FROM groups"
: "${TEST_CHAT:?set TEST_CHAT to the chat id of your TEST group}"
: "${SEED_FROM_USER:?set SEED_FROM_USER to a user id whose game selection to copy}"
# 999000xxx cannot collide with a real Telegram id.
run "INSERT OR IGNORE INTO players (user_id, username, first_name, reminder_hour, active, joined_at)
     VALUES (999000001, NULL, 'Camille', 9, 0, unixepoch()),
            (999000002, NULL, 'Thomas',  9, 0, unixepoch()),
            (999000003, NULL, 'Lea',     9, 0, unixepoch());"

run "INSERT OR IGNORE INTO memberships (chat_id, user_id, joined_at)
     VALUES ($TEST_CHAT, 999000001, unixepoch()),
            ($TEST_CHAT, 999000002, unixepoch()),
            ($TEST_CHAT, 999000003, unixepoch());"

# Everyone selects everything, so the field size is the whole group.
run "INSERT OR IGNORE INTO player_games (user_id, game)
     SELECT p.user_id, g.game FROM
       (SELECT 999000001 AS user_id UNION SELECT 999000002 UNION SELECT 999000003) p,
       (SELECT DISTINCT game FROM player_games WHERE user_id = $SEED_FROM_USER) g;"

# Deliberately shaped to exercise the ranking: a tie for first (patches),
# another tie (queens), a clear winner per game, and two absences for Lea.
run "INSERT OR REPLACE INTO scores (user_id, game, play_date, value, display, raw, created_at) VALUES
  (999000001,'queens','$DAY',      9,'0:09','seed',unixepoch()),
  (999000001,'zip','$DAY',        12,'0:12','seed',unixepoch()),
  (999000001,'wend','$DAY',       38,'0:38','seed',unixepoch()),
  (999000001,'minisudoku','$DAY', 61,'1:01','seed',unixepoch()),
  (999000001,'patches','$DAY',     7,'0:07','seed',unixepoch()),
  (999000001,'wordle','$DAY',      4,'4/6','seed',unixepoch()),
  (999000002,'queens','$DAY',     20,'0:20','seed',unixepoch()),
  (999000002,'zip','$DAY',         8,'0:08','seed',unixepoch()),
  (999000002,'wend','$DAY',       55,'0:55','seed',unixepoch()),
  (999000002,'minisudoku','$DAY', 47,'0:47','seed',unixepoch()),
  (999000002,'patches','$DAY',    15,'0:15','seed',unixepoch()),
  (999000002,'wordle','$DAY',      5,'5/6','seed',unixepoch()),
  (999000003,'queens','$DAY',     11,'0:11','seed',unixepoch()),
  (999000003,'zip','$DAY',        30,'0:30','seed',unixepoch()),
  (999000003,'minisudoku','$DAY', 90,'1:30','seed',unixepoch()),
  (999000003,'wordle','$DAY',      7,'X/6','seed',unixepoch());"

echo "seeded Camille, Thomas and Lea into the test group for $DAY"
echo "  queens  : Camille 0:09 < Arnaud 0:11 = Lea 0:11 < Thomas 0:20   (tie for 2nd)"
echo "  patches : Arnaud 0:07 = Camille 0:07 < Thomas 0:15, Lea absent   (tie for 1st)"
echo "  wend    : Lea absent"
