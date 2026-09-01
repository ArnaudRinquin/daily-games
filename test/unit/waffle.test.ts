import { describe, expect, test } from 'vitest';
import { parseAll } from '../../src/games/registry';
import { waffle } from '../../src/games/waffle';

// Verbatim, as pasted into the group.
const SAMPLE = `#waffle1684 0/5

🟩🟩🟩🟩🟩
🟩⬜🟩⬜🟩
🟩🟩🟩🟩🟩
🟩⬜🟩⬜🟩
🟩🟩🟩🟩🟩

🔥 streak: 1
wafflegame.net`;

describe('waffle', () => {
  test('parses the real share text', () => {
    expect(parseAll(SAMPLE)).toEqual([{ game: 'waffle', value: 0, display: '0/5' }]);
  });

  test('stars are higher-is-better, so the value is negated', () => {
    const five = waffle.parse('#waffle1684 5/5')!;
    const zero = waffle.parse('#waffle1684 0/5')!;
    // 0/5 is a solve with nothing to spare, NOT a perfect round.
    expect(five.value).toBeLessThan(zero.value);
    expect(five.value).toBe(-5);
  });

  test('ranks the full range in the right order', () => {
    const values = [5, 4, 3, 2, 1, 0].map((n) => waffle.parse(`#waffle1 ${n}/5`)!.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  test('a failed board sorts below a zero-star solve', () => {
    expect(waffle.parse('#waffle1684 X/5')!.value).toBeGreaterThan(
      waffle.parse('#waffle1684 0/5')!.value,
    );
  });

  test('the emoji grid is never mistaken for the score', () => {
    expect(parseAll(SAMPLE)).toHaveLength(1);
    expect(parseAll(SAMPLE)[0]?.display).toBe('0/5');
  });

  test('the streak line is ignored', () => {
    expect(waffle.parse(SAMPLE)?.display).toBe('0/5');
  });

  test('rejects an out-of-range score and unrelated text', () => {
    expect(parseAll('#waffle1684 9/5')).toEqual([]);
    expect(parseAll('we played waffle yesterday')).toEqual([]);
  });

  test('does not claim a different waffle variant', () => {
    expect(parseAll('#deluxewaffle22 3/5')).toEqual([]);
  });

  test('coexists with other games in one paste', () => {
    expect(parseAll(`Zip #533\n0:05 🏁\n\n${SAMPLE}`).map((m) => m.game)).toEqual([
      'zip',
      'waffle',
    ]);
  });
});

test('a zero score is plain zero, never negative zero', () => {
  expect(Object.is(waffle.parse('#waffle1 0/5')!.value, -0)).toBe(false);
});
