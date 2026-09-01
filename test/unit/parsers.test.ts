import { describe, expect, test } from 'vitest';
import { parseAll, visibleGameIds, gameById } from '../../src/games/registry';
import { wordle } from '../../src/games/wordle';

// NOTE: these fixtures encode the ASSUMED share formats. Phase 3 replaces them
// with real pasted samples; any that differ get the parser fixed, not the test.

describe('catalog', () => {
  test('visible catalog is the offerable set', () => {
    expect(visibleGameIds()).toEqual([
      'queens',
      'tango',
      'zip',
      'wend',
      'crossclimb',
      'minisudoku',
      'patches',
      'pinpoint',
      'fermi',
      'lts_abordable',
      'lts_expert',
    ]);
  });

  test('every offered game has a parser that can actually read something', () => {
    for (const id of visibleGameIds()) {
      expect(gameById(id)?.hidden).toBeUndefined();
    }
  });
});

describe('timed LinkedIn games', () => {
  test('parses a Queens share with streak chatter', () => {
    const text = `Queens #456 | 0:42 and I have a 5-day streak! 🔥
lnkd.in/queens`;
    expect(parseAll(text)).toEqual([{ game: 'queens', value: 42, display: '0:42' }]);
  });

  test('parses minutes and seconds', () => {
    expect(parseAll('Tango #123 | 1:42')).toEqual([
      { game: 'tango', value: 102, display: '1:42' },
    ]);
  });

  test('handles a thousands separator in the puzzle number', () => {
    expect(parseAll('Zip #1,234 | 0:09')).toEqual([
      { game: 'zip', value: 9, display: '0:09' },
    ]);
  });

  test('rejects a malformed time rather than scoring it wrongly', () => {
    expect(parseAll('Crossclimb #12 | 1:9')).toEqual([]);
    expect(parseAll('Crossclimb #12 | 1:75')).toEqual([]);
  });
});

describe('pinpoint', () => {
  test('parses a guess count', () => {
    expect(parseAll('Pinpoint #321 | 2 guesses')).toEqual([
      { game: 'pinpoint', value: 2, display: '2/5' },
    ]);
  });

  test('accepts the singular', () => {
    expect(parseAll('Pinpoint #321 | 1 guess')).toEqual([
      { game: 'pinpoint', value: 1, display: '1/5' },
    ]);
  });

  test('rejects an out-of-range count', () => {
    expect(parseAll('Pinpoint #321 | 9 guesses')).toEqual([]);
  });
});

describe('wordle', () => {
  // Hidden until a real sample arrives, so parseAll skips it. The parser is
  // still exercised directly, ready for the day `hidden` comes off.
  test('is not offered while its format is unverified', () => {
    expect(wordle.hidden).toBe(true);
    expect(parseAll('Wordle 1,234 4/6')).toEqual([]);
  });

  test('parses a success', () => {
    expect(wordle.parse('Wordle 1,234 4/6\n\n⬛🟨⬛⬛⬛')).toEqual({ value: 4, display: '4/6' });
  });

  test('stores a failure as 7 so it sorts last', () => {
    expect(wordle.parse('Wordle 1234 X/6*')).toEqual({ value: 7, display: 'X/6' });
  });
});

describe('multi-game messages', () => {
  test('one paste can hold several results', () => {
    const text = `Queens #456 | 0:42
Tango #456 | 1:05
Zip #456 | 0:33`;
    expect(parseAll(text)).toEqual([
      { game: 'queens', value: 42, display: '0:42' },
      { game: 'tango', value: 65, display: '1:05' },
      { game: 'zip', value: 33, display: '0:33' },
    ]);
  });

  test('unrecognised text matches nothing', () => {
    expect(parseAll('did anyone play today?')).toEqual([]);
    expect(parseAll('')).toEqual([]);
  });

  test('a detected game with an unreadable score is dropped, not guessed', () => {
    expect(parseAll('Queens was brutal today')).toEqual([]);
  });
});
