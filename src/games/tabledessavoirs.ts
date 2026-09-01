import type { GameParser, ParsedScore } from './types';
import { toInt } from './util';

/**
 * La Table des Savoirs — a French daily quiz. Real share text:
 *
 *    La Table des Savoirs - 1 septembre 2026
 *   Quiz Abordable (8/10)
 *
 *   🟩 🟥 🟩 🟩 🟨 🟩 🟩 🟩 🟩 🟩
 *   ⭐️ ▪️ ▪️ ▪️ ▪️ ▪️ ⭐️ ▪️ ▪️ ⭐️
 *
 *   Score: 240+ points
 *
 *   https://latabledessavoirs.fr
 *
 * The site ships two daily quizzes at different difficulties, and its own code
 * maps them: `facile -> "Abordable"`, `difficile -> "Expert"`. They are separate
 * games here rather than one, because a harder quiz scores differently and
 * ranking them together would reward picking the hard one over playing well.
 *
 * Points are HIGHER-is-better, so the value is negated to match the
 * lower-is-better contract every other parser follows.
 *
 * A third mode ("Événement") exists in the site's code. With no sample of its
 * share text it is left unmatched on purpose: it lands in the calibration
 * corpus rather than being scored as one of these two.
 */

// Whitespace-tolerant: the shared text carries a leading space, and French
// typography sprinkles non-breaking spaces around. `\s` covers NBSP and the
// narrow NBSP, so doubled or exotic spacing between words still matches.
const HEADER = /^[^\S\n]*La\s+Table\s+des\s+Savoirs\b/im;

function tier(opts: {
  id: string;
  label: string;
  emoji: string;
  /** The word the share text uses, e.g. "Abordable". */
  quizWord: string;
  /** The site's own route, which does not always match the label. */
  path: string;
}): GameParser {
  const quiz = new RegExp(`Quiz\\s+${opts.quizWord}\\b`, 'i');
  return {
    id: opts.id,
    label: opts.label,
    emoji: opts.emoji,
    url: `https://latabledessavoirs.fr/${opts.path}`,
    // Both tiers share a header, so the tier word is what tells them apart —
    // without it each would claim the other's result.
    detect: (text) => HEADER.test(text) && quiz.test(text),
    parse(text): ParsedScore | null {
      if (!quiz.test(text)) return null;

      // French formatting can put a space or nbsp inside the number, and the
      // score carries a trailing "+".
      const scoreMatch = /Score\s*:\s*([\d.,   ]+?)\s*\+?\s*points?/i.exec(text);
      if (!scoreMatch?.[1]) return null;

      const points = toInt(scoreMatch[1]);
      if (points === null || points < 0) return null;

      const correctMatch = /\((\d{1,2})\s*\/\s*(\d{1,2})\)/.exec(text);
      const correct =
        correctMatch?.[1] && correctMatch[2] ? ` (${correctMatch[1]}/${correctMatch[2]})` : '';

      return { value: -points, display: `${points} pts${correct}` };
    },
  };
}

export const ltsAbordable = tier({
  id: 'lts_abordable',
  label: 'Table des Savoirs · Abordable',
  emoji: '📗',
  quizWord: 'Abordable',
  path: 'abordable',
});

export const ltsExpert = tier({
  id: 'lts_expert',
  label: 'Table des Savoirs · Expert',
  emoji: '📕',
  quizWord: 'Expert',
  // The site routes Expert at /difficile — its label and its path disagree.
  path: 'difficile',
});

export const tableDesSavoirsGames = [ltsAbordable, ltsExpert];
