import { describe, expect, test } from 'vitest';
import type { MemberInfo, ScoreRow } from '../../src/lib/db';
import {
  buildBoards,
  eligibleDays,
  formatDigest,
  isComplete,
  TELEGRAM_MAX_MESSAGE,
} from '../../src/lib/digest';

const member = (userId: number, name: string, over: Partial<MemberInfo> = {}): MemberInfo => ({
  userId,
  name,
  active: true,
  joinedAt: Date.parse('2026-09-01T00:00:00Z') / 1000,
  games: ['queens', 'tango'],
  ...over,
});

const score = (userId: number, game: string, value: number, over: Partial<ScoreRow> = {}): ScoreRow => ({
  user_id: userId,
  game,
  play_date: '2026-09-05',
  value,
  display: String(value),
  raw: 'raw',
  ...over,
});

describe('isComplete', () => {
  const members = [member(1, 'Alice'), member(2, 'Bob')];

  test('true once every active member has at least one score', () => {
    expect(isComplete(members, [score(1, 'queens', 10), score(2, 'queens', 20)])).toBe(true);
  });

  test('false while someone is missing', () => {
    expect(isComplete(members, [score(1, 'queens', 10)])).toBe(false);
  });

  test('a paused player does not block the digest', () => {
    const withPaused = [...members, member(3, 'Chloe', { active: false })];
    expect(isComplete(withPaused, [score(1, 'queens', 10), score(2, 'queens', 20)])).toBe(true);
  });

  test('a group with no members never counts as complete', () => {
    expect(isComplete([], [])).toBe(false);
    expect(isComplete([], [score(9, 'queens', 10)])).toBe(false);
  });

  test('a group where everyone paused never counts as complete', () => {
    expect(isComplete([member(1, 'Alice', { active: false })], [])).toBe(false);
  });

  test('no scores at all is never complete', () => {
    expect(isComplete(members, [])).toBe(false);
  });
});

describe('buildBoards', () => {
  const members = [member(1, 'Alice'), member(2, 'Bob'), member(3, 'Chloe')];

  test('skips games nobody played', () => {
    const boards = buildBoards({
      members,
      scores: [score(1, 'queens', 10)],
      playDate: '2026-09-05',
    });
    expect(boards.map((b) => b.game)).toEqual(['queens']);
  });

  test('field counts everyone who selected the game, not who played it', () => {
    const boards = buildBoards({
      members,
      scores: [score(1, 'queens', 10)],
      playDate: '2026-09-05',
    });
    expect(boards[0]?.field).toBe(3);
    expect(boards[0]?.absent.map((p) => p.name)).toEqual(['Bob', 'Chloe']);
  });

  test('a member who did not select the game is neither ranked nor listed absent', () => {
    const mixed = [member(1, 'Alice'), member(2, 'Bob', { games: ['tango'] })];
    const boards = buildBoards({
      members: mixed,
      scores: [score(1, 'queens', 10)],
      playDate: '2026-09-05',
    });
    expect(boards[0]?.field).toBe(1);
    expect(boards[0]?.absent).toEqual([]);
  });

  test('ignores scores from people outside the group', () => {
    const boards = buildBoards({
      members,
      scores: [score(1, 'queens', 10), score(99, 'queens', 5)],
      playDate: '2026-09-05',
    });
    expect(boards[0]?.rows.map((r) => r.userId)).toEqual([1]);
  });
});

describe('eligibleDays', () => {
  test('a founder gets the whole period', () => {
    const days = eligibleDays([member(1, 'Alice')], '2026-09-01', '2026-09-10');
    expect(days.get(1)).toBe(10);
  });

  test('a newcomer is judged only on days since they joined', () => {
    const late = member(2, 'Bob', { joinedAt: Date.parse('2026-09-08T00:00:00Z') / 1000 });
    const days = eligibleDays([late], '2026-09-01', '2026-09-10');
    expect(days.get(2)).toBe(3);
  });

  test('someone who joined before the period is capped at the period length', () => {
    const old = member(3, 'Chloe', { joinedAt: Date.parse('2025-01-01T00:00:00Z') / 1000 });
    const days = eligibleDays([old], '2026-09-01', '2026-09-10');
    expect(days.get(3)).toBe(10);
  });
});

describe('formatDigest', () => {
  const members = [member(1, 'Alice'), member(2, 'Bob'), member(3, 'Chloe')];
  const scores = [
    score(1, 'queens', 31, { display: '0:31' }),
    score(2, 'queens', 42, { display: '0:42' }),
    score(1, 'tango', 65, { display: '1:05' }),
  ];
  const boards = buildBoards({ members, scores, playDate: '2026-09-05' });

  const render = (over = {}) =>
    formatDigest({
      title: 'Puzzle Crew',
      playDate: '2026-09-05',
      boards,
      members,
      periodBoards: boards,
      periodLabel: 'This month',
      eligible: eligibleDays(members, '2026-09-01', '2026-09-05'),
      ...over,
    });

  test('names the group and the day', () => {
    expect(render()).toContain('🏆 Puzzle Crew — Saturday 5 September');
  });

  test('shows each result and the points it earned', () => {
    const text = render();
    expect(text).toContain('Alice — 0:31 (+3)');
    expect(text).toContain('Bob — 0:42 (+2)');
  });

  test('lists absent players without scoring them', () => {
    expect(render()).toContain('absent: Chloe');
  });

  test('shows today and the running total', () => {
    const text = render();
    expect(text).toContain('📊 Today');
    expect(text).toContain('This month — total');
  });

  test('hides the average table until someone clears the participation floor', () => {
    // One day played out of five: ceil(5 * 0.6) = 3 days required.
    expect(render()).not.toContain('This month — average');
  });

  test('shows the average table once the floor is met', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
    const periodBoards = days.flatMap((d) =>
      buildBoards({
        members,
        scores: [score(1, 'queens', 31, { play_date: d }), score(2, 'queens', 42, { play_date: d })],
        playDate: d,
      }),
    );
    const text = render({ periodBoards });
    expect(text).toContain('This month — average');
    expect(text).toContain('/game');
  });

  test('pluralises game counts', () => {
    const text = render();
    expect(text).toContain('(1 game)');
    expect(text).toContain('(2 games)');
    expect(text).not.toContain('(1 games)');
  });

  test('says so plainly when nobody played', () => {
    expect(render({ boards: [] })).toContain('Nobody played today');
  });

  test('never exceeds the Telegram message limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => member(i + 1, `Player${i + 1}`));
    const manyScores = many.flatMap((m) => [
      score(m.userId, 'queens', m.userId, { display: `0:${m.userId}` }),
      score(m.userId, 'tango', m.userId, { display: `1:${m.userId}` }),
    ]);
    const bigBoards = buildBoards({ members: many, scores: manyScores, playDate: '2026-09-05' });
    const text = formatDigest({
      title: 'Huge Crew',
      playDate: '2026-09-05',
      boards: bigBoards,
      members: many,
      periodBoards: bigBoards,
      periodLabel: 'This month',
      eligible: eligibleDays(many, '2026-09-01', '2026-09-05'),
    });
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE);
  });
});
