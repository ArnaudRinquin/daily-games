import type { GameParser, ParsedScore } from './types';
import { timeToSeconds } from './util';

/**
 * The LinkedIn puzzles share one shape, confirmed against real pasted text —
 * but the separator differs by platform. Web puts the score on the header line
 * after a pipe; the iOS app puts it on the next line with no pipe at all:
 *
 *   Queens #854 | 0:11 👑        Zip #533
 *   lnkd.in/queens.              0:05 🏁
 *                                🏅 I'm smarter than 90% of CEOs today!
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
    // <name> …anything but a pipe or newline… then EITHER a pipe OR a line
    // break, then the time. The trailing class is horizontal whitespace only,
    // so the score must be the very next thing — never a time further down.
    `^[^\\S\\n]*${opts.label}\\b[^\\n|]*(?:\\||\\n)[^\\S\\n]*(\\d{1,2}:\\d{2}(?::\\d{2})?)`,
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
 * Real text on a solve: `Pinpoint #854 | 2 guesses with no mistakes`, with the
 * same two-platform separator problem as the timed games.
 *
 * A FAILED round shares differently: the app drops the guess count from the
 * header entirely, leaving only the five keycap lines and no pin.
 *
 *   Pinpoint #857          Pinpoint #854 | 2 guesses with no mistakes
 *   1️⃣ | 24% match         1️⃣ | 12% match
 *   …                      2️⃣ | 100% match 📌
 *   5️⃣ | 28% match         lnkd.in/pinpoint.
 *   lnkd.in/pinpoint.
 *
 * So the keycap lines are the fallback: the pin marks the guess that landed,
 * and five lines without one is a failure. Stored as 6 — below every success,
 * but still a rank, because turning up and failing beats not turning up.
 */
export const PINPOINT_FAIL_VALUE = 6;

/** `1️⃣ | 24% match` — digit, optional variation selector, keycap. */
const PINPOINT_GUESS_LINE = /^[^\S\n]*(\d)\uFE0F?\u20E3[^\n]*/gmu;

/** The guess that landed: the app pins it, and it always reads 100%. */
const PINPOINT_HIT = /📌|\b100\s*%\s*match/iu;

function pinpointFromGuessLines(text: string): ParsedScore | null {
  const lines = [...text.matchAll(PINPOINT_GUESS_LINE)];
  if (lines.length === 0) return null;

  const hit = lines.find((l) => PINPOINT_HIT.test(l[0]));
  if (hit?.[1]) {
    const guesses = Number(hit[1]);
    if (guesses < 1 || guesses > 5) return null;
    return { value: guesses, display: `${guesses}/5` };
  }

  // Only a full board of five proves a failure. Anything shorter is a partial
  // paste, and guessing at it would score somebody wrongly and silently.
  if (lines.length !== 5) return null;
  return { value: PINPOINT_FAIL_VALUE, display: 'X/5' };
}

export const pinpoint: GameParser = {
  id: 'pinpoint',
  label: 'Pinpoint',
  url: 'https://lnkd.in/pinpoint',
  emoji: '📌',
  detect: (text) => HEADER('Pinpoint').test(text),
  parse(text): ParsedScore | null {
    const m = /^[^\S\n]*Pinpoint\b[^\n|]*(?:\||\n)[^\S\n]*(\d+)\s*(?:guess(?:es)?|\/\s*5)/im.exec(
      text,
    );
    const guesses = m?.[1] === undefined ? NaN : Number(m[1]);
    if (Number.isInteger(guesses) && guesses >= 1 && guesses <= 5) {
      return { value: guesses, display: `${guesses}/5` };
    }
    // The header carried no usable count: read the keycap lines instead.
    return pinpointFromGuessLines(text);
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
