import { applyD1Migrations, env } from 'cloudflare:test';
import type { Update } from 'grammy/types';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createBot } from '../../src/bot';
import { getSelectedGames, getPlayer } from '../../src/db/players';
import { getMemberGroups, upsertGroup } from '../../src/db/groups';
import { getPlayerScores } from '../../src/db/scores';
import { encodeGroupPayload } from '../../src/lib/deeplink';

/**
 * Drives the real grammY handlers with real Update objects, intercepting
 * outgoing API calls. Everything below this line was previously only exercised
 * through the data layer, so command routing and the group/DM split were
 * untested.
 */
function testBot() {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const bot = createBot({ ...env, BOT_USERNAME: 'daily_games_bot' } as unknown as typeof env);

  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'getChatMember') {
      return { ok: true, result: { status: 'member', user: { id: 555 } } } as never;
    }
    if (method === 'getChat') {
      return { ok: true, result: { id: -100, type: 'group', title: 'Puzzle Crew' } } as never;
    }
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } } as never;
  });

  return { bot, calls, sent: () => calls.filter((c) => c.method === 'sendMessage') };
}

const USER = { id: 555, is_bot: false, first_name: 'Arnaud' };
const AT = Math.floor(Date.parse('2026-09-05T10:00:00Z') / 1000); // 12:00 Paris

let seq = 0;
function dm(text: string, entities?: { offset: number; length: number; type: string }[]): Update {
  seq++;
  return {
    update_id: seq,
    message: {
      message_id: seq,
      date: AT,
      chat: { id: USER.id, type: 'private', first_name: 'Arnaud' },
      from: USER,
      text,
      ...(entities ? { entities } : {}),
    },
  } as unknown as Update;
}

function command(text: string): Update {
  const name = text.split(' ')[0]!;
  return dm(text, [{ offset: 0, length: name.length, type: 'bot_command' }]);
}

function groupMessage(text: string, chatId = -100): Update {
  seq++;
  return {
    update_id: seq,
    message: {
      message_id: seq,
      date: AT,
      chat: { id: chatId, type: 'group', title: 'Puzzle Crew' },
      from: USER,
      text,
    },
  } as unknown as Update;
}

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

describe('/start', () => {
  test('creates the player and welcomes them', async () => {
    const { bot, sent } = testBot();
    await bot.handleUpdate(command('/start'));

    expect((await getPlayer(env.DB, 555))?.first_name).toBe('Arnaud');
    expect((await getSelectedGames(env.DB, 555)).length).toBeGreaterThan(0);
    expect(String(sent()[0]?.payload.text)).toContain('Arnaud');
  });

  test('a group deep link joins that group in the same tap', async () => {
    await upsertGroup(env.DB, -100, 'Puzzle Crew');
    const { bot, sent } = testBot();
    await bot.handleUpdate(command(`/start ${encodeGroupPayload(-100)}`));

    const groups = await getMemberGroups(env.DB, 555);
    expect(groups.map((g) => g.chat_id)).toEqual([-100]);
    expect(String(sent()[0]?.payload.text)).toContain('leaderboard');
  });

  test('a second /start does not reset their settings', async () => {
    const { bot } = testBot();
    await bot.handleUpdate(command('/start'));
    await env.DB.prepare('UPDATE players SET reminder_hour = 20 WHERE user_id = 555').run();
    await bot.handleUpdate(command('/start'));
    expect((await getPlayer(env.DB, 555))?.reminder_hour).toBe(20);
  });
});

describe('DM ingestion', () => {
  test('stores a pasted result and acknowledges without a rank', async () => {
    const { bot, sent } = testBot();
    await bot.handleUpdate(command('/start'));
    await bot.handleUpdate(dm('Zip #533\n0:05 🏁'));

    const scores = await getPlayerScores(env.DB, 555, '2026-09-05');
    expect(scores.map((s) => s.game)).toEqual(['zip']);

    const ack = String(sent().at(-1)?.payload.text);
    expect(ack).toContain('0:05');
    expect(ack).not.toMatch(/rank|1st|winning/i);
  });

  test('says so when it cannot read the message, and keeps it', async () => {
    const { bot, sent } = testBot();
    await bot.handleUpdate(command('/start'));
    await bot.handleUpdate(dm('some brand new game 4/9'));

    expect(String(sent().at(-1)?.payload.text)).toContain("didn't recognise");
    const row = await env.DB.prepare(
      "SELECT count(*) AS n FROM messages WHERE matched_games IS NULL",
    ).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  test('a command is never ingested as a score', async () => {
    const { bot } = testBot();
    await bot.handleUpdate(command('/start'));
    await bot.handleUpdate(command('/status'));
    const row = await env.DB.prepare('SELECT count(*) AS n FROM messages').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('group ingestion', () => {
  test('scores a result pasted in the group, and acks in the DM', async () => {
    const { bot, sent } = testBot();
    await bot.handleUpdate(groupMessage('Queens #854\n0:11 👑'));

    expect((await getPlayerScores(env.DB, 555, '2026-09-05')).map((s) => s.game)).toEqual([
      'queens',
    ]);
    // The acknowledgement goes to the person, not the group.
    expect(sent()[0]?.payload.chat_id).toBe(555);
    expect(sent().some((c) => c.payload.chat_id === -100)).toBe(false);
  });

  test('a poster who never started the bot is created inactive but ranked', async () => {
    const { bot } = testBot();
    await bot.handleUpdate(groupMessage('Queens #854\n0:11 👑'));

    const player = await getPlayer(env.DB, 555);
    expect(player?.active).toBe(0);
    expect((await getMemberGroups(env.DB, 555)).map((g) => g.chat_id)).toEqual([-100]);
  });

  test('ordinary group chatter is ignored entirely', async () => {
    const { bot, sent } = testBot();
    await bot.handleUpdate(groupMessage('anyone played today?'));

    const row = await env.DB.prepare('SELECT count(*) AS n FROM messages').first<{ n: number }>();
    expect(row?.n).toBe(0);
    expect(await getPlayer(env.DB, 555)).toBeNull();
    expect(sent()).toHaveLength(0);
  });

  test('a malformed result in the group still reaches the corpus', async () => {
    const { bot } = testBot();
    await bot.handleUpdate(groupMessage('Queens #854 — gave up today'));
    const row = await env.DB.prepare(
      'SELECT count(*) AS n FROM messages WHERE matched_games IS NULL',
    ).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});

describe('/join fallback', () => {
  test('registers membership for someone who already started the bot', async () => {
    const { bot } = testBot();
    await bot.handleUpdate(command('/start'));
    seq++;
    await bot.handleUpdate({
      update_id: seq,
      message: {
        message_id: seq,
        date: AT,
        chat: { id: -100, type: 'group', title: 'Puzzle Crew' },
        from: USER,
        text: '/join',
        entities: [{ offset: 0, length: 5, type: 'bot_command' }],
      },
    } as unknown as Update);

    expect((await getMemberGroups(env.DB, 555)).map((g) => g.chat_id)).toEqual([-100]);
  });
});

describe('the digest posts the moment the group completes', () => {
  const OTHER = { id: 556, is_bot: false, first_name: 'Jimmy' };

  function dmFrom(user: typeof OTHER, text: string): Update {
    seq++;
    return {
      update_id: seq,
      message: {
        message_id: seq,
        date: AT,
        chat: { id: user.id, type: 'private', first_name: user.first_name },
        from: user,
        text,
      },
    } as unknown as Update;
  }

  beforeEach(async () => {
    await upsertGroup(env.DB, -100, 'Puzzle Crew');
  });

  /** Completion means every selected game, so a test that plays Zip selects Zip. */
  async function selectOnly(userId: number, games: readonly string[]) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM player_games WHERE user_id = ?').bind(userId),
      ...games.map((g) =>
        env.DB.prepare('INSERT INTO player_games (user_id, game) VALUES (?, ?)').bind(userId, g),
      ),
    ]);
  }

  test('the last submission triggers it, with no cron involved', async () => {
    const { bot, sent } = testBot();
    await bot.handleUpdate(command(`/start ${encodeGroupPayload(-100)}`));
    await bot.handleUpdate({
      ...(command(`/start ${encodeGroupPayload(-100)}`) as { update_id: number }),
      update_id: ++seq,
      message: {
        message_id: ++seq,
        date: AT,
        chat: { id: OTHER.id, type: 'private', first_name: 'Jimmy' },
        from: OTHER,
        text: `/start ${encodeGroupPayload(-100)}`,
        entities: [{ offset: 0, length: 6, type: 'bot_command' }],
      },
    } as unknown as Update);

    await selectOnly(USER.id, ['zip']);
    await selectOnly(OTHER.id, ['zip']);

    // Arnaud plays: group not complete yet, nothing posted to the chat.
    await bot.handleUpdate(dm('Zip #533\n0:05 🏁'));
    expect(sent().some((c) => c.payload.chat_id === -100)).toBe(false);

    // Jimmy plays: that completes the group.
    await bot.handleUpdate(dmFrom(OTHER, 'Zip #533\n0:12 🏁'));
    const toGroup = sent().filter((c) => c.payload.chat_id === -100);
    expect(toGroup).toHaveLength(1);
    expect(String(toGroup[0]?.payload.text)).toContain('Zip');
  });

  test('it posts once, not again on the next submission', async () => {
    const { bot, sent } = testBot();
    await bot.handleUpdate(command(`/start ${encodeGroupPayload(-100)}`));
    await selectOnly(USER.id, ['zip']);
    await bot.handleUpdate(dm('Zip #533\n0:05 🏁'));
    await bot.handleUpdate(dm('Queens #854\n0:11 👑'));
    expect(sent().filter((c) => c.payload.chat_id === -100)).toHaveLength(1);
  });
});
