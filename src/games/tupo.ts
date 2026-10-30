import type { GameParser, ParsedScore } from './types';
import { timeToSeconds } from './util';

/**
 * Tupo — a daily sudoku-style puzzle of numbers and colors. Real share text:
 *
 *   #Tupo - Oct 29th 2026 (Medium)
 *   ⏱️ Solved in 3:26
 *   🔍 5 checks
 *   💡 2 hints
 *   🎯 46 moves (26 minimum)
 *   Play at https://playtupo.com
 *
 * Built by the site's own share function, one line per entry. A perfect game
 * swaps the check, hint and move lines for `💯 A perfect game!`. The paste we
 * were given had lost every line break, so nothing here anchors on a line.
 *
 * The header carries a DATE, not a puzzle number. Bonus, pack and practice
 * puzzles share as `#Tupo Bonus - Week of …`, `#Tupo <Pack> · Puzzle N` and
 * `#Tupo Practice`; only the daily header scores, the rest stay unmatched.
 *
 * Ranked on time alone, lower is better. Checks and hints are deliberately
 * ignored. The time is `m:ss` with minutes unbounded.
 */
export const tupo: GameParser = {
  id: 'tupo',
  label: 'Tupo',
  url: 'https://playtupo.com/',
  emoji: '🔢',
  detect: (text) => /#Tupo\b/i.test(text),
  parse(text): ParsedScore | null {
    // The site writes a hyphen; en and em dashes are accepted too, since
    // clients and keyboards rewrite it.
    const header = /#Tupo\s*[-–—]\s*[A-Z][a-z]{2}\s+\d{1,2}(?:st|nd|rd|th)\s+\d{4}/i.exec(text);
    if (!header) return null;

    const rest = text.slice(header.index + header[0].length);
    const m = /Solved in\s*(\d+:\d{2})(?!\d)/i.exec(rest);
    if (!m?.[1]) return null;

    const seconds = timeToSeconds(m[1]);
    if (seconds === null) return null;
    return { value: seconds, display: m[1] };
  },
};
