import { visibleGameIds } from '../games/registry';
import { nowSeconds } from '../lib/time';
import type { GroupRow, MemberInfo } from './types';

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
