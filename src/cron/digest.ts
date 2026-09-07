import type { Api } from 'grammy';
import type { AppEnv } from '../env';
import { getActiveGroups, getAllGroupMembers } from '../db/groups';
import { claimDigest, releaseDigest } from '../db/schedule';
import { getScoresBetween, getScoresForDate } from '../db/scores';
import type { MemberInfo, ScoreRow } from '../db/types';
import { buildBoards, eligibleDays, formatDigest, isComplete } from '../lib/digest';
import type { DailyBoard } from '../lib/ranking';
import { miniAppButton } from '../lib/miniapp';
import { addDays, parisHour, playDate } from '../lib/time';

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

/**
 * Renders the board for one group on one day. Shared by the nightly digest and
 * the on-demand /board command, so the two can never drift apart.
 */
export async function renderDigest(
  env: AppEnv,
  group: { chat_id: number; title: string },
  members: readonly MemberInfo[],
  date: string,
): Promise<string> {
  const monthStart = `${date.slice(0, 7)}-01`;
  const memberIds = new Set(members.map((m) => m.userId));

  const [todayScores, periodScores] = await Promise.all([
    getScoresForDate(env.DB, date),
    getScoresBetween(env.DB, monthStart, date),
  ]);

  return formatDigest({
    title: group.title,
    playDate: date,
    boards: buildBoards({
      members,
      scores: todayScores.filter((s) => memberIds.has(s.user_id)),
      playDate: date,
    }),
    members,
    periodBoards: buildPeriodBoards(members, periodScores.filter((s) => memberIds.has(s.user_id))),
    periodLabel: 'This month',
    eligible: eligibleDays(members, monthStart, date),
  });
}

export async function postDigests(env: AppEnv, api: Api, now: Date): Promise<number> {
  const today = playDate(now);
  const yesterday = addDays(today, -1);
  const hour = parisHour(now);
  // >= not ==, so a dropped tick at 21:00 does not cost the day's digest.
  const pastCutoff = hour >= Number(env.CUTOFF_HOUR);

  const [groups, membersByChat, recentScores] = await Promise.all([
    getActiveGroups(env.DB),
    getAllGroupMembers(env.DB),
    getScoresBetween(env.DB, yesterday, today),
  ]);
  if (groups.length === 0) return 0;

  let posted = 0;

  for (const group of groups) {
    const members = membersByChat.get(group.chat_id) ?? [];
    const memberIds = new Set(members.map((m) => m.userId));

    // Yesterday first, so a catch-up and today's post arrive in order.
    for (const date of [yesterday, today]) {
      if (posted >= MAX_DIGESTS_PER_TICK) break;

      const dayScores = recentScores.filter(
        (s) => s.play_date === date && memberIds.has(s.user_id),
      );

      if (date === yesterday) {
        // Catch-up. The play date rolls over at 04:00, so if no tick landed
        // between the cutoff and the rollover, yesterday's digest would
        // otherwise never post at all — the failure mode of a sparse
        // scheduler. Only worth posting if somebody actually played.
        if (dayScores.length === 0) continue;
      } else if (!pastCutoff && !isComplete(members, dayScores)) {
        continue;
      }

      // Claim before rendering: completion and cutoff can both fire for a day.
      if (!(await claimDigest(env.DB, group.chat_id, date))) continue;

      try {
        const text = await renderDigest(env, group, members, date);
        const button = miniAppButton(env.BOT_USERNAME, env.MINIAPP_SHORT_NAME);
        await api.sendMessage(group.chat_id, text, {
          link_preview_options: { is_disabled: true },
          ...(button ? { reply_markup: button } : {}),
        });
        posted++;
      } catch (error) {
        // Release the claim so the next tick retries.
        await releaseDigest(env.DB, group.chat_id, date);
        console.error('digest failed', { chatId: group.chat_id, date, error: String(error) });
      }
    }
  }
  return posted;
}

/**
 * Posts the digest for any of this player's groups that just became complete.
 *
 * Called straight after a score is stored, so the common case — everyone has
 * played, the board goes up — never waits for a scheduler at all. That matters
 * because two schedulers have now proved unreliable here; the cron is reduced
 * to covering the 21:00 cutoff, when somebody has NOT played.
 *
 * Same claim table as the cron, so the two cannot double-post.
 */
export async function postCompletedDigests(
  env: AppEnv,
  api: Api,
  userId: number | readonly number[],
  date: string,
): Promise<number> {
  // The LinkedIn import lands scores for many players at once; one pass over
  // the groups covers them all, within the free tier's query budget.
  const userIds = new Set(typeof userId === 'number' ? [userId] : userId);
  const [membersByChat, groups, dayScores] = await Promise.all([
    getAllGroupMembers(env.DB),
    getActiveGroups(env.DB),
    getScoresForDate(env.DB, date),
  ]);

  let posted = 0;
  for (const group of groups) {
    const members = membersByChat.get(group.chat_id) ?? [];
    // Only the groups these players are actually in can have changed.
    if (!members.some((m) => userIds.has(m.userId))) continue;

    const memberIds = new Set(members.map((m) => m.userId));
    const groupScores = dayScores.filter((s) => memberIds.has(s.user_id));
    if (!isComplete(members, groupScores)) continue;

    if (!(await claimDigest(env.DB, group.chat_id, date))) continue;
    try {
      const text = await renderDigest(env, group, members, date);
      const button = miniAppButton(env.BOT_USERNAME, env.MINIAPP_SHORT_NAME);
      await api.sendMessage(group.chat_id, text, {
        link_preview_options: { is_disabled: true },
        ...(button ? { reply_markup: button } : {}),
      });
      posted++;
    } catch (error) {
      await releaseDigest(env.DB, group.chat_id, date);
      console.error('completion digest failed', { chatId: group.chat_id, error: String(error) });
    }
  }
  return posted;
}
