import { visibleGameIds } from '../games/registry';
import { nowSeconds } from '../lib/time';
import type { PlayerRow } from './types';

/* ------------------------------------------------------- idempotency guards */

/** True when this call claimed the send. Cron is at-least-once and fires 4x/hour. */
export async function claimReminder(
  db: D1Database,
  userId: number,
  playDate: string,
): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO reminders (user_id, play_date, sent_at) VALUES (?, ?, ?)')
    .bind(userId, playDate, nowSeconds())
    .run();
  return res.meta.changes === 1;
}

/** Releases a claim so the next tick retries — call when the send failed. */
export async function releaseReminder(
  db: D1Database,
  userId: number,
  playDate: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM reminders WHERE user_id = ? AND play_date = ?')
    .bind(userId, playDate)
    .run();
}

/**
 * Players due a reminder this hour who have not been sent one today, with
 * their selected games attached — one query, not one per player.
 */
export async function getPlayersDue(
  db: D1Database,
  hour: number,
  playDate: string,
): Promise<{ player: PlayerRow; games: string[] }[]> {
  const { results } = await db
    .prepare(
      `SELECT p.user_id, p.username, p.first_name, p.reminder_hour, p.active, p.joined_at,
              pg.game
       FROM players p
       LEFT JOIN reminders r ON r.user_id = p.user_id AND r.play_date = ?
       LEFT JOIN player_games pg ON pg.user_id = p.user_id
       WHERE p.active = 1 AND p.reminder_hour = ? AND r.user_id IS NULL
       ORDER BY p.user_id`,
    )
    .bind(playDate, hour)
    .all<PlayerRow & { game: string | null }>();

  const visible = new Set(visibleGameIds());
  const byUser = new Map<number, { player: PlayerRow; games: string[] }>();

  for (const row of results) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      const { game: _game, ...player } = row;
      entry = { player, games: [] };
      byUser.set(row.user_id, entry);
    }
    if (row.game !== null && visible.has(row.game)) entry.games.push(row.game);
  }
  return [...byUser.values()];
}

export async function claimDigest(
  db: D1Database,
  chatId: number,
  playDate: string,
): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO digests (chat_id, play_date, posted_at) VALUES (?, ?, ?)')
    .bind(chatId, playDate, nowSeconds())
    .run();
  return res.meta.changes === 1;
}

export async function releaseDigest(
  db: D1Database,
  chatId: number,
  playDate: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM digests WHERE chat_id = ? AND play_date = ?')
    .bind(chatId, playDate)
    .run();
}
