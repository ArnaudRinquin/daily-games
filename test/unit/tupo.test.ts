import { describe, expect, test } from 'vitest';
import { parseAll } from '../../src/games/registry';
import { tupo } from '../../src/games/tupo';

// Verbatim, as pasted by a player: every line break was lost on the way.
const SAMPLE =
  '#Tupo - Oct 29th 2026 (Medium)⏱️ Solved in 3:26🔍 5 checks💡 2 hints🎯 46 moves (26 minimum)Play at https://playtupo.com';

// The same result as the site builds it, one line per entry.
const MULTILINE = `#Tupo - Oct 29th 2026 (Medium)
⏱️ Solved in 3:26
🔍 5 checks
💡 2 hints
🎯 46 moves (26 minimum)
Play at https://playtupo.com`;

describe('tupo', () => {
  test('parses the real share text', () => {
    expect(parseAll(SAMPLE)).toEqual([{ game: 'tupo', value: 206, display: '3:26' }]);
  });

  test('parses the share with its line breaks intact', () => {
    expect(parseAll(MULTILINE)).toEqual([{ game: 'tupo', value: 206, display: '3:26' }]);
  });

  test('a perfect game has no check or hint lines', () => {
    // Verbatim, as pasted by a player.
    const text = `#Tupo - Oct 29th 2026 (Medium)
⏱️ Solved in 3:07
💯 A perfect game!
Play at https://playtupo.com`;
    expect(parseAll(text)).toEqual([{ game: 'tupo', value: 187, display: '3:07' }]);
  });

  test('minutes are unbounded', () => {
    expect(tupo.parse('#Tupo - Nov 2nd 2026 (Easy)\n⏱️ Solved in 63:05')?.value).toBe(3785);
  });

  test('checks and hints do not change the score', () => {
    const clean = tupo.parse('#Tupo - Oct 29th 2026 (Medium)\n⏱️ Solved in 3:26\n💯 A perfect game!')!;
    expect(tupo.parse(SAMPLE)!.value).toBe(clean.value);
  });

  test('an en dash instead of the hyphen still parses', () => {
    expect(tupo.parse('#Tupo – Oct 29th 2026 (Medium)\n⏱️ Solved in 3:26')?.value).toBe(206);
  });

  test.each([
    ['bonus', '#Tupo Bonus - Week of Oct 26th 2026 (Hard)\n⏱️ Solved in 5:00'],
    ['pack', '#Tupo Starter · Puzzle 3 (Easy)\n⏱️ Solved in 1:10'],
    ['practice', '#Tupo Practice (Tricky)\n⏱️ Solved in 2:30'],
  ])('a %s puzzle is detected but never scores', (_kind, text) => {
    expect(tupo.detect(text)).toBe(true);
    expect(tupo.parse(text)).toBeNull();
  });

  test('detect fires but parse gives up on a malformed time', () => {
    const text = '#Tupo - Oct 29th 2026 (Medium)\n⏱️ Solved in 3:2';
    expect(tupo.detect(text)).toBe(true);
    expect(tupo.parse(text)).toBeNull();
  });
});
