import { fermi } from './fermi';
import { lemot } from './lemot';
import { linkedinGames } from './linkedin';
import { tableDesSavoirsGames } from './tabledessavoirs';
import type { GameParser, Match } from './types';
import { waffle } from './waffle';
import { wordle } from './wordle';

export type { GameParser, Match, ParsedScore } from './types';

/** Catalog order is the order players see in the keyboard and the digest. */
export const GAMES: readonly GameParser[] = [...linkedinGames, wordle, lemot, waffle, fermi, ...tableDesSavoirsGames];

const byId = new Map(GAMES.map((g) => [g.id, g]));

/** Games whose parser actually works. The only set ever offered to a player. */
export function visibleGames(): GameParser[] {
  return GAMES.filter((g) => !g.hidden);
}

export function visibleGameIds(): string[] {
  return visibleGames().map((g) => g.id);
}

export function gameById(id: string): GameParser | undefined {
  return byId.get(id);
}

export function isVisible(id: string): boolean {
  const g = byId.get(id);
  return g !== undefined && !g.hidden;
}

/**
 * One pasted message can hold several games' results, so parsing returns an
 * array. Hidden games never match. A game whose `detect` fires but whose
 * `parse` returns null is deliberately dropped, leaving the message in the
 * unmatched corpus for calibration.
 */
export function parseAll(text: string): Match[] {
  const out: Match[] = [];
  for (const game of GAMES) {
    if (game.hidden) continue;
    if (!game.detect(text)) continue;
    const score = game.parse(text);
    if (score === null) continue;
    out.push({ game: game.id, ...score });
  }
  return out;
}
