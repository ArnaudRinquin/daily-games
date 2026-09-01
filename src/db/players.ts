import { visibleGameIds } from '../games/registry';
import { clampReminderHour, nowSeconds } from '../lib/time';
import type { PlayerRow } from './types';

/* ------------------------------------------------------------------ players */

export async function getPlayer(db: D1Database, userId: number): Promise<PlayerRow | null> {
  return db.prepare('SELECT * FROM players WHERE user_id = ?').bind(userId).first<PlayerRow>();
}

/**
 * Creates the player on first /start with every visible game pre-selected and a
 * 09:00 reminder, so tapping the deep link is by itself enough to start.
 * Returns true when the player was newly created.
 */
export async function ensurePlayer(
  db: D1Database,
  user: { id: number; username?: string | undefined; first_name: string },
): Promise<{ created: boolean; player: PlayerRow }> {
  const existing = await getPlayer(db, user.id);
  if (existing) {
    // Keep the display name fresh, but never touch their settings.
    await db
      .prepare('UPDATE players SET username = ?, first_name = ?, active = 1 WHERE user_id = ?')
      .bind(user.username ?? null, user.first_name, user.id)
      .run();
    return { created: false, player: { ...existing, active: 1 } };
  }

  const now = nowSeconds();
  const statements = [
    db
      .prepare(
        `INSERT INTO players (user_id, username, first_name, reminder_hour, active, joined_at)
         VALUES (?, ?, ?, 9, 1, ?)`,
      )
      .bind(user.id, user.username ?? null, user.first_name, now),
    ...visibleGameIds().map((game) =>
      db
        .prepare('INSERT OR IGNORE INTO player_games (user_id, game) VALUES (?, ?)')
        .bind(user.id, game),
    ),
  ];
  await db.batch(statements);

  return {
    created: true,
    player: {
      user_id: user.id,
      username: user.username ?? null,
      first_name: user.first_name,
      reminder_hour: 9,
      active: 1,
      joined_at: now,
    },
  };
}

/**
 * Records someone seen posting a score in a group who has never DM'd the bot.
 *
 * They are created INACTIVE on purpose: a bot cannot DM a user who has not
 * started it, so marking them active would queue a reminder that fails and
 * retries every tick forever. They still get ranked. If they later /start,
 * `ensurePlayer` flips them active and reminders begin.
 */
export async function ensurePlayerSeen(
  db: D1Database,
  user: { id: number; username?: string | undefined; first_name: string },
): Promise<void> {
  const existing = await getPlayer(db, user.id);
  if (existing) {
    await db
      .prepare('UPDATE players SET username = ?, first_name = ? WHERE user_id = ?')
      .bind(user.username ?? null, user.first_name, user.id)
      .run();
    return;
  }
  const now = nowSeconds();
  await db.batch([
    db
      .prepare(
        `INSERT INTO players (user_id, username, first_name, reminder_hour, active, joined_at)
         VALUES (?, ?, ?, 9, 0, ?)`,
      )
      .bind(user.id, user.username ?? null, user.first_name, now),
    ...visibleGameIds().map((game) =>
      db
        .prepare('INSERT OR IGNORE INTO player_games (user_id, game) VALUES (?, ?)')
        .bind(user.id, game),
    ),
  ]);
}

export async function setReminderHour(
  db: D1Database,
  userId: number,
  hour: number,
): Promise<number> {
  const clamped = clampReminderHour(hour);
  await db
    .prepare('UPDATE players SET reminder_hour = ? WHERE user_id = ?')
    .bind(clamped, userId)
    .run();
  return clamped;
}

export async function setPlayerActive(
  db: D1Database,
  userId: number,
  active: boolean,
): Promise<void> {
  await db
    .prepare('UPDATE players SET active = ? WHERE user_id = ?')
    .bind(active ? 1 : 0, userId)
    .run();
}

/* ------------------------------------------------------------- player games */

/** Selected games, filtered to those with a working parser (correction 1.8). */
export async function getSelectedGames(db: D1Database, userId: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT game FROM player_games WHERE user_id = ?')
    .bind(userId)
    .all<{ game: string }>();
  const visible = new Set(visibleGameIds());
  return results.map((r) => r.game).filter((g) => visible.has(g));
}

/** Returns the new selection state for that game. */
export async function toggleGame(
  db: D1Database,
  userId: number,
  game: string,
): Promise<boolean> {
  const existing = await db
    .prepare('SELECT 1 AS present FROM player_games WHERE user_id = ? AND game = ?')
    .bind(userId, game)
    .first<{ present: number }>();

  if (existing) {
    await db
      .prepare('DELETE FROM player_games WHERE user_id = ? AND game = ?')
      .bind(userId, game)
      .run();
    return false;
  }
  await db
    .prepare('INSERT OR IGNORE INTO player_games (user_id, game) VALUES (?, ?)')
    .bind(userId, game)
    .run();
  return true;
}

/**
 * Adds one game to every active player's selection.
 *
 * `player_games` is seeded at signup, so a game added to the catalog later
 * reaches nobody who already joined. Deliberately per-game and explicit rather
 * than "sync everything": a blanket resync would silently re-add games people
 * had chosen to turn off.
 */
export async function offerGameToEveryone(
  db: D1Database,
  game: string,
): Promise<{ added: number }> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO player_games (user_id, game)
       SELECT user_id, ? FROM players WHERE active = 1`,
    )
    .bind(game)
    .run();
  return { added: res.meta.changes };
}
