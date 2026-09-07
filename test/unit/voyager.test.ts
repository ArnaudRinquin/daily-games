import { describe, expect, test } from 'vitest';
import { publicIdentifierOf } from '../../src/bot/linkedin';
import {
  GAME_TYPES,
  leaderboardUrl,
  parseHub,
  parseLeaderboard,
  scoreOf,
  type LeaderboardRow,
} from '../../src/lib/voyager';

import hubFixture from '../fixtures/voyager/hub.json';
import leaderboardFixture from '../fixtures/voyager/leaderboard.json';

describe('parseHub', () => {
  test('one entry per game, with the captain member id and puzzle', () => {
    const games = parseHub(hubFixture);
    expect(games.map((g) => g.gameTypeId).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(games.map((g) => g.memberId)).size).toBe(1);
    expect(games.find((g) => g.gameTypeId === 3)).toMatchObject({ puzzleId: 860, solved: true });
    for (const g of games) expect(GAME_TYPES[g.gameTypeId]).toBeDefined();
  });

  test('garbage is an empty list, not a throw', () => {
    expect(parseHub({ data: { errors: [{ message: 'nope' }] } })).toEqual([]);
    expect(parseHub(null)).toEqual([]);
  });
});

describe('parseLeaderboard', () => {
  const page = parseLeaderboard(leaderboardFixture);

  test('every row, ranked or not, with the profile resolved', () => {
    expect(page.total).toBe(7);
    expect(page.rows).toHaveLength(7);
    expect(page.rows[0]).toMatchObject({
      ranking: 1,
      timeElapsed: 11,
      flawless: true,
      firstName: 'Alice',
      lastName: 'Test',
      publicIdentifier: 'alice-test',
    });
    expect(page.rows[0]!.profileUrn).toMatch(/^urn:li:fsd_profile:/);
  });

  test('an opted-out connection has no rank and no score', () => {
    const optedOut = page.rows.filter((r) => r.ranking === null);
    expect(optedOut).toHaveLength(1);
    expect(scoreOf(3, optedOut[0]!)).toBeNull();
  });

  test('ties share a rank and are all kept', () => {
    expect(page.rows.filter((r) => r.ranking === 2)).toHaveLength(3);
  });
});

describe('scoreOf', () => {
  const row = (over: Partial<LeaderboardRow>): LeaderboardRow => ({
    profileUrn: 'urn:li:fsd_profile:X',
    firstName: 'A',
    lastName: 'B',
    publicIdentifier: null,
    ranking: 1,
    timeElapsed: null,
    totalGuessCount: null,
    flawless: false,
    ...over,
  });

  test('timed games render like the paste parser does', () => {
    expect(scoreOf(3, row({ timeElapsed: 11 }))).toEqual({ game: 'queens', value: 11, display: '0:11' });
    expect(scoreOf(6, row({ timeElapsed: 125 }))).toEqual({ game: 'zip', value: 125, display: '2:05' });
  });

  test('pinpoint is guesses out of five', () => {
    expect(scoreOf(1, row({ totalGuessCount: 2 }))).toEqual({ game: 'pinpoint', value: 2, display: '2/5' });
    expect(scoreOf(1, row({ totalGuessCount: null }))).toBeNull();
  });

  test('unknown game type or missing score is null', () => {
    expect(scoreOf(42, row({ timeElapsed: 1 }))).toBeNull();
    expect(scoreOf(3, row({}))).toBeNull();
  });
});

test('leaderboardUrl percent-encodes the urn tuple the Rest.li way', () => {
  const url = leaderboardUrl({ memberId: 'ABC', gameTypeId: 3, puzzleId: 860, solved: true }, 25);
  expect(url).toContain('gameUrn:urn%3Ali%3Afsd_game%3A%28ABC%2C3%2C860%29,start:25,count:25');
});

describe('publicIdentifierOf', () => {
  test.each([
    ['https://www.linkedin.com/in/jean-dupont/', 'jean-dupont'],
    ['linkedin.com/in/jean-dupont?utm=x', 'jean-dupont'],
    ['jean-dupont', 'jean-dupont'],
    ['https://www.linkedin.com/feed/', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(publicIdentifierOf(input)).toBe(expected);
  });
});
