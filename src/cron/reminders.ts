import type { Api } from 'grammy';
import { gameById } from '../games/registry';
import { claimReminder, getPlayersDue, releaseReminder } from '../db/schedule';
import type { AppEnv } from '../env';
import { parisHour, playDate } from '../lib/time';

/**
 * Each sendMessage is a subrequest and the free tier allows 50 per invocation,
 * shared with the digest. The hour gate still matches on the next tick 15
 * minutes later, so anything skipped here goes out then.
 */
export const MAX_REMINDERS_PER_TICK = 15;

function reminderText(firstName: string, games: readonly string[]): string {
  const links = games
    .map((id) => gameById(id))
    .filter((g): g is NonNullable<typeof g> => g !== undefined)
    .map((g) => `${g.emoji} ${g.label} — ${g.url}`);

  if (links.length === 0) {
    return `Morning ${firstName}! You have no games selected — /games to pick some.`;
  }
  return [
    `Morning ${firstName} 👋 Today's games:`,
    '',
    ...links,
    '',
    'Paste your results back here when you\'re done.',
  ].join('\n');
}

export async function sendReminders(env: AppEnv, api: Api, now: Date): Promise<number> {
  const hour = parisHour(now);
  const date = playDate(now);

  // Past the digest cutoff the day is over; a reminder then is just noise.
  if (hour >= Number(env.CUTOFF_HOUR)) return 0;
  const due = await getPlayersDue(env.DB, hour, date);

  let sent = 0;
  for (const { player, games } of due.slice(0, MAX_REMINDERS_PER_TICK)) {
    // Claim before sending so a redelivered cron cannot double-DM.
    if (!(await claimReminder(env.DB, player.user_id, date))) continue;
    try {
      await api.sendMessage(player.user_id, reminderText(player.first_name, games), {
        link_preview_options: { is_disabled: true },
      });
      sent++;
    } catch (error) {
      // Release the claim so the next tick retries rather than losing the day.
      await releaseReminder(env.DB, player.user_id, date);
      console.error('reminder failed', { userId: player.user_id, error: String(error) });
    }
  }
  return sent;
}
