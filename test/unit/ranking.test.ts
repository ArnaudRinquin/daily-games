import { describe, expect, test } from 'vitest';
import { aggregate, byAverage, rankDay, type DailyBoard, type PlayerRef } from '../../src/lib/ranking';

const P = (id: number, name: string): PlayerRef => ({ userId: id, name });
const five = [P(1, 'Alice'), P(2, 'Bob'), P(3, 'Chloe'), P(4, 'Dan'), P(5, 'Eve')];
const s = (userId: number, value: number) => ({ userId, value, display: String(value) });

const day = (scores: { userId: number; value: number; display: string }[], field = five) =>
  rankDay({ game: 'queens', playDate: '2026-09-01', field, scores });

describe('rankDay', () => {
  test('last place scores 1 and each place above adds one', () => {
    const board = day([s(1, 10), s(2, 20), s(3, 30), s(4, 40), s(5, 50)]);
    expect(board.rows.map((r) => r.points)).toEqual([5, 4, 3, 2, 1]);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  test('ties share the better rank and the same points, then ranks skip', () => {
    const board = day([s(1, 10), s(2, 10), s(3, 30), s(4, 40), s(5, 50)]);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 1, 3, 4, 5]);
    expect(board.rows.map((r) => r.points)).toEqual([5, 5, 3, 2, 1]);
  });

  test('a three-way tie for first', () => {
    const board = day([s(1, 10), s(2, 10), s(3, 10), s(4, 40), s(5, 50)]);
    expect(board.rows.map((r) => r.points)).toEqual([5, 5, 5, 2, 1]);
  });

  test('everyone tied gets full points', () => {
    const board = day([s(1, 10), s(2, 10), s(3, 10), s(4, 10), s(5, 10)]);
    expect(board.rows.map((r) => r.points)).toEqual([5, 5, 5, 5, 5]);
  });
});

describe('absent players', () => {
  test('are listed, not scored', () => {
    const board = day([s(1, 10), s(2, 20)]);
    expect(board.rows).toHaveLength(2);
    expect(board.absent.map((p) => p.name)).toEqual(['Chloe', 'Dan', 'Eve']);
    expect(board.rows.some((r) => r.points === 0)).toBe(false);
  });

  test('a quiet day still pays full points — the field is fixed', () => {
    const busy = day([s(1, 10), s(2, 20), s(3, 30), s(4, 40), s(5, 50)]);
    const quiet = day([s(1, 10)]);
    expect(quiet.field).toBe(5);
    expect(quiet.rows[0]?.points).toBe(busy.rows[0]?.points);
    expect(quiet.rows[0]?.points).toBe(5);
  });

  test('nobody played: an empty board, no crash', () => {
    const board = day([]);
    expect(board.rows).toEqual([]);
    expect(board.absent).toHaveLength(5);
    expect(board.field).toBe(5);
  });
});

describe('field edge cases', () => {
  test('a single-player field awards 1 point', () => {
    const board = day([s(1, 10)], [P(1, 'Alice')]);
    expect(board.rows[0]?.points).toBe(1);
  });

  test('a score from someone who deselected the game never yields 0 points', () => {
    // Field of 1, but two people submitted.
    const board = day([s(1, 10), s(9, 20)], [P(1, 'Alice')]);
    expect(board.field).toBe(2);
    expect(board.rows.map((r) => r.points)).toEqual([2, 1]);
    expect(board.rows.every((r) => r.points >= 1)).toBe(true);
  });

  test('ranking is deterministic when values and order collide', () => {
    const a = day([s(2, 10), s(1, 10)]);
    const b = day([s(1, 10), s(2, 10)]);
    expect(a.rows.map((r) => r.userId)).toEqual(b.rows.map((r) => r.userId));
  });
});

describe('aggregate', () => {
  const boards = (): DailyBoard[] => [
    rankDay({ game: 'queens', playDate: '2026-09-01', field: five, scores: [s(1, 10), s(2, 20)] }),
    rankDay({ game: 'tango', playDate: '2026-09-01', field: five, scores: [s(1, 30), s(2, 20)] }),
    rankDay({ game: 'queens', playDate: '2026-09-02', field: five, scores: [s(2, 10)] }),
  ];

  test('total points rewards turning up', () => {
    const standings = aggregate({
      boards: boards(),
      members: five,
      eligibleDays: new Map(five.map((p) => [p.userId, 2])),
    });
    const bob = standings.find((x) => x.name === 'Bob')!;
    const alice = standings.find((x) => x.name === 'Alice')!;
    expect(bob.gamesPlayed).toBe(3);
    expect(alice.gamesPlayed).toBe(2);
    expect(bob.totalPoints).toBeGreaterThan(alice.totalPoints);
    expect(standings[0]?.name).toBe('Bob');
  });

  test('counts distinct days, not games', () => {
    const standings = aggregate({
      boards: boards(),
      members: five,
      eligibleDays: new Map(five.map((p) => [p.userId, 2])),
    });
    expect(standings.find((x) => x.name === 'Alice')?.daysPlayed).toBe(1);
    expect(standings.find((x) => x.name === 'Bob')?.daysPlayed).toBe(2);
  });

  test('players who never played appear with zero, not missing', () => {
    const standings = aggregate({
      boards: boards(),
      members: five,
      eligibleDays: new Map(five.map((p) => [p.userId, 2])),
    });
    expect(standings).toHaveLength(5);
    const eve = standings.find((x) => x.name === 'Eve')!;
    expect(eve.totalPoints).toBe(0);
    expect(eve.averagePoints).toBeNull();
    expect(eve.rankedOnAverage).toBe(false);
  });
});

describe('participation floor', () => {
  test('excludes a one-day wonder from the average table', () => {
    const boards = [
      rankDay({ game: 'queens', playDate: '2026-09-01', field: five, scores: [s(1, 10), s(2, 20)] }),
      ...['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map((d) =>
        rankDay({ game: 'queens', playDate: d, field: five, scores: [s(2, 20)] }),
      ),
    ];
    // Alice played 1 of 5 days; Bob played all 5.
    const standings = aggregate({
      boards,
      members: five,
      eligibleDays: new Map(five.map((p) => [p.userId, 5])),
    });
    expect(standings.find((x) => x.name === 'Alice')?.rankedOnAverage).toBe(false);
    expect(standings.find((x) => x.name === 'Bob')?.rankedOnAverage).toBe(true);
    expect(byAverage(standings).map((x) => x.name)).toEqual(['Bob']);
  });

  test('a newcomer is judged on days since they joined, not the whole period', () => {
    const boards = ['2026-09-04', '2026-09-05'].map((d) =>
      rankDay({ game: 'queens', playDate: d, field: five, scores: [s(3, 10)] }),
    );
    const standings = aggregate({
      boards,
      members: five,
      // Chloe joined two days ago; everyone else has been here 5 days.
      eligibleDays: new Map([
        [1, 5],
        [2, 5],
        [3, 2],
        [4, 5],
        [5, 5],
      ]),
    });
    expect(standings.find((x) => x.name === 'Chloe')?.rankedOnAverage).toBe(true);
  });

  test('average rewards being good, total rewards turning up', () => {
    // 5 days. Alice plays 3 and wins every one; Bob plays all 5 and comes second.
    const boards = [
      ...['2026-09-01', '2026-09-02', '2026-09-03'].map((d) =>
        rankDay({ game: 'queens', playDate: d, field: five, scores: [s(1, 10), s(2, 20)] }),
      ),
      ...['2026-09-04', '2026-09-05'].map((d) =>
        rankDay({ game: 'queens', playDate: d, field: five, scores: [s(2, 20)] }),
      ),
    ];
    const standings = aggregate({
      boards,
      members: five,
      eligibleDays: new Map(five.map((p) => [p.userId, 5])),
    });
    // Bob: 3x4 + 2x5 = 22 over 5 games. Alice: 3x5 = 15 over 3 games.
    expect(standings[0]?.name).toBe('Bob');
    expect(standings.find((x) => x.name === 'Alice')?.rankedOnAverage).toBe(true);
    expect(byAverage(standings)[0]?.name).toBe('Alice');
  });

  test('exactly at the floor qualifies, one day short does not', () => {
    const play = (d: string, ids: number[]) =>
      rankDay({ game: 'queens', playDate: d, field: five, scores: ids.map((i) => s(i, 10 * i)) });
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
    // ceil(5 * 0.6) = 3 days required. Alice plays 3, Bob plays 2.
    const boards = [play(days[0]!, [1, 2]), play(days[1]!, [1, 2]), play(days[2]!, [1])];
    const standings = aggregate({
      boards,
      members: five,
      eligibleDays: new Map(five.map((p) => [p.userId, 5])),
    });
    expect(standings.find((x) => x.name === 'Alice')?.rankedOnAverage).toBe(true);
    expect(standings.find((x) => x.name === 'Bob')?.rankedOnAverage).toBe(false);
  });
});
