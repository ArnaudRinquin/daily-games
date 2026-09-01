import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { addMembership, ensurePlayer, upsertGroup } from '../../src/lib/db';

const TOKEN = '123456789:TESTTESTTESTTESTTESTTESTTESTTESTTES';

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
}

async function signInitData(user: object, authDate = Math.floor(Date.now() / 1000)) {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    user: JSON.stringify(user),
  };
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), TOKEN);
  const hash = [...new Uint8Array(await hmac(secret, checkString))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const get = (path: string, initData?: string) =>
  SELF.fetch(`https://example.com${path}`, {
    headers: initData ? { Authorization: `tma ${initData}` } : {},
  });

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memberships'),
    env.DB.prepare('DELETE FROM player_games'),
    env.DB.prepare('DELETE FROM scores'),
    env.DB.prepare('DELETE FROM players'),
    env.DB.prepare('DELETE FROM groups'),
  ]);
  await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
  await ensurePlayer(env.DB, { id: 2, first_name: 'Bob' });
  await upsertGroup(env.DB, -100, 'Puzzle Crew');
  await addMembership(env.DB, -100, 1);
});

describe('api auth', () => {
  test('rejects a request with no initData', async () => {
    expect((await get('/api/me')).status).toBe(401);
  });

  test('rejects a forged hash', async () => {
    const initData = (await signInitData({ id: 1, first_name: 'Alice' })).replace(
      /hash=[0-9a-f]+/,
      'hash=' + '0'.repeat(64),
    );
    expect((await get('/api/me', initData)).status).toBe(401);
  });

  test('rejects initData older than 24 hours', async () => {
    const stale = Math.floor(Date.now() / 1000) - 25 * 3600;
    const initData = await signInitData({ id: 1, first_name: 'Alice' }, stale);
    expect((await get('/api/me', initData)).status).toBe(401);
  });

  test('accepts a correctly signed viewer', async () => {
    const initData = await signInitData({ id: 1, first_name: 'Alice' });
    const res = await get('/api/me', initData);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { viewer: { id: number }; groups: unknown[] };
    expect(body.viewer.id).toBe(1);
    expect(body.groups).toEqual([{ chatId: -100, title: 'Puzzle Crew' }]);
  });
});

describe('leaderboard access', () => {
  test('a non-member cannot read the board', async () => {
    const initData = await signInitData({ id: 2, first_name: 'Bob' });
    expect((await get('/api/leaderboard?group=-100&range=today', initData)).status).toBe(403);
  });

  test('a member can', async () => {
    const initData = await signInitData({ id: 1, first_name: 'Alice' });
    const res = await get('/api/leaderboard?group=-100&range=today', initData);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { group: { title: string }; viewerId: number };
    expect(body.group.title).toBe('Puzzle Crew');
    expect(body.viewerId).toBe(1);
  });

  test('rejects a bad range and a bad group', async () => {
    const initData = await signInitData({ id: 1, first_name: 'Alice' });
    expect((await get('/api/leaderboard?group=-100&range=decade', initData)).status).toBe(400);
    expect((await get('/api/leaderboard?group=nope&range=today', initData)).status).toBe(400);
  });

  test('returns boards and standings for a real day', async () => {
    await env.DB.prepare(
      `INSERT INTO scores (user_id, game, play_date, value, display, raw, created_at)
       SELECT 1, 'zip', play_date, 5, '0:05', 'Zip #1 | 0:05', 0
       FROM (SELECT ? AS play_date)`,
    )
      .bind(new Date().toISOString().slice(0, 10))
      .run();

    const initData = await signInitData({ id: 1, first_name: 'Alice' });
    const res = await get('/api/leaderboard?group=-100&range=week', initData);
    const body = (await res.json()) as {
      boards: { game: string; rows: { name: string; points: number }[] }[];
      standings: { name: string; totalPoints: number }[];
    };
    expect(body.boards.some((b) => b.game === 'zip')).toBe(true);
    expect(body.standings.find((s) => s.name === 'Alice')?.totalPoints).toBeGreaterThan(0);
  });
});
