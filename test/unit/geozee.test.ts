import { describe, expect, test } from 'vitest';
import { parseAll } from '../../src/games/registry';
import { geozee } from '../../src/games/geozee';

// Verbatim, as pasted by a player.
const SAMPLE = `Geozee #58 — 257/742 · top 97% 🌍
🇸🇨🇵🇼🇮🇩🇸🇳🇫🇲🇧🇹🇹🇻🇸🇽🇬🇧

🟨🟩🟥
🟥🟥🟥
🟥🟩🟥

https://geozee.earth?ref=share`;

describe('geozee', () => {
  test('parses the real share text', () => {
    expect(parseAll(SAMPLE)).toEqual([{ game: 'geozee', value: -257, display: '257/742' }]);
  });

  test('points are higher-is-better, so the value is negated', () => {
    const good = geozee.parse('Geozee #58 — 700/742 🌍')!;
    const bad = geozee.parse('Geozee #58 — 257/742 🌍')!;
    expect(good.value).toBeLessThan(bad.value);
  });

  test('the percentile is optional: the site omits it when unranked', () => {
    expect(geozee.parse('Geozee #58 — 257/742 🌍')).toEqual({
      value: -257,
      display: '257/742',
    });
  });

  test('a zero score stores as 0, never -0', () => {
    const parsed = geozee.parse('Geozee #58 — 0/742 · top 100% 🌍')!;
    expect(parsed.value).toBe(0);
    expect(Object.is(parsed.value, -0)).toBe(false);
  });

  test('the daily maximum moves with the puzzle and is kept for display', () => {
    expect(geozee.parse('Geozee #59 — 300/610 🌍')?.display).toBe('300/610');
  });

  test('a score above the maximum is not a result', () => {
    expect(geozee.parse('Geozee #58 — 900/742 🌍')).toBeNull();
  });

  test('the percentile is never mistaken for the score', () => {
    expect(geozee.parse(SAMPLE)?.value).toBe(-257);
  });

  test('a hyphen instead of the em dash still parses', () => {
    expect(geozee.parse('Geozee #58 - 257/742 🌍')?.value).toBe(-257);
  });

  test('detect fires but parse gives up on a malformed score', () => {
    expect(geozee.detect('Geozee #58 — best yet 🌍')).toBe(true);
    expect(geozee.parse('Geozee #58 — best yet 🌍')).toBeNull();
  });
});
