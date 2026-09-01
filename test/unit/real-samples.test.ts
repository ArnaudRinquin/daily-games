import { describe, expect, test } from 'vitest';
import { parseAll } from '../../src/games/registry';

/**
 * Verbatim share text pasted by a player. Anything in here is ground truth —
 * if a case fails, the parser is wrong, not the fixture.
 */
const SAMPLES = {
  wend: 'Wend #85 | 0:41 🌀\nlnkd.in/wend.',
  zip: 'Zip #533 | 0:05 🏁\nlnkd.in/zip.',
  fermi: `Fermi · No. 37
01  1.75×
02  2.20×
03  1.21×
─────────
1.72× score · top 6%
fermi.gg/s/daily`,
};

describe('real share text', () => {
  test('Wend', () => {
    expect(parseAll(SAMPLES.wend)).toEqual([{ game: 'wend', value: 41, display: '0:41' }]);
  });

  test('Zip', () => {
    expect(parseAll(SAMPLES.zip)).toEqual([{ game: 'zip', value: 5, display: '0:05' }]);
  });

  test('Fermi', () => {
    expect(parseAll(SAMPLES.fermi)).toEqual([{ game: 'fermi', value: 1.72, display: '1.72×' }]);
  });

  test('the whole day pasted as one message', () => {
    const all = [SAMPLES.wend, SAMPLES.zip, SAMPLES.fermi].join('\n\n');
    expect(parseAll(all)).toEqual([
      { game: 'zip', value: 5, display: '0:05' },
      { game: 'wend', value: 41, display: '0:41' },
      { game: 'fermi', value: 1.72, display: '1.72×' },
    ]);
  });

  test('a trailing link line never confuses the score', () => {
    expect(parseAll(SAMPLES.zip)[0]?.value).toBe(5);
  });

  test('the emoji after the time is ignored', () => {
    expect(parseAll('Zip #533 | 0:05')).toEqual(parseAll(SAMPLES.zip));
  });
});
