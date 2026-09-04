import type { GameParser, ParsedScore } from './types';
import { toInt } from './util';

/**
 * Geozee — place countries into nine daily scoring categories. Real share text:
 *
 *   Geozee #58 — 257/742 · top 97% 🌍
 *   🇸🇨🇵🇼🇮🇩🇸🇳🇫🇲🇧🇹🇹🇻🇸🇽🇬🇧
 *
 *   🟨🟩🟥
 *   🟥🟥🟥
 *   🟥🟩🟥
 *
 *   https://geozee.earth?ref=share
 *
 * Built by the site's own share function as
 * `Geozee #${n} — ${score}/${max}${percentile} 🌍`, where the percentile part
 * is ` · top ${z}%` and is OMITTED when the site has no ranking yet — so the
 * score must parse without it.
 *
 * Points are HIGHER-is-better, hence negated to match the lower-is-better
 * contract. The denominator is the maximum attainable THAT DAY and moves with
 * the puzzle, so it is kept for display only: comparing raw points is safe
 * because a board only ever ranks one game on one day.
 */
export const geozee: GameParser = {
  id: 'geozee',
  label: 'Geozee',
  url: 'https://geozee.earth/',
  emoji: '🌍',
  detect: (text) => /^[^\S\n]*Geozee\s+#\d+/im.test(text),
  parse(text): ParsedScore | null {
    // The dash is an em dash in the real share; hyphen and en dash are
    // accepted too, since clients and keyboards rewrite it.
    const m = /^[^\S\n]*Geozee\s+#\d+\s*[—–-]\s*([\d,.\s]+?)\s*\/\s*([\d,.\s]+?)\s*(?:·|🌍|$)/imu.exec(
      text,
    );
    if (!m?.[1] || !m[2]) return null;

    const score = toInt(m[1]);
    const max = toInt(m[2]);
    if (score === null || max === null || max === 0 || score > max) return null;

    // `-0` is not `0` to Object.is, and negative zero has no business in a
    // score column.
    return { value: score === 0 ? 0 : -score, display: `${score}/${max}` };
  },
};
