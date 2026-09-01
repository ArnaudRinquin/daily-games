import type { GameParser, ParsedScore } from './types';

/**
 * Hidden: no real Wordle share text has ever been pasted, so this parser is the
 * only unverified one left. Shipping it visible would pre-select a game the
 * group may not play and put a link they did not ask for in every reminder.
 * Drop `hidden` once a sample lands in `messages`.
 *
 * A failed Wordle stores as 7 so it sorts below every success.
 */
export const WORDLE_FAIL_VALUE = 7;

export const wordle: GameParser = {
  id: 'wordle',
  label: 'Wordle',
  url: 'https://www.nytimes.com/games/wordle/',
  emoji: '🟩',
  hidden: true,
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
