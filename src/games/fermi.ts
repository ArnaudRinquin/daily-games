import type { GameParser } from './types';

/**
 * Fermi's share format was never confirmed. It ships hidden: not offerable, not
 * linked in reminders, not counted in any ranking field. Once a real sample
 * lands in `messages`, implement detect/parse, drop `hidden`, and replay the
 * stored `scores.raw` to recover history.
 */
export const fermi: GameParser = {
  id: 'fermi',
  label: 'Fermi',
  url: 'https://fermi.tools/',
  emoji: '🧮',
  hidden: true,
  detect: () => false,
  parse: () => null,
};
