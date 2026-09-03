import { describe, expect, test } from 'vitest';
import { parseAll } from '../../src/games/registry';
import { lemot } from '../../src/games/lemot';

// Verbatim, as shared from the iOS share sheet.
const SAMPLE = `Le Mot (@WordleFR) #1698 5/6

⬛⬛⬛🟩⬛
⬛🟨🟨🟨🟨
🟨⬛🟨🟨🟨
🟩⬛🟩⬛🟨
🟩🟩🟩🟩🟩

https://wordle.louan.me`;

describe('le mot', () => {
  test('parses the share text', () => {
    expect(parseAll(SAMPLE)).toEqual([{ game: 'lemot', value: 5, display: '5/6' }]);
  });

  test('a fail is the skull, stored below every success', () => {
    expect(lemot.parse('Le Mot (@WordleFR) #1234 💀/6')).toEqual({ value: 7, display: 'X/6' });
  });

  test('does not collide with NYT Wordle', () => {
    const both = `Wordle 1,900 3/6\n\n🟩🟩🟩🟩🟩\n\n${SAMPLE}`;
    expect(parseAll(both).map((m) => `${m.game}:${m.value}`).sort()).toEqual([
      'lemot:5',
      'wordle:3',
    ]);
    expect(parseAll('Wordle 1,900 3/6').map((m) => m.game)).toEqual(['wordle']);
  });

  test('archive replays are not a daily result', () => {
    expect(lemot.parse('Le Mot (@WordleFR) archive #12 [03/09/2026] 4/6')).toBeNull();
  });

  test('without the trailing link', () => {
    expect(parseAll(SAMPLE.replace('https://wordle.louan.me', '').trimEnd())).toHaveLength(1);
  });
});
