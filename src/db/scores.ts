import { nowSeconds } from '../lib/time';
import type { ScoreRow } from './types';

/* ------------------------------------------------------------------- scores */

export async function getPlayerScores(
  db: D1Database,
  userId: number,
  playDate: string,
): Promise<ScoreRow[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, game, play_date, value, display, raw
       FROM scores WHERE user_id = ? AND play_date = ?`,
    )
    .bind(userId, playDate)
    .all<ScoreRow>();
  return results;
}

/**
 * Statement that logs a DM before anything is parsed. `matched_games` is a JSON
 * array, or NULL when nothing recognised the text — the calibration query
 * depends on that NULL:
 *   SELECT text FROM messages WHERE matched_games IS NULL ORDER BY sent_at DESC;
 *
 * Returned rather than executed so it can be batched with the score writes:
 * D1 runs a batch as one transaction, so a message is never recorded as parsed
 * without its scores landing too.
 */

export function scoreStatements(
  db: D1Database,
  userId: number,
  playDate: string,
  raw: string,
  matches: readonly { game: string; value: number; display: string }[],
): D1PreparedStatement[] {
  const now = nowSeconds();
  return matches.map((m) =>
    db
      .prepare(
        `INSERT INTO scores (user_id, game, play_date, value, display, raw, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, game, play_date) DO UPDATE SET
           value = excluded.value,
           display = excluded.display,
           raw = excluded.raw,
           created_at = excluded.created_at`,
      )
      .bind(userId, m.game, playDate, m.value, m.display, raw, now),
  );
}

/** Unparsed DMs, newest first — the calibration corpus. */

export async function getScoresForDate(
  db: D1Database,
  playDate: string,
): Promise<ScoreRow[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, game, play_date, value, display, raw
       FROM scores WHERE play_date = ?`,
    )
    .bind(playDate)
    .all<ScoreRow>();
  return results;
}

export async function getScoresBetween(
  db: D1Database,
  fromDate: string,
  toDate: string,
): Promise<ScoreRow[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, game, play_date, value, display, raw
       FROM scores WHERE play_date BETWEEN ? AND ?`,
    )
    .bind(fromDate, toDate)
    .all<ScoreRow>();
  return results;
}
