import { describe, expect, test } from 'vitest';
import { looksLikeAShare } from '../../src/bot/ingest';

/**
 * Governs what a GROUP message has to look like before it is stored. Too loose
 * and the calibration corpus fills with conversation; too tight and a result
 * for a game we do not support yet is lost, which is exactly what happened to
 * the first Waffle score.
 */
describe('recognising a share we cannot parse', () => {
  test('an unknown game with an emoji grid is kept', () => {
    expect(
      looksLikeAShare('#somenewgame42 3/7\n\n🟩🟩🟥🟩🟨\n🟩⬜🟩⬜🟩'),
    ).toBe(true);
  });

  test('an unknown game with only a score line is kept', () => {
    expect(looksLikeAShare('#quizzly991 12/20')).toBe(true);
  });

  test('a game we do support is kept', () => {
    expect(looksLikeAShare('Zip #533\n0:05 🏁')).toBe(true);
  });

  test('ordinary chat is not kept', () => {
    for (const chat of [
      'anyone played today?',
      'I forgot again 😅',
      'see you at 8',
      'we won 3/4 of the rounds last night',
      'https://example.com/some/link',
    ]) {
      expect(looksLikeAShare(chat)).toBe(false);
    }
  });

  test('a couple of stray emoji are not a grid', () => {
    expect(looksLikeAShare('nice one 🟩 well played 🟩')).toBe(false);
  });

  test('the real Waffle share would have been kept before Waffle existed', () => {
    // Neither branch depends on a Waffle parser existing.
    const sample = '#waffle1684 0/5\n\n🟩🟩🟩🟩🟩\n🟩⬜🟩⬜🟩\n🟩🟩🟩🟩🟩';
    expect(looksLikeAShare(sample)).toBe(true);
  });
});
