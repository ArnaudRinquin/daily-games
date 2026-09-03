import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ensurePlayer, getPlayerByToken, rotateApiToken } from '../../src/db/players';
import { getUnmatchedMessages } from '../../src/db/messages';
import { getPlayerScores } from '../../src/db/scores';
import { syntheticMessageId } from '../../src/lib/ingest';
import { playDate } from '../../src/lib/time';

const SAMPLE = 'Queens #854 | 0:11 👑\nlnkd.in/queens.';

// The DM mirror must never reach Telegram from a test. Swap the transport.
const sent: { chatId: number; text: string }[] = [];
vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>();
  class Api {
    async sendMessage(chatId: number, text: string) {
      sent.push({ chatId, text });
      return { message_id: 1 };
    }
  }
  return { ...actual, Api };
});

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
  await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
  sent.length = 0;
});

const post = (token: string, body: string, contentType = 'text/plain') =>
  SELF.fetch(`https://example.com/api/ingest/${token}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });

describe('token', () => {
  test('rotating replaces the old one', async () => {
    const first = await rotateApiToken(env.DB, 1);
    const second = await rotateApiToken(env.DB, 1);
    expect(first).not.toBe(second);
    expect(await getPlayerByToken(env.DB, first)).toBeNull();
    expect((await getPlayerByToken(env.DB, second))?.user_id).toBe(1);
  });

  test('is url-safe', async () => {
    expect(await rotateApiToken(env.DB, 1)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  test('unknown or empty token is rejected before anything is read', async () => {
    expect((await post('nope', SAMPLE)).status).toBe(401);
    expect(await getUnmatchedMessages(env.DB)).toEqual([]);
  });
});

describe('POST /api/ingest/:token', () => {
  test('plain text body scores and acks', async () => {
    const token = await rotateApiToken(env.DB, 1);
    const res = await post(token, SAMPLE);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('👑 Queens — 0:11');
    const scores = await getPlayerScores(env.DB, 1, playDate(new Date()));
    expect(scores.map((s) => s.display)).toEqual(['0:11']);
    expect(sent).toEqual([{ chatId: 1, text: expect.stringContaining('via shortcut') }]);
  });

  test('json body works too', async () => {
    const token = await rotateApiToken(env.DB, 1);
    const res = await post(token, JSON.stringify({ text: SAMPLE }), 'application/json');
    expect(res.status).toBe(200);
    expect(await getPlayerScores(env.DB, 1, playDate(new Date()))).toHaveLength(1);
  });

  test('the same result twice is a no-op, not a second row', async () => {
    const token = await rotateApiToken(env.DB, 1);
    await post(token, SAMPLE);
    const res = await post(token, SAMPLE);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^Already logged/);
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages').all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });

  test('unparsed text is kept for calibration and says so', async () => {
    const token = await rotateApiToken(env.DB, 1);
    const res = await post(token, 'some brand new game 12/13');
    expect(res.status).toBe(422);
    expect((await getUnmatchedMessages(env.DB)).map((m) => m.text)).toEqual(['some brand new game 12/13']);
  });

  test('empty body is a 400', async () => {
    const token = await rotateApiToken(env.DB, 1);
    expect((await post(token, '   ')).status).toBe(400);
  });
});

describe('syntheticMessageId', () => {
  test('is negative, so it can never collide with a Telegram id', () => {
    expect(syntheticMessageId(SAMPLE, '2026-09-03')).toBeLessThan(0);
  });
  test('differs by text and by day', () => {
    const a = syntheticMessageId(SAMPLE, '2026-09-03');
    expect(syntheticMessageId(SAMPLE, '2026-09-04')).not.toBe(a);
    expect(syntheticMessageId('Queens #855 | 0:12 👑', '2026-09-03')).not.toBe(a);
  });
});
