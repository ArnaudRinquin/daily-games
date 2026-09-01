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
export function logMessageStatement(
  db: D1Database,
  msg: {
    chatId: number;
    tgMessageId: number;
    userId: number;
    sentAt: number;
    text: string;
    matchedGames: string[];
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO messages (chat_id, tg_message_id, user_id, sent_at, text, matched_games)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      msg.chatId,
      msg.tgMessageId,
      msg.userId,
      msg.sentAt,
      msg.text,
      msg.matchedGames.length > 0 ? JSON.stringify(msg.matchedGames) : null,
    );
}

/** Re-submitting a game overwrites that day's score. */
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
export async function getUnmatchedMessages(
  db: D1Database,
  limit = 50,
): Promise<{ text: string; sent_at: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT text, sent_at FROM messages WHERE matched_games IS NULL
       ORDER BY sent_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ text: string; sent_at: number }>();
  return results;
}

/* --------------------------------------------------------------------- cron */

export interface MemberInfo {
  userId: number;
  name: string;
  active: boolean;
  joinedAt: number;
  /** Selected games, already filtered to those with a working parser. */
  games: string[];
}

export async function getActiveGroups(db: D1Database): Promise<GroupRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM groups WHERE active = 1 ORDER BY chat_id')
    .all<GroupRow>();
  return results;
}

/**
 * Membership AND per-member game selection for every active group, in one
 * query. The Workers free tier allows 50 D1 queries per invocation, so the
 * cron must never issue a query per group or per player.
 */
export async function getAllGroupMembers(
  db: D1Database,
): Promise<Map<number, MemberInfo[]>> {
  const { results } = await db
    .prepare(
      `SELECT m.chat_id, p.user_id, p.first_name, p.active, m.joined_at, pg.game
       FROM memberships m
       JOIN groups  g ON g.chat_id = m.chat_id AND g.active = 1
       JOIN players p ON p.user_id = m.user_id
       LEFT JOIN player_games pg ON pg.user_id = p.user_id
       ORDER BY m.chat_id, p.first_name, p.user_id`,
    )
    .all<{
      chat_id: number;
      user_id: number;
      first_name: string;
      active: number;
      joined_at: number;
      game: string | null;
    }>();

  const visible = new Set(visibleGameIds());
  const byChat = new Map<number, Map<number, MemberInfo>>();

  for (const row of results) {
    let members = byChat.get(row.chat_id);
    if (!members) {
      members = new Map();
      byChat.set(row.chat_id, members);
    }
    let member = members.get(row.user_id);
    if (!member) {
      member = {
        userId: row.user_id,
        name: row.first_name,
        active: row.active === 1,
        joinedAt: row.joined_at,
        games: [],
      };
      members.set(row.user_id, member);
    }
    if (row.game !== null && visible.has(row.game)) member.games.push(row.game);
  }

  return new Map([...byChat].map(([chatId, members]) => [chatId, [...members.values()]]));
}

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

/**
 * Re-parses stored messages that nothing recognised at the time and writes any
 * scores a fixed parser now finds. This is the point of logging every DM: a
 * parser fix recovers the days it missed instead of losing them.
 */
export async function replayUnmatched(
  db: D1Database,
  parse: (text: string) => { game: string; value: number; display: string }[],
  playDateOf: (sentAt: number) => string,
  limit = 100,
): Promise<{ scanned: number; recovered: number; scores: number }> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, sent_at, text FROM messages
       WHERE matched_games IS NULL ORDER BY id LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: number; user_id: number; sent_at: number; text: string }>();

  const statements: D1PreparedStatement[] = [];
  let recovered = 0;
  let scores = 0;

  for (const row of results) {
    const matches = parse(row.text);
    if (matches.length === 0) continue;
    recovered++;
    scores += matches.length;
    statements.push(
      db
        .prepare('UPDATE messages SET matched_games = ? WHERE id = ?')
        .bind(JSON.stringify(matches.map((m) => m.game)), row.id),
      ...scoreStatements(db, row.user_id, playDateOf(row.sent_at), row.text, matches),
    );
  }

  if (statements.length > 0) await db.batch(statements);
  return { scanned: results.length, recovered, scores };
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
