import { gameById, visibleGameIds } from '../games/registry';
import type { MemberInfo, ScoreRow } from '../db/types';
import { aggregate, byAverage, rankDay, type DailyBoard, type PlayerRef, type Standing } from './ranking';
import { daysBetween } from './time';

export const TELEGRAM_MAX_MESSAGE = 4096;

/**
 * The early trigger. `every` on an empty array is true, so the emptiness checks
 * are load-bearing: without them a group with no active members would satisfy
 * completion at the first tick after rollover and burn the day's digest on an
 * empty board.
 */
export function isComplete(members: readonly MemberInfo[], scores: readonly ScoreRow[]): boolean {
  const active = members.filter((m) => m.active);
  if (active.length === 0) return false;
  const submitted = new Set(scores.map((s) => s.user_id));
  if (submitted.size === 0) return false;
  return active.every((m) => submitted.has(m.userId));
}

/** One board per game that at least one member actually played. */
export function buildBoards(params: {
  members: readonly MemberInfo[];
  scores: readonly ScoreRow[];
  playDate: string;
}): DailyBoard[] {
  const memberIds = new Set(params.members.map((m) => m.userId));
  const relevant = params.scores.filter((s) => memberIds.has(s.user_id));
  const boards: DailyBoard[] = [];

  for (const game of visibleGameIds()) {
    const scores = relevant.filter((s) => s.game === game);
    // A game nobody played would render as a list of absent names and nothing
    // else. Not worth a line in the digest.
    if (scores.length === 0) continue;

    const field: PlayerRef[] = params.members
      .filter((m) => m.games.includes(game))
      .map((m) => ({ userId: m.userId, name: m.name }));

    boards.push(
      rankDay({
        game,
        playDate: params.playDate,
        field,
        scores: scores.map((s) => ({ userId: s.user_id, value: s.value, display: s.display })),
      }),
    );
  }
  return boards;
}

/** Days each member could have played, for the average-table participation floor. */
export function eligibleDays(
  members: readonly MemberInfo[],
  from: string,
  to: string,
): Map<number, number> {
  const periodDays = daysBetween(from, to) + 1;
  return new Map(
    members.map((m) => {
      const joined = new Date(m.joinedAt * 1000).toISOString().slice(0, 10);
      const sinceJoin = daysBetween(joined, to) + 1;
      return [m.userId, Math.max(0, Math.min(periodDays, sinceJoin))];
    }),
  );
}

function prettyDate(playDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${playDate}T12:00:00Z`));
}

const MEDALS = ['🥇', '🥈', '🥉'];
const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;
const place = (rank: number) => MEDALS[rank - 1] ?? `${rank}.`;

function boardSection(board: DailyBoard): string {
  const game = gameById(board.game);
  const heading = game ? `${game.emoji} ${game.label}` : board.game;
  const lines = board.rows.map(
    (r) => `${place(r.rank)} ${r.name} — ${r.display} (+${r.points})`,
  );
  if (board.absent.length > 0) {
    lines.push(`   absent: ${board.absent.map((p) => p.name).join(', ')}`);
  }
  return `${heading}\n${lines.join('\n')}`;
}

function standingsSection(title: string, rows: readonly Standing[], limit = 5): string {
  if (rows.length === 0) return '';
  const lines = rows
    .slice(0, limit)
    .map((s, i) => `${place(i + 1)} ${s.name} — ${s.totalPoints} pts (${games(s.gamesPlayed)})`);
  return `${title}\n${lines.join('\n')}`;
}

function averageSection(title: string, rows: readonly Standing[], limit = 5): string {
  if (rows.length === 0) return '';
  const lines = rows
    .slice(0, limit)
    .map(
      (s, i) =>
        `${place(i + 1)} ${s.name} — ${(s.averagePoints ?? 0).toFixed(1)}/game (${games(s.gamesPlayed)})`,
    );
  return `${title}\n${lines.join('\n')}`;
}

export function formatDigest(params: {
  title: string;
  playDate: string;
  boards: readonly DailyBoard[];
  members: readonly MemberInfo[];
  periodBoards: readonly DailyBoard[];
  periodLabel: string;
  eligible: ReadonlyMap<number, number>;
}): string {
  const header = `🏆 ${params.title} — ${prettyDate(params.playDate)}`;

  if (params.boards.length === 0) {
    return `${header}\n\nNobody played today. 🦗`;
  }

  const refs: PlayerRef[] = params.members.map((m) => ({ userId: m.userId, name: m.name }));
  const today = aggregate({
    boards: params.boards,
    members: refs,
    eligibleDays: new Map(refs.map((r) => [r.userId, 1])),
  }).filter((s) => s.gamesPlayed > 0);

  const period = aggregate({
    boards: params.periodBoards,
    members: refs,
    eligibleDays: params.eligible,
  });

  const sections = [
    header,
    ...params.boards.map(boardSection),
    standingsSection('📊 Today', today),
    standingsSection(`📈 ${params.periodLabel} — total`, period.filter((s) => s.gamesPlayed > 0)),
    averageSection(`🎯 ${params.periodLabel} — average`, byAverage(period)),
  ].filter((s) => s.length > 0);

  const text = sections.join('\n\n');
  return text.length <= TELEGRAM_MAX_MESSAGE
    ? text
    : `${text.slice(0, TELEGRAM_MAX_MESSAGE - 24).trimEnd()}\n\n… (see the full board)`;
}
