import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  addMembership,
  claimDigest,
  claimReminder,
  ensurePlayer,
  getActiveGroups,
  getAllGroupMembers,
  getPlayersDue,
  releaseDigest,
  releaseReminder,
  setPlayerActive,
  setReminderHour,
  toggleGame,
  upsertGroup,
} from '../../src/lib/db';

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

const DATE = '2026-09-05';

describe('reminder idempotency', () => {
  beforeEach(async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
  });

  test('the cron firing four times an hour sends one reminder', async () => {
    expect(await claimReminder(env.DB, 1, DATE)).toBe(true);
    expect(await claimReminder(env.DB, 1, DATE)).toBe(false);
    expect(await claimReminder(env.DB, 1, DATE)).toBe(false);
    expect(await claimReminder(env.DB, 1, DATE)).toBe(false);
  });

  test('a failed send releases the claim so the next tick retries', async () => {
    expect(await claimReminder(env.DB, 1, DATE)).toBe(true);
    await releaseReminder(env.DB, 1, DATE);
    expect(await claimReminder(env.DB, 1, DATE)).toBe(true);
  });

  test('tomorrow is a separate claim', async () => {
    expect(await claimReminder(env.DB, 1, DATE)).toBe(true);
    expect(await claimReminder(env.DB, 1, '2026-09-06')).toBe(true);
  });
});

describe('getPlayersDue', () => {
  beforeEach(async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    await ensurePlayer(env.DB, { id: 2, first_name: 'Bob' });
    await setReminderHour(env.DB, 1, 9);
    await setReminderHour(env.DB, 2, 20);
  });

  test('only players whose hour has arrived', async () => {
    const due = await getPlayersDue(env.DB, 9, DATE);
    expect(due.map((d) => d.player.first_name)).toEqual(['Alice']);
  });

  test('a claimed reminder drops the player from the queue', async () => {
    await claimReminder(env.DB, 1, DATE);
    expect(await getPlayersDue(env.DB, 9, DATE)).toEqual([]);
  });

  test('paused players are skipped', async () => {
    await setPlayerActive(env.DB, 1, false);
    expect(await getPlayersDue(env.DB, 9, DATE)).toEqual([]);
  });

  test('carries the selected games, with unofferable ones filtered out', async () => {
    await env.DB.prepare("INSERT INTO player_games (user_id, game) VALUES (1, 'retired_game')").run();
    const due = await getPlayersDue(env.DB, 9, DATE);
    expect(due[0]?.games).toContain('queens');
    expect(due[0]?.games).not.toContain('retired_game');
  });

  test('a player with no games selected still appears, so they can be told', async () => {
    await env.DB.prepare('DELETE FROM player_games WHERE user_id = 1').run();
    const due = await getPlayersDue(env.DB, 9, DATE);
    expect(due).toHaveLength(1);
    expect(due[0]?.games).toEqual([]);
  });
});

describe('digest idempotency', () => {
  beforeEach(async () => {
    await upsertGroup(env.DB, -100, 'Puzzle Crew');
  });

  test('completion and cutoff racing for the same day post once', async () => {
    expect(await claimDigest(env.DB, -100, DATE)).toBe(true);
    expect(await claimDigest(env.DB, -100, DATE)).toBe(false);
  });

  test('a failed post releases the claim', async () => {
    await claimDigest(env.DB, -100, DATE);
    await releaseDigest(env.DB, -100, DATE);
    expect(await claimDigest(env.DB, -100, DATE)).toBe(true);
  });

  test('each group claims independently', async () => {
    await upsertGroup(env.DB, -200, 'Other Crew');
    expect(await claimDigest(env.DB, -100, DATE)).toBe(true);
    expect(await claimDigest(env.DB, -200, DATE)).toBe(true);
  });
});

describe('getAllGroupMembers', () => {
  beforeEach(async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    await ensurePlayer(env.DB, { id: 2, first_name: 'Bob' });
    await upsertGroup(env.DB, -100, 'Puzzle Crew');
    await addMembership(env.DB, -100, 1);
    await addMembership(env.DB, -100, 2);
  });

  test('returns members and their selections in one pass', async () => {
    const byChat = await getAllGroupMembers(env.DB);
    const members = byChat.get(-100) ?? [];
    expect(members.map((m) => m.name)).toEqual(['Alice', 'Bob']);
    expect(members[0]?.games).toContain('queens');
  });

  test('reflects a deselected game', async () => {
    await toggleGame(env.DB, 1, 'queens');
    const members = (await getAllGroupMembers(env.DB)).get(-100) ?? [];
    expect(members.find((m) => m.name === 'Alice')?.games).not.toContain('queens');
  });

  test('a paused player is still a member, flagged inactive', async () => {
    await setPlayerActive(env.DB, 2, false);
    const members = (await getAllGroupMembers(env.DB)).get(-100) ?? [];
    expect(members.find((m) => m.name === 'Bob')?.active).toBe(false);
  });

  test('a removed group drops out entirely', async () => {
    await env.DB.prepare('UPDATE groups SET active = 0 WHERE chat_id = -100').run();
    expect(await getActiveGroups(env.DB)).toEqual([]);
    expect((await getAllGroupMembers(env.DB)).get(-100)).toBeUndefined();
  });

  test('a player in two groups appears in both', async () => {
    await upsertGroup(env.DB, -200, 'Other Crew');
    await addMembership(env.DB, -200, 1);
    const byChat = await getAllGroupMembers(env.DB);
    expect(byChat.get(-100)?.some((m) => m.userId === 1)).toBe(true);
    expect(byChat.get(-200)?.some((m) => m.userId === 1)).toBe(true);
  });
});
