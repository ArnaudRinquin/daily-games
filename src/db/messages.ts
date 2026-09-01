import { scoreStatements } from './scores';

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
