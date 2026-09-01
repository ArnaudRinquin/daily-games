import type { GameParser, ParsedScore } from './types';
import { timeToSeconds } from './util';

/**
 * The LinkedIn puzzles share one shape, confirmed against real pasted text:
 *
 *   Queens #854 | 0:11 👑
 *   lnkd.in/queens.
 *
 * Most are timed; Pinpoint counts guesses. Some (Mini Sudoku) add a blurb line
 * under the header, so the score must be read off the header line itself.
 *
 * Every URL below is the share link from the player's own paste, not a guess.
 *
 * Parsers are deliberately STRICT: anything that does not match exactly returns
 * null, so the message stays in the unmatched corpus
 * (`SELECT text FROM messages WHERE matched_games IS NULL`) rather than being
 * scored wrongly and silently.
 */

const HEADER = (label: string) => new RegExp(`^[^\\S\\n]*${label}\\b`, 'im');

function timedGame(opts: {
  id: string;
  label: string;
  url: string;
  emoji: string;
}): GameParser {
  const header = HEADER(opts.label);
  const scoreLine = new RegExp(
    `^[^\\S\\n]*${opts.label}\\s*#?\\s*[\\d,.\\s]*\\|\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?)`,
    'im',
  );
  return {
    ...opts,
    detect: (text) => header.test(text),
    parse(text): ParsedScore | null {
      const m = scoreLine.exec(text);
      if (!m?.[1]) return null;
      const seconds = timeToSeconds(m[1]);
      if (seconds === null) return null;
      return { value: seconds, display: m[1] };
    },
  };
}

export const queens = timedGame({
  id: 'queens',
  label: 'Queens',
  url: 'https://lnkd.in/queens',
  emoji: '👑',
});

export const tango = timedGame({
  id: 'tango',
  label: 'Tango',
  url: 'https://lnkd.in/tango',
  emoji: '🌗',
});

export const zip = timedGame({
  id: 'zip',
  label: 'Zip',
  url: 'https://lnkd.in/zip',
  emoji: '🏁',
});

export const wend = timedGame({
  id: 'wend',
  label: 'Wend',
  url: 'https://lnkd.in/wend',
  emoji: '🌀',
});

export const crossclimb = timedGame({
  id: 'crossclimb',
  label: 'Crossclimb',
  url: 'https://lnkd.in/crossclimb',
  emoji: '🪜',
});

export const miniSudoku = timedGame({
  id: 'minisudoku',
  label: 'Mini Sudoku',
  url: 'https://lnkd.in/minisudoku',
  emoji: '✏️',
});

export const patches = timedGame({
  id: 'patches',
  label: 'Patches',
  url: 'https://lnkd.in/patches',
  emoji: '🧶',
});

/**
 * Pinpoint is scored in guesses (1 best, 5 worst) — already lower-is-better.
 * Real text: `Pinpoint #854 | 2 guesses with no mistakes`.
 */
export const pinpoint: GameParser = {
  id: 'pinpoint',
  label: 'Pinpoint',
  url: 'https://lnkd.in/pinpoint',
  emoji: '📌',
  detect: (text) => HEADER('Pinpoint').test(text),
  parse(text): ParsedScore | null {
    const m = /^[^\S\n]*Pinpoint\s*#?\s*[\d,.\s]*\|\s*(\d+)\s*(?:guess(?:es)?|\/\s*5)/im.exec(text);
    if (!m?.[1]) return null;
    const guesses = Number(m[1]);
    if (!Number.isInteger(guesses) || guesses < 1 || guesses > 5) return null;
    return { value: guesses, display: `${guesses}/5` };
  },
};

export const linkedinGames = [
  queens,
  tango,
  zip,
  wend,
  crossclimb,
  miniSudoku,
  patches,
  pinpoint,
];
