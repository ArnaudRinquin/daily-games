import { gameById, visibleGames } from '../games/registry';
import { getSelectedGames } from '../db/players';
import { getPlayerScores } from '../db/scores';
import { playDate } from '../lib/time';

/** Shared by the DM and group handlers so the two can never drift apart. */

export async function linksText(db: D1Database, userId: number): Promise<string> {
  const selected = new Set(await getSelectedGames(db, userId));
  const line = (g: { emoji: string; label: string; url: string }) =>
    `${g.emoji} ${g.label} — ${g.url}`;

  // Everything in the catalog, the player's own games first: the point is to be
  // able to reach any of them, not only the ones they signed up for.
  const mine = visibleGames().filter((g) => selected.has(g.id));
  const rest = visibleGames().filter((g) => !selected.has(g.id));

  const parts = [mine.length > 0 ? `Your games:\n${mine.map(line).join('\n')}` : ''];
  if (rest.length > 0) parts.push(`Not playing:\n${rest.map(line).join('\n')}`);
  parts.push('/games to change the list.');
  return parts.filter(Boolean).join('\n\n');
}

export async function statusText(
  db: D1Database,
  userId: number,
  name?: string,
): Promise<string> {
  const today = playDate(new Date());
  const [scores, selected] = await Promise.all([
    getPlayerScores(db, userId, today),
    getSelectedGames(db, userId),
  ]);
  if (selected.length === 0) return 'No games selected. /games to pick some.';

  const done = new Map(scores.map((s) => [s.game, s.display]));
  // Deliberately no rank: that is what the daily digest is for.
  const lines = selected.map((id) => {
    const game = gameById(id);
    const label = game ? `${game.emoji} ${game.label}` : id;
    const result = done.get(id);
    return result ? `✅ ${label} — ${result}` : `⬜️ ${label}`;
  });

  const who = name ? `${name} — today (${today})` : `Today (${today})`;
  return `${who}:\n${lines.join('\n')}`;
}
