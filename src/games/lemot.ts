import type { GameParser, ParsedScore } from './types';

/**
 * Le Mot — the French Wordle at wordle.louan.me. Share text, taken from the
 * site's own share function:
 *
 *   Le Mot (@WordleFR) #1234 4/6
 *
 *   ⬛🟨⬛⬛⬛
 *   🟩🟩🟩🟩🟩
 *
 * A fail prints `💀/6`, stored as 7 so it sorts below every success while
 * still earning a rank — same rule as Wordle.
 *
 * Archive replays print `archive #12 [03/09/2026]` instead of `#1234`. They
 * are not today's word, so they are left unparsed and land in the corpus.
 */
export const LEMOT_FAIL_VALUE = 7;

export const lemot: GameParser = {
  id: 'lemot',
  label: 'Le Mot',
  url: 'https://wordle.louan.me/',
  emoji: '🇫🇷',
  detect: (text) => /^[^\S\n]*Le Mot \(@WordleFR\)/im.test(text),
  parse(text): ParsedScore | null {
    const m = /^[^\S\n]*Le Mot \(@WordleFR\)\s+#\d+\s+(\d|💀)\/(\d)\b/imu.exec(text);
    if (!m?.[1] || !m[2]) return null;
    const max = Number(m[2]);
    if (m[1] === '💀') return { value: max + 1, display: `X/${max}` };
    const tries = Number(m[1]);
    if (tries < 1 || tries > max) return null;
    return { value: tries, display: `${tries}/${max}` };
  },
};
