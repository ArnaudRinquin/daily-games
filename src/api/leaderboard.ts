import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { gameById, visibleGames } from '../games/registry';
import {
  getAllGroupMembers,
  getMemberGroups,
  getScoresBetween,
  type MemberInfo,
  type ScoreRow,
} from '../lib/db';
import { buildBoards, eligibleDays } from '../lib/digest';
import { aggregate, byAverage, type DailyBoard, type PlayerRef } from '../lib/ranking';
import { addDays, playDate } from '../lib/time';
import { requireViewer, type ApiVariables } from './auth';

export const RANGES = ['today', 'week', 'all'] as const;
export type Range = (typeof RANGES)[number];

const EPOCH = '2020-01-01';

export function rangeStart(range: Range, today: string): string {
  switch (range) {
    case 'today':
      return today;
    case 'week':
      return addDays(today, -6);
    case 'all':
      return EPOCH;
  }
}

/** Boards for every (game, date) in the window. */
function boardsForPeriod(members: readonly MemberInfo[], scores: readonly ScoreRow[]): DailyBoard[] {
  const byDate = new Map<string, ScoreRow[]>();
  for (const score of scores) {
    const bucket = byDate.get(score.play_date);
    if (bucket) bucket.push(score);
    else byDate.set(score.play_date, [score]);
  }
  return [...byDate]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .flatMap(([date, dayScores]) => buildBoards({ members, scores: dayScores, playDate: date }));
}

export const api = new Hono<{ Bindings: AppEnv; Variables: ApiVariables }>();

api.use('/api/*', requireViewer);

/** Who the viewer is and which leaderboards they can see. */
api.get('/api/me', async (c) => {
  const viewer = c.get('viewer');
  const groups = await getMemberGroups(c.env.DB, viewer.id);
  return c.json({
    viewer: { id: viewer.id, firstName: viewer.first_name, username: viewer.username ?? null },
    groups: groups.map((g) => ({ chatId: g.chat_id, title: g.title })),
    games: visibleGames().map((g) => ({ id: g.id, label: g.label, emoji: g.emoji, url: g.url })),
  });
});

api.get('/api/leaderboard', async (c) => {
  const viewer = c.get('viewer');
  const chatId = Number(c.req.query('group'));
  const rangeParam = c.req.query('range') ?? 'today';
  if (!Number.isSafeInteger(chatId)) return c.json({ error: 'bad group' }, 400);
  if (!RANGES.includes(rangeParam as Range)) return c.json({ error: 'bad range' }, 400);
  const range = rangeParam as Range;

  const today = playDate(new Date());
  const from = rangeStart(range, today);

  // Membership is the authorisation: no row, no board. getMemberGroups also
  // carries the title, so this doubles as the group lookup.
  const groups = await getMemberGroups(c.env.DB, viewer.id);
  const group = groups.find((g) => g.chat_id === chatId);
  if (!group) return c.json({ error: 'not a member' }, 403);

  const membersByChat = await getAllGroupMembers(c.env.DB);
  const members = membersByChat.get(chatId) ?? [];

  const scores = await getScoresBetween(c.env.DB, from, today);
  const memberIds = new Set(members.map((m) => m.userId));
  const groupScores = scores.filter((s) => memberIds.has(s.user_id));

  const periodBoards = boardsForPeriod(members, groupScores);
  const refs: PlayerRef[] = members.map((m) => ({ userId: m.userId, name: m.name }));
  const standings = aggregate({
    boards: periodBoards,
    members: refs,
    eligibleDays: eligibleDays(members, from === EPOCH ? today : from, today),
  });

  return c.json({
    range,
    playDate: today,
    from,
    viewerId: viewer.id,
    group: { chatId, title: group.title },
    boards: periodBoards.map(serialiseBoard),
    standings,
    average: byAverage(standings),
  });
});

function serialiseBoard(board: DailyBoard) {
  const game = gameById(board.game);
  return {
    game: board.game,
    label: game?.label ?? board.game,
    emoji: game?.emoji ?? '🎮',
    playDate: board.playDate,
    field: board.field,
    rows: board.rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      rank: r.rank,
      points: r.points,
      display: r.display,
    })),
    absent: board.absent,
  };
}
