import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { parseAll } from '../../src/games/registry';
import { getUnmatchedMessages, logMessageStatement } from '../../src/db/messages';
import { ensurePlayer } from '../../src/db/players';
import { getPlayerScores, scoreStatements } from '../../src/db/scores';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages'),
    env.DB.prepare('DELETE FROM scores'),
    env.DB.prepare('DELETE FROM player_games'),
    env.DB.prepare('DELETE FROM players'),
  ]);
  await ensurePlayer(env.DB, { id: 1, username: 'alice', first_name: 'Alice' });
});

/** Mirrors what bot/ingest.ts does, minus Telegram. */
async function ingest(text: string, tgMessageId: number, date = '2026-09-01', chatId = 1) {
  const matches = parseAll(text);
  const [logResult] = await env.DB.batch([
    logMessageStatement(env.DB, {
      chatId,
      tgMessageId,
      userId: 1,
      sentAt: 1_756_700_000,
      text,
      matchedGames: matches.map((m) => m.game),
    }),
    ...scoreStatements(env.DB, 1, date, text, matches),
  ]);
  return { isNew: logResult?.meta.changes === 1, matches };
}

describe('log-first ingestion', () => {
  test('a parsed message writes both the log row and the scores', async () => {
    const { isNew, matches } = await ingest('Queens #1 | 0:42', 100);
    expect(isNew).toBe(true);
    expect(matches).toHaveLength(1);

    const scores = await getPlayerScores(env.DB, 1, '2026-09-01');
    expect(scores).toHaveLength(1);
    expect(scores[0]?.display).toBe('0:42');
    expect(scores[0]?.raw).toBe('Queens #1 | 0:42');
  });

  test('unrecognised text is still stored, as the calibration corpus', async () => {
    await ingest('some brand new game 12/13 ????', 101);
    const unmatched = await getUnmatchedMessages(env.DB);
    expect(unmatched.map((m) => m.text)).toEqual(['some brand new game 12/13 ????']);
    expect(await getPlayerScores(env.DB, 1, '2026-09-01')).toHaveLength(0);
  });

  test('a parsed message never shows up in the calibration corpus', async () => {
    await ingest('Queens #1 | 0:42', 102);
    expect(await getUnmatchedMessages(env.DB)).toEqual([]);
  });

  test('a redelivered webhook is discarded, not double-acked', async () => {
    expect((await ingest('Queens #1 | 0:42', 103)).isNew).toBe(true);
    expect((await ingest('Queens #1 | 0:42', 103)).isNew).toBe(false);
    expect(await getPlayerScores(env.DB, 1, '2026-09-01')).toHaveLength(1);
  });

  test('re-submitting the same game overwrites the day', async () => {
    await ingest('Queens #1 | 0:42', 104);
    await ingest('Queens #1 | 0:31', 105);
    const scores = await getPlayerScores(env.DB, 1, '2026-09-01');
    expect(scores).toHaveLength(1);
    expect(scores[0]?.display).toBe('0:31');
    expect(scores[0]?.value).toBe(31);
  });

  test('one message can write several games at once', async () => {
    await ingest('Queens #1 | 0:42\nTango #1 | 1:05\nZip #1 | 0:33', 106);
    const scores = await getPlayerScores(env.DB, 1, '2026-09-01');
    expect(scores.map((s) => s.game).sort()).toEqual(['queens', 'tango', 'zip']);
  });

  test('a DM and a group message can share a message id without colliding', async () => {
    // Telegram numbers messages per chat, so this collision is routine.
    expect((await ingest('Queens #1 | 0:42', 500, '2026-09-01', 1)).isNew).toBe(true);
    expect((await ingest('Zip #1 | 0:05', 500, '2026-09-01', -100999)).isNew).toBe(true);
    const games = (await getPlayerScores(env.DB, 1, '2026-09-01')).map((s) => s.game).sort();
    expect(games).toEqual(['queens', 'zip']);
  });

  test('the same game on two days makes two rows', async () => {
    await ingest('Queens #1 | 0:42', 107, '2026-09-01');
    await ingest('Queens #2 | 0:44', 108, '2026-09-02');
    expect(await getPlayerScores(env.DB, 1, '2026-09-01')).toHaveLength(1);
    expect(await getPlayerScores(env.DB, 1, '2026-09-02')).toHaveLength(1);
  });
});

describe('batch atomicity', () => {
  test('a failing score write rolls back the message log', async () => {
    const text = 'Queens #1 | 0:42';
    await expect(
      env.DB.batch([
        logMessageStatement(env.DB, {
          chatId: 1,
          tgMessageId: 200,
          userId: 1,
          sentAt: 1_756_700_000,
          text,
          matchedGames: ['queens'],
        }),
        // NOT NULL violation: the score write fails.
        env.DB.prepare(
          `INSERT INTO scores (user_id, game, play_date, value, display, raw, created_at)
           VALUES (1, 'queens', '2026-09-01', 42, '0:42', NULL, 0)`,
        ),
      ]),
    ).rejects.toThrow();

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE tg_message_id = 200')
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
