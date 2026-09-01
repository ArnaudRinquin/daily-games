import type { GameParser, ParsedScore } from './types';
import { timeToSeconds } from './util';

/**
 * The LinkedIn puzzles share one shape: `<Name> #<puzzle> | <score>`, often
 * followed by streak chatter and a lnkd.in link. Queens, Tango, Zip and
 * Crossclimb are timed; Pinpoint counts guesses.
 *
 * Parsers here are deliberately STRICT: anything that does not match exactly
 * returns null, so the message stays in the unmatched corpus
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
  url: 'https://www.linkedin.com/games/queens/',
  emoji: '👑',
});

export const tango = timedGame({
  id: 'tango',
  label: 'Tango',
  url: 'https://www.linkedin.com/games/tango/',
  emoji: '🌗',
});

export const zip = timedGame({
  id: 'zip',
  label: 'Zip',
  url: 'https://www.linkedin.com/games/zip/',
  emoji: '⚡',
});

export const crossclimb = timedGame({
  id: 'crossclimb',
  label: 'Crossclimb',
  url: 'https://www.linkedin.com/games/crossclimb/',
  emoji: '🪜',
});

/** Pinpoint is scored in guesses (1 best, 5 worst) — already lower-is-better. */
export const pinpoint: GameParser = {
  id: 'pinpoint',
  label: 'Pinpoint',
  url: 'https://www.linkedin.com/games/pinpoint/',
  emoji: '📌',
  detect: (text) => HEADER('Pinpoint').test(text),
  parse(text): ParsedScore | null {
    const m = /^[^\S\n]*Pinpoint\s*#?\s*[\d,.\s]*\|\s*(\d+)\s*(?:guess|guesses|\/\s*5)/im.exec(
      text,
    );
    if (!m?.[1]) return null;
    const guesses = Number(m[1]);
    if (!Number.isInteger(guesses) || guesses < 1 || guesses > 5) return null;
    return { value: guesses, display: `${guesses}/5` };
  },
};

export const linkedinGames = [queens, tango, zip, crossclimb, pinpoint];
