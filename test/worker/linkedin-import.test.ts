import { applyD1Migrations, env } from 'cloudflare:test';
import type { Api } from 'grammy';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { importLinkedIn } from '../../src/cron/linkedin';
import { addMembership, upsertGroup } from '../../src/db/groups';
import { addPending, getLinks, getPendingForUser, getUnlinkedProfiles, link } from '../../src/db/linkedin';
import { ensurePlayer, toggleGame } from '../../src/db/players';
import { getScoresForDate } from '../../src/db/scores';
import { linkedinNudge } from '../../src/lib/ingest';
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
    env.DB.prepare('DELETE FROM linkedin_pending'),
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

  test('every profile seen is remembered; nobody linked means no scores, no guessing by name', async () => {
    // A player with the same first name as a leaderboard row: still not linked.
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    const { fetchImpl } = stubFetch();
    const { sent, api } = stubApi();
    const result = await importLinkedIn(CREDS, api, NOW, fetchImpl);
    expect(result.imported).toBe(0);
    expect(result.unmatched).toBeGreaterThan(0);
    expect(await getUnlinkedProfiles(env.DB)).toHaveLength(7);
    expect(await getScoresForDate(env.DB, DATE)).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('a linked player gets every game they finished', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    const { fetchImpl } = stubFetch();
    await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl); // profiles now known
    expect(await link(env.DB, { profileUrn: ALICE_URN, userId: 1, source: 'self' })).toBe('linked');

    await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);

    // The fixture is the same board for all 8 games: Alice at 0:11 everywhere,
    // except Pinpoint, whose guess count the fixture lacks.
    const scores = await getScoresForDate(env.DB, DATE);
    expect(scores.filter((s) => s.user_id === 1)).toHaveLength(7);
    expect(scores.find((s) => s.game === 'queens')).toMatchObject({ user_id: 1, value: 11, display: '0:11' });
  });

  test('a tick before 09:00 Paris files the board under the previous puzzle day', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    const { fetchImpl } = stubFetch();
    await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);
    await link(env.DB, { profileUrn: ALICE_URN, userId: 1, source: 'self' });

    // 04:10Z = 06:10 Paris on the 8th, but LinkedIn is still on the 7th's puzzle.
    await importLinkedIn(CREDS, stubApi().api, new Date('2026-09-08T04:10:00Z'), fetchImpl);
    expect((await getScoresForDate(env.DB, '2026-09-08')).filter((s) => s.user_id === 1)).toHaveLength(0);
    expect((await getScoresForDate(env.DB, DATE)).filter((s) => s.user_id === 1)).toHaveLength(7);
  });

  test('a second tick rewrites the same rows, never duplicates', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    const { fetchImpl } = stubFetch();
    await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);
    await link(env.DB, { profileUrn: ALICE_URN, userId: 1, source: 'self' });
    await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);
    await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);
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
    await importLinkedIn(CREDS, stubApi().api, NOW, fetchImpl);
    await link(env.DB, { profileUrn: ALICE_URN, userId: 1, source: 'self' });
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

describe('pending links', () => {
  test('a slug given before the profile is seen links itself on the next import, and says so', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Whoever' });
    await addPending(env.DB, { publicIdentifier: 'Alice-Test', userId: 1, source: 'admin' }); // case-insensitive
    const { sent, api } = stubApi();

    await importLinkedIn(CREDS, api, NOW, stubFetch().fetchImpl);

    expect((await getLinks(env.DB)).get(ALICE_URN)).toBe(1);
    expect(await getPendingForUser(env.DB, 1)).toBeNull();
    expect(sent.some((m) => m.chatId === 1 && /Linked to Alice Test/.test(m.text))).toBe(true);
    // Scores land on the same tick the link resolves.
    expect((await getScoresForDate(env.DB, DATE)).filter((s) => s.user_id === 1)).toHaveLength(7);
  });

  test('a slug that never appears stays pending, harmlessly', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Whoever' });
    await addPending(env.DB, { publicIdentifier: 'nobody-here', userId: 1, source: 'self' });
    await importLinkedIn(CREDS, stubApi().api, NOW, stubFetch().fetchImpl);
    expect(await getPendingForUser(env.DB, 1)).toMatchObject({ public_identifier: 'nobody-here' });
    expect(await getLinks(env.DB)).toEqual(new Map());
  });
});

describe('linkedinNudge', () => {
  const queens = [{ game: 'queens' }];

  test('nudges an unlinked player who pasted a LinkedIn game', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    expect(await linkedinNudge(CREDS, 1, queens)).toMatch(/\/linkedin https:\/\/www\.linkedin\.com\/in\//);
  });

  test('silent once linked, for non-LinkedIn games, and when the import is off', async () => {
    await ensurePlayer(env.DB, { id: 1, first_name: 'Alice' });
    expect(await linkedinNudge(CREDS, 1, [{ game: 'wordle' }])).toBe('');
    expect(await linkedinNudge({ DB: env.DB }, 1, queens)).toBe('');
    await importLinkedIn(CREDS, stubApi().api, NOW, stubFetch().fetchImpl);
    await link(env.DB, { profileUrn: ALICE_URN, userId: 1, source: 'self' });
    expect(await linkedinNudge(CREDS, 1, queens)).toBe('');
  });
});
