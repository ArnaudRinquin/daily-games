import { visibleGameIds } from '../games/registry';
import { clampReminderHour, nowSeconds } from './time';

export interface PlayerRow {
  user_id: number;
  username: string | null;
  first_name: string;
  reminder_hour: number;
  active: number;
  joined_at: number;
}

export interface GroupRow {
  chat_id: number;
  title: string;
  active: number;
  joined_at: number;
}

export interface ScoreRow {
  user_id: number;
  game: string;
  play_date: string;
  value: number;
  display: string;
  raw: string;
}

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

/* ------------------------------------------------------- groups & membership */

export async function upsertGroup(
  db: D1Database,
  chatId: number,
  title: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO groups (chat_id, title, active, joined_at) VALUES (?, ?, 1, ?)
       ON CONFLICT (chat_id) DO UPDATE SET title = excluded.title, active = 1`,
    )
    .bind(chatId, title, nowSeconds())
    .run();
}

export async function deactivateGroup(db: D1Database, chatId: number): Promise<void> {
  await db.prepare('UPDATE groups SET active = 0 WHERE chat_id = ?').bind(chatId).run();
}

export async function getGroup(db: D1Database, chatId: number): Promise<GroupRow | null> {
  return db.prepare('SELECT * FROM groups WHERE chat_id = ?').bind(chatId).first<GroupRow>();
}

/** Returns true when the membership row was newly created. */
export async function addMembership(
  db: D1Database,
  chatId: number,
  userId: number,
): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO memberships (chat_id, user_id, joined_at) VALUES (?, ?, ?)')
    .bind(chatId, userId, nowSeconds())
    .run();
  return res.meta.changes === 1;
}

export async function getMemberGroups(db: D1Database, userId: number): Promise<GroupRow[]> {
  const { results } = await db
    .prepare(
      `SELECT g.* FROM groups g
       JOIN memberships m ON m.chat_id = g.chat_id
       WHERE m.user_id = ? AND g.active = 1
       ORDER BY g.title`,
    )
    .bind(userId)
    .all<GroupRow>();
  return results;
}
