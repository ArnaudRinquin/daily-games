/**
 * Raw values are never comparable across games, so they never enter a
 * leaderboard. Each parser normalises to "lower is better"; ranking turns that
 * into points.
 *
 * Field size is the number of group members who SELECTED that game, played or
 * not. Fixing the field means a low-turnout day is worth exactly as much as a
 * busy one — which is what "total points rewards turning up" has to mean.
 * Absent players get no row and no points; they are listed, not penalised.
 */

export interface PlayerRef {
  userId: number;
  name: string;
}

export interface ScoreEntry {
  userId: number;
  value: number;
  display: string;
}

export interface BoardRow extends PlayerRef {
  rank: number;
  points: number;
  value: number;
  display: string;
}

export interface DailyBoard {
  game: string;
  playDate: string;
  /** Members who selected this game — the denominator for points. */
  field: number;
  rows: BoardRow[];
  absent: PlayerRef[];
}

/** Share of eligible days a player must appear on to enter the average table. */
export const PARTICIPATION_FLOOR = 0.6;

/**
 * Standard competition ranking: ties share the better rank and the same points,
 * and the ranks after a tie skip. Field 5 with a two-way tie for first gives
 * 5, 5, 3, 2, 1.
 */
export function rankDay(params: {
  game: string;
  playDate: string;
  /** Members who selected this game. */
  field: readonly PlayerRef[];
  scores: readonly ScoreEntry[];
}): DailyBoard {
  const byId = new Map(params.field.map((p) => [p.userId, p]));

  // A score from someone who has since deselected the game still counts, so the
  // field can never be smaller than the number of players actually in it.
  const fieldSize = Math.max(params.field.length, params.scores.length);

  const sorted = [...params.scores].sort((a, b) => a.value - b.value || a.userId - b.userId);

  const rows: BoardRow[] = [];
  let rank = 0;
  let previousValue: number | null = null;

  sorted.forEach((score, index) => {
    if (previousValue === null || score.value !== previousValue) {
      rank = index + 1;
      previousValue = score.value;
    }
    rows.push({
      userId: score.userId,
      name: byId.get(score.userId)?.name ?? `#${score.userId}`,
      rank,
      points: Math.max(1, fieldSize - rank + 1),
      value: score.value,
      display: score.display,
    });
  });

  const playedIds = new Set(params.scores.map((s) => s.userId));
  return {
    game: params.game,
    playDate: params.playDate,
    field: fieldSize,
    rows,
    absent: params.field.filter((p) => !playedIds.has(p.userId)),
  };
}

export interface Standing extends PlayerRef {
  totalPoints: number;
  gamesPlayed: number;
  daysPlayed: number;
  /** Points per game played. Null when they played nothing. */
  averagePoints: number | null;
  /** False when they are below the participation floor. */
  rankedOnAverage: boolean;
}

/**
 * Two aggregates, because they reward different things: total rewards turning
 * up, average rewards being good. The average needs a participation floor or
 * one lucky first place is unbeatable.
 */
export function aggregate(params: {
  boards: readonly DailyBoard[];
  members: readonly PlayerRef[];
  /** Days in the period each player could have played — days since they joined. */
  eligibleDays: ReadonlyMap<number, number>;
}): Standing[] {
  const totals = new Map<number, { points: number; games: number; days: Set<string> }>();
  for (const member of params.members) {
    totals.set(member.userId, { points: 0, games: 0, days: new Set() });
  }

  for (const board of params.boards) {
    for (const row of board.rows) {
      const entry = totals.get(row.userId);
      if (!entry) continue; // not a member of this group
      entry.points += row.points;
      entry.games += 1;
      entry.days.add(board.playDate);
    }
  }

  const standings = params.members.map((member): Standing => {
    const entry = totals.get(member.userId)!;
    const eligible = params.eligibleDays.get(member.userId) ?? 0;
    const required = Math.ceil(eligible * PARTICIPATION_FLOOR);
    return {
      ...member,
      totalPoints: entry.points,
      gamesPlayed: entry.games,
      daysPlayed: entry.days.size,
      averagePoints: entry.games > 0 ? entry.points / entry.games : null,
      rankedOnAverage: entry.games > 0 && entry.days.size >= required,
    };
  });

  return standings.sort(
    (a, b) =>
      b.totalPoints - a.totalPoints ||
      (b.averagePoints ?? 0) - (a.averagePoints ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

/** Standings ordered by average, with everyone below the floor removed. */
export function byAverage(standings: readonly Standing[]): Standing[] {
  return standings
    .filter((s) => s.rankedOnAverage)
    .sort(
      (a, b) =>
        (b.averagePoints ?? 0) - (a.averagePoints ?? 0) ||
        b.gamesPlayed - a.gamesPlayed ||
        a.name.localeCompare(b.name),
    );
}
