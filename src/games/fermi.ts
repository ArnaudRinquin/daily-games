import type { GameParser, ParsedScore } from './types';

/**
 * Fermi share text:
 *
 *   Fermi · No. 37
 *   01  1.75×
 *   02  2.20×
 *   03  1.21×
 *   ─────────
 *   1.72× score · top 6%
 *   fermi.gg/s/daily
 *
 * Each line is how far off that estimate was; the total is their mean
 * ((1.75 + 2.20 + 1.21) / 3 = 1.72). A perfect answer is 1.00×, so the metric
 * is already lower-is-better and needs no negation.
 *
 * The parse anchors on the word "score" — the per-question lines carry the same
 * `N.NN×` shape and must not be mistaken for the total.
 */
export const fermi: GameParser = {
  id: 'fermi',
  label: 'Fermi',
  url: 'https://fermi.gg/',
  emoji: '🧮',
  detect: (text) => /^[^\S\n]*Fermi\b/im.test(text),
  parse(text): ParsedScore | null {
    const m = /(\d+(?:[.,]\d+)?)\s*[×x]\s*score\b/i.exec(text);
    if (!m?.[1]) return null;
    const value = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return null;
    return { value, display: `${value.toFixed(2)}×` };
  },
};
