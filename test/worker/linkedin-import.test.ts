import { applyD1Migrations, env } from 'cloudflare:test';
import type { Api } from 'grammy';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { importLinkedIn } from '../../src/cron/linkedin';
import { addMembership, upsertGroup } from '../../src/db/groups';
import { getLinks, getUnlinkedProfiles, link } from '../../src/db/linkedin';
import { ensurePlayer, toggleGame } from '../../src/db/players';
import { getScoresForDate } from '../../src/db/scores';
import type { Fetch } from '../../src/lib/voyager';

import hubFixture from '../fixtures/voyager/hub.json';
import leaderboardFixture from '../fixtures/voyager/leaderboard.json';

const HUB: unknown = hubFixture;
const LEADERBOARD = leaderboardFixture as { included: Array<{ firstName?: string; entityUrn?: string }> };
const CAPTAIN_URN = `urn:li:fsd_profile:${/fsd_game:\(([^,]+),/.exec(JSON.stringify(hubFixture))![1]}`;
const ALICE_URN = LEADERBOARD.included.find((i) => i.firstName === 'Alice')!.entityUrn!;

/** Answers the hub, then the same leaderboard for every game. Counts calls. */
function stubFetch(over: { status?: number } = {}) {
  const calls: string[] = [];
  const fetchImpl: Fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (over.status) return new Response('', { status: over.status });
    const body = url.includes('GameEntryPoints') ? HUB : LEADERBOARD;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

function stubApi() {
  const sent: Array<{ chatId: number | string; text: string }> = [];
  const api = {
    sendMessage: async (chatId: number | string, text: string) => {
      sent.push({ chatId, text });
      return {};
    },
  } as unknown as Api;
  return { sent, api };
}

const NOW = new Date('2026-09-07T10:00:00Z');
const DATE = '2026-09-07';
const CREDS = { ...env, LI_AT: 'li', LI_JSESSIONID: 'ajax:1' };

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM linkedin_links'),
    env.DB.prepare('DELETE FROM linkedin_profiles'),
    env.DB.prepare('DELETE FROM linkedin_meta'),
    env.DB.prepare('DELETE FROM memberships'),
    env.DB.prepare('DELETE FROM digests'),
    env.DB.prepare('DELETE FROM player_games'),
    env.DB.prepare('DELETE FROM scores'),
    env.DB.prepare('DELETE FROM messages'),
    env.DB.prepare('DELETE FROM players'),
    env.DB.prepare('DELETE FROM groups'),
  ]);
});

describe('importLinkedIn', () => {
  test('without credentials it does nothing at all', async () => {
    const { calls, fetchImpl } = stubFetch();
    const result = await importLinkedIn(env, stubApi().api, NOW, fetchImpl);
    expect(result.skipped).toBe('no-credentials');
    expect(calls).toHaveLength(0);
  });

  test('one hub call, one leaderboard page per game', async () => {
    const { calls, fetchImpl } = stubFetch();
    await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);
    expect(calls.filter((u) => u.includes('GameEntryPoints'))).toHaveLength(1);
    expect(calls.filter((u) => u.includes('GameConnectionsEntities'))).toHaveLength(8);
  });

  test('every profile seen is remembered; nobody linked means no scores', async () => {
    const { fetchImpl } = stubFetch();
    const result = await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);
    expect(result).toMatchObject({ imported: 0, autoLinked: 0 });
    expect(result.unmatched).toBeGreaterThan(0);
    expect(await getUnlinkedProfiles(env.DB)).toHaveLength(7);
    expect(await getScoresForDate(env.DB, DATE)).toEqual([]);
  });

  test('auto-links by first name, tells the player, and scores them', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    const { fetchImpl } = stubFetch();
    const { sent, api } = stubApi();

    const result = await importLinkedIn(CREDS, api, NOW, fetchImpl);

    expect(result.autoLinked).toBe(1);
    expect((await getLinks(env.DB)).get(ALICE_URN)).toBe(1);
    expect(sent.some((m) => m.chatId === 1 && /Linked you to LinkedIn as Alice Test/.test(m.text))).toBe(true);
    // The fixture is the same board for all 8 games: Alice at 0:11 everywhere.
    const scores = await getScoresForDate(env.DB, DATE);
    expect(scores.filter((s) => s.user_id === 1)).toHaveLength(7); // pinpoint has no timeElapsed → skipped
    expect(scores.find((s) => s.game === 'queens')).toMatchObject({ user_id: 1, value: 11, display: '0:11' });
  });

  test('a second tick rewrites the same rows, never duplicates', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    const { fetchImpl } = stubFetch();
    await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);
    const again = await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);
    expect(again.autoLinked).toBe(0);
    expect((await getScoresForDate(env.DB, DATE)).filter((s) => s.user_id === 1)).toHaveLength(7);
  });

  test('posts the digest once a group is complete', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    await upsertGroup(env.DB, -100, 'Friends');
    await addMembership(env.DB, -100, 1);
    // Alice only plays Queens, and the import brings Queens.
    for (const game of ['tango', 'zip', 'wend', 'crossclimb', 'minisudoku', 'patches', 'pinpoint', 'wordle', 'lemot', 'waffle', 'fermi', 'geozee', 'lts_abordable', 'lts_expert']) {
      await toggleGame(env.DB, 1, game);
    }
    const { fetchImpl } = stubFetch();
    const { sent, api } = stubApi();

    await importLinkedIn(CREDS, api, NOW, fetchImpl);

    expect(sent.some((m) => m.chatId === -100)).toBe(true);
  });

  test('a lapsed session tells the captain, once', async () => {
    await ensurePlayer(env.DB, { id: 7, first_name: 'Captain' });
    // A good run first, so the captain urn is known.
    await importLinkedIn(CREDS, stubApi().api, NOW, stubFetch().fetchImpl);
    await link(env.DB, { profileUrn: CAPTAIN_URN, userId: 7, source: 'admin' });

    const { sent, api } = stubApi();
    const bad = stubFetch({ status: 302 }).fetchImpl;
    const first = await importLinkedIn(CREDS, api, NOW, bad);
    const second = await importLinkedIn(CREDS, api, NOW, bad);

    expect(first.skipped).toBe('auth');
    expect(second.skipped).toBe('auth');
    expect(sent.filter((m) => m.chatId === 7 && /LinkedIn import stopped/.test(m.text))).toHaveLength(1);
  });
});
