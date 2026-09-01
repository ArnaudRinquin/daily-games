import { describe, expect, test } from 'vitest';
import { parseAll, visibleGameIds } from '../../src/games/registry';
import { ltsAbordable, ltsExpert } from '../../src/games/tabledessavoirs';

// Verbatim, including the leading space on the first line.
const ABORDABLE = ` La Table des Savoirs - 1 septembre 2026
Quiz Abordable (8/10)

🟩 🟥 🟩 🟩 🟨 🟩 🟩 🟩 🟩 🟩
⭐️ ▪️ ▪️ ▪️ ▪️ ▪️ ⭐️ ▪️ ▪️ ⭐️

Score: 240+ points

https://latabledessavoirs.fr`;

const EXPERT = ABORDABLE.replace('Quiz Abordable (8/10)', 'Quiz Expert (6/10)').replace(
  'Score: 240+ points',
  'Score: 310 points',
);

describe('la table des savoirs', () => {
  test('parses the real Abordable share text', () => {
    expect(parseAll(ABORDABLE)).toEqual([
      { game: 'lts_abordable', value: -240, display: '240 pts (8/10)' },
    ]);
  });

  test('both tiers are separate games', () => {
    expect(visibleGameIds()).toContain('lts_abordable');
    expect(visibleGameIds()).toContain('lts_expert');
  });

  test('the tier word decides which game claims the result', () => {
    expect(parseAll(EXPERT)).toEqual([
      { game: 'lts_expert', value: -310, display: '310 pts (6/10)' },
    ]);
  });

  test('neither tier claims the other', () => {
    expect(ltsExpert.detect(ABORDABLE)).toBe(false);
    expect(ltsAbordable.detect(EXPERT)).toBe(false);
  });

  test('a message never scores as both tiers at once', () => {
    expect(parseAll(ABORDABLE)).toHaveLength(1);
    expect(parseAll(EXPERT)).toHaveLength(1);
  });

  test('points are higher-is-better, so the value is negated', () => {
    const better = ltsAbordable.parse('La Table des Savoirs\nQuiz Abordable\nScore: 300 points')!;
    const worse = ltsAbordable.parse('La Table des Savoirs\nQuiz Abordable\nScore: 120 points')!;
    expect(better.value).toBeLessThan(worse.value);
  });

  test('handles the trailing plus and French thousands separators', () => {
    const p = (t: string) => ltsAbordable.parse(`La Table des Savoirs\nQuiz Abordable\n${t}`);
    expect(p('Score: 240+ points')?.display).toBe('240 pts');
    expect(p('Score: 1 240 points')?.value).toBe(-1240);
    expect(p('Score: 1 240 points')?.value).toBe(-1240);
    expect(p('Score: 1 point')?.value).toBe(-1);
  });

  test('the Événement mode is left for the corpus, not mis-scored', () => {
    const event = ABORDABLE.replace('Quiz Abordable (8/10)', 'Quiz Événement (9/10)');
    expect(parseAll(event)).toEqual([]);
  });

  test('tolerates awkward spacing in the title and around the score', () => {
    const variants = [
      ABORDABLE,                                              // leading space, as shared
      ABORDABLE.replace('La Table des Savoirs', 'La  Table  des  Savoirs'), // doubled
      ABORDABLE.replace('La Table des Savoirs', 'La\u00A0Table des Savoirs'), // NBSP
      ABORDABLE.replace('Score:', 'Score\u00A0:'),             // French spacing
      ABORDABLE.replace('Score: 240+', 'Score:240+'),         // no space at all
      ABORDABLE.replace(/^ /, ''),                            // no leading space
    ];
    for (const v of variants) {
      expect(parseAll(v)).toEqual([
        { game: 'lts_abordable', value: -240, display: '240 pts (8/10)' },
      ]);
    }
  });

  test('drops a message with no readable score', () => {
    expect(parseAll('La Table des Savoirs - 1 septembre 2026\nQuiz Abordable (8/10)')).toEqual([]);
    expect(parseAll('on a joué à La Table des Savoirs hier')).toEqual([]);
  });

  test('the emoji grid is not mistaken for a score', () => {
    expect(parseAll(ABORDABLE)).toHaveLength(1);
  });

  test('coexists with LinkedIn games, and with the other tier, in one paste', () => {
    const day = `Zip #533\n0:05 🏁\n\n${ABORDABLE}\n\n${EXPERT}`;
    expect(parseAll(day).map((m) => m.game)).toEqual(['zip', 'lts_abordable', 'lts_expert']);
  });
});
