import { describe, expect, test } from 'vitest';
import { parseAll } from '../../src/games/registry';
import { fermi } from '../../src/games/fermi';

const SAMPLE = `Fermi · No. 37
01  1.75×
02  2.20×
03  1.21×
─────────
1.72× score · top 6%
fermi.gg/s/daily`;

describe('fermi', () => {
  test('parses the real share text', () => {
    expect(parseAll(SAMPLE)).toEqual([{ game: 'fermi', value: 1.72, display: '1.72×' }]);
  });

  test('is offerable now that the format is confirmed', () => {
    expect(fermi.hidden).toBeUndefined();
  });

  test('takes the total, not a per-question line', () => {
    // 1.75 is the first line and would win a naive "first number" parse.
    expect(parseAll(SAMPLE)[0]?.value).toBe(1.72);
  });

  test('lower is better: a perfect round is 1.00x', () => {
    const perfect = parseAll('Fermi · No. 40\n01  1.00×\n─────────\n1.00× score · top 1%');
    expect(perfect[0]?.value).toBe(1);
    expect(perfect[0]!.value).toBeLessThan(parseAll(SAMPLE)[0]!.value);
  });

  test('accepts a plain x and a comma decimal', () => {
    expect(parseAll('Fermi · No. 41\n2,50x score · top 40%')[0]?.value).toBe(2.5);
  });

  test('handles a whole-number score', () => {
    expect(parseAll('Fermi · No. 42\n3× score · top 80%')).toEqual([
      { game: 'fermi', value: 3, display: '3.00×' },
    ]);
  });

  test('drops a Fermi message with no readable total', () => {
    expect(parseAll('Fermi · No. 43\n01  1.75×\n02  2.20×')).toEqual([]);
    expect(parseAll('Fermi was rough today')).toEqual([]);
  });

  test('coexists with other games in one paste', () => {
    expect(parseAll(`Queens #456 | 0:42\n\n${SAMPLE}`).map((m) => m.game)).toEqual([
      'queens',
      'fermi',
    ]);
  });
});
