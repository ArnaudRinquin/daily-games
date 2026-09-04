import { describe, expect, test } from 'vitest';
import { parseAll } from '../../src/games/registry';

/**
 * Verbatim share text pasted by a player. Ground truth: if a case here fails,
 * the parser is wrong, not the fixture.
 */
const SAMPLES = {
  queens: 'Queens #854 | 0:11 👑\nlnkd.in/queens.',
  tango: 'Tango #694 | 0:33 🌗\nlnkd.in/tango.',
  zip: 'Zip #533 | 0:05 🏁\nlnkd.in/zip.',
  wend: 'Wend #85 | 0:41 🌀\nlnkd.in/wend.',
  crossclimb: 'Crossclimb #854 | 2:42 🪜\nlnkd.in/crossclimb.',
  minisudoku: `Mini Sudoku #386 | 0:54 ✏️
The classic game, made mini. Handcrafted by the originators of "Sudoku."
lnkd.in/minisudoku.`,
  patches: 'Patches #168 | 0:07 🧶\nlnkd.in/patches.',
  pinpoint: `Pinpoint #854 | 2 guesses with no mistakes
1️⃣ | 12% match
2️⃣ | 100% match 📌
lnkd.in/pinpoint.`,
  wordle: `Wordle 1,900 X/6

⬛⬛🟨⬛⬛
🟩🟩⬛⬛⬛
🟩🟩🟨⬛⬛
🟩🟩⬛⬛⬛
🟩🟩⬛⬛⬛
⬛🟨🟨🟨⬛`,
  lemot: `Le Mot (@WordleFR) #1698 5/6

⬛⬛⬛🟩⬛
⬛🟨🟨🟨🟨
🟨⬛🟨🟨🟨
🟩⬛🟩⬛🟨
🟩🟩🟩🟩🟩

https://wordle.louan.me`,
  geozee: `Geozee #58 — 257/742 · top 97% 🌍
🇸🇨🇵🇼🇮🇩🇸🇳🇫🇲🇧🇹🇹🇻🇸🇽🇬🇧

🟨🟩🟥
🟥🟥🟥
🟥🟩🟥

https://geozee.earth?ref=share`,
  fermi: `Fermi · No. 37
01  1.75×
02  2.20×
03  1.21×
─────────
1.72× score · top 6%
fermi.gg/s/daily`,
};

describe('real share text, one game at a time', () => {
  const expected: Record<keyof typeof SAMPLES, { game: string; value: number; display: string }> = {
    queens: { game: 'queens', value: 11, display: '0:11' },
    tango: { game: 'tango', value: 33, display: '0:33' },
    zip: { game: 'zip', value: 5, display: '0:05' },
    wend: { game: 'wend', value: 41, display: '0:41' },
    crossclimb: { game: 'crossclimb', value: 162, display: '2:42' },
    minisudoku: { game: 'minisudoku', value: 54, display: '0:54' },
    patches: { game: 'patches', value: 7, display: '0:07' },
    pinpoint: { game: 'pinpoint', value: 2, display: '2/5' },
    wordle: { game: 'wordle', value: 7, display: 'X/6' },
    lemot: { game: 'lemot', value: 5, display: '5/6' },
    geozee: { game: 'geozee', value: -257, display: '257/742' },
    fermi: { game: 'fermi', value: 1.72, display: '1.72×' },
  };

  for (const key of Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]) {
    test(key, () => {
      expect(parseAll(SAMPLES[key])).toEqual([expected[key]]);
    });
  }
});

/**
 * The iOS app shares a different shape from the web: the score goes on its own
 * line with no pipe. Text below is byte-for-byte what the bot received.
 */
const IOS = {
  zip: "Zip #533\n0:05 \u{1F3C1}\n\u{1F3C5} I\u2019m smarter than 90% of CEOs today!\n#AreYouSmarterThanaCEO\nlnkd.in/zip.",
};

describe('iOS share format', () => {
  test('reads a score from the line below the header', () => {
    expect(parseAll(IOS.zip)).toEqual([{ game: 'zip', value: 5, display: '0:05' }]);
  });

  test('the CEO brag line and hashtag do not confuse it', () => {
    expect(parseAll(IOS.zip)).toHaveLength(1);
  });

  test('both platform shapes agree on the same result', () => {
    expect(parseAll(IOS.zip)).toEqual(parseAll(SAMPLES.zip));
  });

  test('a header with no score below it is still rejected', () => {
    expect(parseAll('Zip #533\nlnkd.in/zip.')).toEqual([]);
  });

  test('a time further down the message is not picked up', () => {
    // Only the line immediately after the header counts.
    expect(parseAll('Zip #533\nsome chatter\n0:05')).toEqual([]);
  });

  test('a whole iOS day still splits per game', () => {
    const day = [
      'Queens #854\n0:11 \u{1F451}\nlnkd.in/queens.',
      'Tango #694\n0:33 \u{1F317}\nlnkd.in/tango.',
      IOS.zip,
      'Pinpoint #854\n2 guesses with no mistakes\nlnkd.in/pinpoint.',
    ].join('\n\n');
    expect(parseAll(day)).toEqual([
      { game: 'queens', value: 11, display: '0:11' },
      { game: 'tango', value: 33, display: '0:33' },
      { game: 'zip', value: 5, display: '0:05' },
      { game: 'pinpoint', value: 2, display: '2/5' },
    ]);
  });
});

describe('awkward shapes in the real text', () => {
  test("Mini Sudoku's blurb line does not break the header parse", () => {
    expect(parseAll(SAMPLES.minisudoku)[0]?.value).toBe(54);
  });

  test("Pinpoint's per-guess lines are not mistaken for the score", () => {
    // "12% match" and "100% match" both contain numbers on their own lines.
    expect(parseAll(SAMPLES.pinpoint)[0]?.value).toBe(2);
  });

  test('a time over a minute parses as seconds', () => {
    expect(parseAll(SAMPLES.crossclimb)[0]?.value).toBe(162);
  });

  test('the trailing lnkd.in line never becomes the score', () => {
    expect(parseAll(SAMPLES.patches)[0]?.value).toBe(7);
  });
});

describe('a whole day pasted at once', () => {
  const wholeDay = Object.values(SAMPLES).join('\n\n');

  test('every game is picked up from one message', () => {
    expect(parseAll(wholeDay).map((m) => m.game).sort()).toEqual([
      'crossclimb',
      'fermi',
      'geozee',
      'lemot',
      'minisudoku',
      'patches',
      'pinpoint',
      'queens',
      'tango',
      'wend',
      'wordle',
      'zip',
    ]);
  });

  test('each game keeps its own score', () => {
    const byGame = new Map(parseAll(wholeDay).map((m) => [m.game, m.value]));
    expect(byGame.get('queens')).toBe(11);
    expect(byGame.get('crossclimb')).toBe(162);
    expect(byGame.get('pinpoint')).toBe(2);
    expect(byGame.get('fermi')).toBe(1.72);
  });

  test('games are independent: dropping one leaves the rest intact', () => {
    const withoutZip = Object.entries(SAMPLES)
      .filter(([k]) => k !== 'zip')
      .map(([, v]) => v)
      .join('\n\n');
    expect(parseAll(withoutZip).map((m) => m.game)).not.toContain('zip');
    expect(parseAll(withoutZip)).toHaveLength(11);
  });
});
