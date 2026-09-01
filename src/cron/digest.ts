import type { Api } from 'grammy';
import type { AppEnv } from '../env';
import {
  claimDigest,
  getActiveGroups,
  getAllGroupMembers,
  getScoresBetween,
  getScoresForDate,
  releaseDigest,
  type MemberInfo,
  type ScoreRow,
} from '../lib/db';
import { buildBoards, eligibleDays, formatDigest, isComplete } from '../lib/digest';
import type { DailyBoard } from '../lib/ranking';
import { miniAppButton } from '../lib/miniapp';
import { parisHour, playDate } from '../lib/time';

export const MAX_DIGESTS_PER_TICK = 5;

/** Boards for every (game, date) in the period, for the average table. */
function buildPeriodBoards(members: readonly MemberInfo[], scores: readonly ScoreRow[]): DailyBoard[] {
  const byDate = new Map<string, ScoreRow[]>();
  for (const score of scores) {
    const bucket = byDate.get(score.play_date);
    if (bucket) bucket.push(score);
    else byDate.set(score.play_date, [score]);
  }
  return [...byDate].flatMap(([date, dayScores]) =>
    buildBoards({ members, scores: dayScores, playDate: date }),
  );
}

export async function postDigests(env: AppEnv, api: Api, now: Date): Promise<number> {
  const date = playDate(now);
  const hour = parisHour(now);
  // >= not ==, so a dropped tick at 21:00 does not cost the day's digest.
  const pastCutoff = hour >= Number(env.CUTOFF_HOUR);
  const monthStart = `${date.slice(0, 7)}-01`;

  const [groups, membersByChat, todayScores] = await Promise.all([
    getActiveGroups(env.DB),
    getAllGroupMembers(env.DB),
    getScoresForDate(env.DB, date),
  ]);
  if (groups.length === 0) return 0;

  let periodScores: ScoreRow[] | null = null;
  let posted = 0;

  for (const group of groups) {
    if (posted >= MAX_DIGESTS_PER_TICK) break;

    const members = membersByChat.get(group.chat_id) ?? [];
    const memberIds = new Set(members.map((m) => m.userId));
    const groupScores = todayScores.filter((s) => memberIds.has(s.user_id));

    if (!pastCutoff && !isComplete(members, groupScores)) continue;

    // Claim before rendering: completion and cutoff can both fire for this day.
    if (!(await claimDigest(env.DB, group.chat_id, date))) continue;

    try {
      periodScores ??= await getScoresBetween(env.DB, monthStart, date);
      const text = formatDigest({
        title: group.title,
        playDate: date,
        boards: buildBoards({ members, scores: groupScores, playDate: date }),
        members,
        periodBoards: buildPeriodBoards(
          members,
          periodScores.filter((s) => memberIds.has(s.user_id)),
        ),
        periodLabel: 'This month',
        eligible: eligibleDays(members, monthStart, date),
      });
      await api.sendMessage(group.chat_id, text, {
        link_preview_options: { is_disabled: true },
        reply_markup: miniAppButton(env.BOT_USERNAME, env.MINIAPP_SHORT_NAME),
      });
      posted++;
    } catch (error) {
      // Release the claim so the next tick retries.
      await releaseDigest(env.DB, group.chat_id, date);
      console.error('digest failed', { chatId: group.chat_id, error: String(error) });
    }
  }
  return posted;
}
