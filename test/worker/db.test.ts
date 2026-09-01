import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { visibleGameIds } from '../../src/games/registry';
import {
  addMembership,
  ensurePlayer,
  getMemberGroups,
  getPlayer,
  getSelectedGames,
  setReminderHour,
  toggleGame,
  upsertGroup,
  deactivateGroup,
} from '../../src/lib/db';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memberships'),
    env.DB.prepare('DELETE FROM player_games'),
    env.DB.prepare('DELETE FROM scores'),
    env.DB.prepare('DELETE FROM reminders'),
    env.DB.prepare('DELETE FROM digests'),
    env.DB.prepare('DELETE FROM players'),
    env.DB.prepare('DELETE FROM groups'),
  ]);
});

const alice = { id: 1, username: 'alice', first_name: 'Alice' };

describe('ensurePlayer', () => {
  test('one tap is enough: all visible games, 09:00 reminder', async () => {
    const { created, player } = await ensurePlayer(env.DB, alice);
    expect(created).toBe(true);
    expect(player.reminder_hour).toBe(9);
    expect((await getSelectedGames(env.DB, 1)).sort()).toEqual([...visibleGameIds()].sort());
  });

  test('never contains the hidden game', async () => {
    await ensurePlayer(env.DB, alice);
    expect(await getSelectedGames(env.DB, 1)).not.toContain('fermi');
  });

  test('re-running /start refreshes the name but keeps settings', async () => {
    await ensurePlayer(env.DB, alice);
    await setReminderHour(env.DB, 1, 20);
    await toggleGame(env.DB, 1, 'wordle'); // deselect

    const { created } = await ensurePlayer(env.DB, { ...alice, first_name: 'Alicia' });
    expect(created).toBe(false);

    const player = await getPlayer(env.DB, 1);
    expect(player?.first_name).toBe('Alicia');
    expect(player?.reminder_hour).toBe(20);
    expect(await getSelectedGames(env.DB, 1)).not.toContain('wordle');
  });

  test('/start after /pause reactivates the player', async () => {
    await ensurePlayer(env.DB, alice);
    await env.DB.prepare('UPDATE players SET active = 0 WHERE user_id = 1').run();
    const { player } = await ensurePlayer(env.DB, alice);
    expect(player.active).toBe(1);
  });
});

describe('reminder hour', () => {
  test('clamps below the day rollover', async () => {
    await ensurePlayer(env.DB, alice);
    expect(await setReminderHour(env.DB, 1, 2)).toBe(6);
    expect((await getPlayer(env.DB, 1))?.reminder_hour).toBe(6);
  });

  test('clamps above the window', async () => {
    await ensurePlayer(env.DB, alice);
    expect(await setReminderHour(env.DB, 1, 23)).toBe(22);
  });
});

describe('toggleGame', () => {
  test('round-trips', async () => {
    await ensurePlayer(env.DB, alice);
    expect(await toggleGame(env.DB, 1, 'queens')).toBe(false);
    expect(await getSelectedGames(env.DB, 1)).not.toContain('queens');
    expect(await toggleGame(env.DB, 1, 'queens')).toBe(true);
    expect(await getSelectedGames(env.DB, 1)).toContain('queens');
  });

  test('a selected-then-hidden game is filtered out of the reminder set', async () => {
    await ensurePlayer(env.DB, alice);
    // Simulate a game that was selectable before its parser was retired.
    await env.DB.prepare("INSERT INTO player_games (user_id, game) VALUES (1, 'fermi')").run();
    expect(await getSelectedGames(env.DB, 1)).not.toContain('fermi');
  });
});

describe('groups and membership', () => {
  test('membership insert is idempotent', async () => {
    await ensurePlayer(env.DB, alice);
    await upsertGroup(env.DB, -100123, 'Puzzle Crew');
    expect(await addMembership(env.DB, -100123, 1)).toBe(true);
    expect(await addMembership(env.DB, -100123, 1)).toBe(false);
  });

  test('re-adding the bot reactivates the group and refreshes the title', async () => {
    await upsertGroup(env.DB, -100123, 'Puzzle Crew');
    await deactivateGroup(env.DB, -100123);
    await upsertGroup(env.DB, -100123, 'Puzzle Crew 2');

    await ensurePlayer(env.DB, alice);
    await addMembership(env.DB, -100123, 1);
    const groups = await getMemberGroups(env.DB, 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('Puzzle Crew 2');
  });

  test('a removed group disappears from the player view', async () => {
    await ensurePlayer(env.DB, alice);
    await upsertGroup(env.DB, -100123, 'Puzzle Crew');
    await addMembership(env.DB, -100123, 1);
    await deactivateGroup(env.DB, -100123);
    expect(await getMemberGroups(env.DB, 1)).toEqual([]);
  });
});
