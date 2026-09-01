import type { GameParser, ParsedScore } from './types';

/**
 * Waffle — a daily word grid. Real share text:
 *
 *   #waffle1684 0/5
 *
 *   🟩🟩🟩🟩🟩
 *   🟩⬜🟩⬜🟩
 *   …
 *   🔥 streak: 1
 *   wafflegame.net
 *
 * From the game's own rules: "Solve the WAFFLE in 15 swaps or fewer. Every
 * WAFFLE can be solved in a minimum of 10 swaps. You will earn a star for every
 * swap you have remaining." So the score is stars out of 5 and HIGHER IS
 * BETTER — `0/5` is a solve with nothing to spare, not a perfect round. The
 * value is negated to match the lower-is-better contract.
 */
export const waffle: GameParser = {
  id: 'waffle',
  label: 'Waffle',
  url: 'https://wafflegame.net/',
  emoji: '🧇',
  detect: (text) => /^[^\S\n]*#?waffle\s*\d+/im.test(text),
  parse(text): ParsedScore | null {
    const m = /^[^\S\n]*#?waffle\s*\d+\s+([0-5X])\s*\/\s*5/im.exec(text);
    if (!m?.[1]) return null;

    const raw = m[1].toUpperCase();
    // A failed board sorts below a zero-star solve.
    if (raw === 'X') return { value: 1, display: 'X/5' };

    const stars = Number(raw);
    // `-0` is not `0` to Object.is, and negative zero has no business in a
    // score column.
    return { value: stars === 0 ? 0 : -stars, display: `${stars}/5` };
  },
};
