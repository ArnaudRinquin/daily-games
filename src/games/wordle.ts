import type { GameParser, ParsedScore } from './types';

/**
 * Verified against real share text: `Wordle 1,900 X/6` plus the emoji grid.
 *
 * A failed Wordle stores as 7 so it sorts below every success — but still
 * scores, because it still earns a rank. Turning up and failing beats not
 * turning up, which is the whole point of the ranking.
 */
export const WORDLE_FAIL_VALUE = 7;

export const wordle: GameParser = {
  id: 'wordle',
  label: 'Wordle',
  url: 'https://www.nytimes.com/games/wordle/',
  emoji: '🟩',
  detect: (text) => /^[^\S\n]*Wordle\b/im.test(text),
  parse(text): ParsedScore | null {
    // "Wordle 1,234 4/6" — also 4/6* for hard mode.
    const m = /^[^\S\n]*Wordle\s+[\d,.\s]+\s*([1-6X])\/6\*?/im.exec(text);
    if (!m?.[1]) return null;
    const tries = m[1].toUpperCase();
    return tries === 'X'
      ? { value: WORDLE_FAIL_VALUE, display: 'X/6' }
      : { value: Number(tries), display: `${tries}/6` };
  },
};
