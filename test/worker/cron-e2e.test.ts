import { applyD1Migrations, env } from 'cloudflare:test';
import type { Api } from 'grammy';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { postDigests } from '../../src/cron/digest';
import { sendReminders } from '../../src/cron/reminders';
import { addMembership, ensurePlayer, setReminderHour, upsertGroup } from '../../src/lib/db';

interface Sent {
  chatId: number | string;
  text: string;
  hasButton: boolean;
}

/** Records what would have gone to Telegram. */
function stubApi() {
  const sent: Sent[] = [];
  const api = {
    sendMessage: async (chatId: number | string, text: string, other?: { reply_markup?: unknown }) => {
      sent.push({ chatId, text, hasButton: other?.reply_markup !== undefined });
      return {};
    },
  } as unknown as Api;
  return { sent, api };
}

function failingApi(): Api {
  return {
    sendMessage: async () => {
      throw new Error('Bad Request: chat not found');
    },
  } as unknown as Api;
}

// Paris is UTC+2 in September.
const AT = (utc: string) => new Date(utc);
const MIDDAY = AT('2026-09-05T10:00:00Z'); // 12:00 Paris
const EVENING = AT('2026-09-05T19:30:00Z'); // 21:30 Paris, past the 21:00 cutoff
const PLAY_DATE = '2026-09-05';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memberships'),
    env.DB.prepare('DELETE FROM reminders'),
    env.DB.prepare('DELETE FROM digests'),
    env.DB.prepare('DELETE FROM player_games'),
    env.DB.prepare('DELETE FROM scores'),
    env.DB.prepare('DELETE FROM messages'),
    env.DB.prepare('DELETE FROM players'),
    env.DB.prepare('DELETE FROM groups'),
  ]);
});

async function seedGroup() {
  await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
  await ensurePlayer(env.DB, { id: 2, first_name: 'Bob' });
  await upsertGroup(env.DB, -100, 'Puzzle Crew');
  await addMembership(env.DB, -100, 1);
  await addMembership(env.DB, -100, 2);
}

async function addScore(userId: number, game: string, value: number, display: string) {
  await env.DB.prepare(
    `INSERT INTO scores (user_id, game, play_date, value, display, raw, created_at)
     VALUES (?, ?, ?, ?, ?, 'raw', 0)`,
  )
    .bind(userId, game, PLAY_DATE, value, display)
    .run();
}

describe('sendReminders', () => {
  beforeEach(async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    await setReminderHour(env.DB, 1, 12);
  });

  test('DMs the player whose hour has arrived, with their game links', async () => {
    const { sent, api } = stubApi();
    expect(await sendReminders(env, api, MIDDAY)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(1);
    expect(sent[0]?.text).toContain('Alice');
    expect(sent[0]?.text).toContain('lnkd.in/queens');
    expect(sent[0]?.text).toContain('fermi.gg');
  });

  test('never links a hidden game', async () => {
    const { sent, api } = stubApi();
    await sendReminders(env, api, MIDDAY);
    expect(sent[0]?.text).not.toContain('Wordle');
  });

  test('the cron firing four times an hour sends one DM', async () => {
    const { sent, api } = stubApi();
    await sendReminders(env, api, MIDDAY);
    await sendReminders(env, api, AT('2026-09-05T10:15:00Z'));
    await sendReminders(env, api, AT('2026-09-05T10:30:00Z'));
    await sendReminders(env, api, AT('2026-09-05T10:45:00Z'));
    expect(sent).toHaveLength(1);
  });

  test('a different hour sends nothing', async () => {
    const { sent, api } = stubApi();
    expect(await sendReminders(env, api, AT('2026-09-05T06:00:00Z'))).toBe(0);
    expect(sent).toHaveLength(0);
  });

  test('a failed send is retried on the next tick, not lost for the day', async () => {
    expect(await sendReminders(env, failingApi(), MIDDAY)).toBe(0);
    const { sent, api } = stubApi();
    expect(await sendReminders(env, api, AT('2026-09-05T10:15:00Z'))).toBe(1);
    expect(sent).toHaveLength(1);
  });

  test('tells a player with no games selected, rather than sending an empty list', async () => {
    await env.DB.prepare('DELETE FROM player_games WHERE user_id = 1').run();
    const { sent, api } = stubApi();
    await sendReminders(env, api, MIDDAY);
    expect(sent[0]?.text).toContain('/games');
  });
});

describe('postDigests', () => {
  beforeEach(seedGroup);

  test('waits before the cutoff while someone has not played', async () => {
    await addScore(1, 'queens', 11, '0:11');
    const { sent, api } = stubApi();
    expect(await postDigests(env, api, MIDDAY)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  test('fires early once every active member has submitted', async () => {
    await addScore(1, 'queens', 11, '0:11');
    await addScore(2, 'queens', 42, '0:42');
    const { sent, api } = stubApi();
    expect(await postDigests(env, api, MIDDAY)).toBe(1);
    expect(sent[0]?.chatId).toBe(-100);
    expect(sent[0]?.text).toContain('Puzzle Crew');
    expect(sent[0]?.text).toContain('Alice — 0:11');
    expect(sent[0]?.text).toContain('Bob — 0:42');
  });

  test('fires at the cutoff even with people missing, and lists them absent', async () => {
    await addScore(1, 'queens', 11, '0:11');
    const { sent, api } = stubApi();
    expect(await postDigests(env, api, EVENING)).toBe(1);
    expect(sent[0]?.text).toContain('absent: Bob');
  });

  test('completion and cutoff both firing still posts once', async () => {
    await addScore(1, 'queens', 11, '0:11');
    await addScore(2, 'queens', 42, '0:42');
    const { sent, api } = stubApi();
    await postDigests(env, api, MIDDAY); // completion
    await postDigests(env, api, EVENING); // cutoff
    expect(sent).toHaveLength(1);
  });

  test('a redelivered cron does not repost', async () => {
    await addScore(1, 'queens', 11, '0:11');
    const { sent, api } = stubApi();
    await postDigests(env, api, EVENING);
    await postDigests(env, api, EVENING);
    await postDigests(env, api, EVENING);
    expect(sent).toHaveLength(1);
  });

  test('a failed post is retried on the next tick', async () => {
    await addScore(1, 'queens', 11, '0:11');
    expect(await postDigests(env, failingApi(), EVENING)).toBe(0);
    const { sent, api } = stubApi();
    expect(await postDigests(env, api, AT('2026-09-05T19:45:00Z'))).toBe(1);
    expect(sent).toHaveLength(1);
  });

  test('says nobody played rather than staying silent', async () => {
    const { sent, api } = stubApi();
    expect(await postDigests(env, api, EVENING)).toBe(1);
    expect(sent[0]?.text).toContain('Nobody played today');
  });

  test('a group with no members never burns its digest slot', async () => {
    await env.DB.prepare('DELETE FROM memberships').run();
    const { sent, api } = stubApi();
    expect(await postDigests(env, api, MIDDAY)).toBe(0);
    expect(sent).toHaveLength(0);
    // ...and the slot is still free at the cutoff.
    expect(await postDigests(env, api, EVENING)).toBe(1);
  });

  test('a removed group gets nothing', async () => {
    await env.DB.prepare('UPDATE groups SET active = 0 WHERE chat_id = -100').run();
    const { sent, api } = stubApi();
    expect(await postDigests(env, api, EVENING)).toBe(0);
  });

  test('two groups each get their own digest', async () => {
    await upsertGroup(env.DB, -200, 'Other Crew');
    await addMembership(env.DB, -200, 1);
    await addScore(1, 'queens', 11, '0:11');
    const { sent, api } = stubApi();
    expect(await postDigests(env, api, EVENING)).toBe(2);
    expect(new Set(sent.map((s) => s.chatId))).toEqual(new Set([-100, -200]));
  });

  test('one score feeds both of a player\'s groups', async () => {
    await upsertGroup(env.DB, -200, 'Other Crew');
    await addMembership(env.DB, -200, 1);
    await addScore(1, 'queens', 11, '0:11');
    const { sent, api } = stubApi();
    await postDigests(env, api, EVENING);
    expect(sent.every((s) => s.text.includes('Alice — 0:11'))).toBe(true);
  });

  test('no leaderboard button while the Mini App is unregistered', async () => {
    await addScore(1, 'queens', 11, '0:11');
    const { sent, api } = stubApi();
    // Explicit, not ambient: the configured value changes once /newapp is done.
    const unregistered = { ...env, MINIAPP_SHORT_NAME: '' } as unknown as typeof env;
    await postDigests(unregistered, api, EVENING);
    expect(sent[0]?.hasButton).toBe(false);
  });

  test('the button appears once a short name is configured', async () => {
    await addScore(1, 'queens', 11, '0:11');
    const { sent, api } = stubApi();
    // The generated binding type pins the configured literal, hence the cast.
    const configured = { ...env, MINIAPP_SHORT_NAME: 'board' } as unknown as typeof env;
    await postDigests(configured, api, EVENING);
    expect(sent[0]?.hasButton).toBe(true);
  });
});
