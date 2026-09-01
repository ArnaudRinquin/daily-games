import { Hono } from 'hono';
import { Api } from 'grammy';
import type { AppEnv } from '../env';
import { postDigests } from '../cron/digest';
import { sendReminders } from '../cron/reminders';
import { isVisible, parseAll } from '../games/registry';
import { replayUnmatched } from '../db/messages';
import { offerGameToEveryone } from '../db/players';
import { playDate } from '../lib/time';

/**
 * Operator endpoints, all behind the same secret as the webhook. They exist
 * because the alternatives are worse: cron fires every 15 minutes, which is a
 * painfully slow loop when something is wrong, and a parser fix is worthless
 * if it cannot be applied to the days it already missed.
 */
export const admin = new Hono<{ Bindings: AppEnv }>();

admin.use('/admin/*', async (c, next) => {
  const expected = c.env.WEBHOOK_SECRET;
  const provided = c.req.header('X-Admin-Secret');
  // Fail closed: comparing two undefineds is false, which would let an
  // unconfigured Worker accept everything.
  if (!expected || !provided || provided !== expected) {
    return c.text('unauthorized', 401);
  }
  await next();
});

/** The work one cron tick does. Also the scheduled handler's entire body. */
export async function runCron(env: AppEnv, now: Date, source: 'schedule' | 'manual') {
  // A bare Api needs no getMe call, unlike a Bot that has to init.
  const api = new Api(env.BOT_TOKEN);
  const [sent, posted] = await Promise.all([
    sendReminders(env, api, now),
    postDigests(env, api, now),
  ]);

  // Leave a trace even when the tick did nothing: otherwise a scheduler that
  // never runs is indistinguishable from one that runs and finds no work.
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO cron_runs (ran_at, source, reminders_sent, digests_posted)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(Math.floor(now.getTime() / 1000), source, sent, posted),
    env.DB.prepare('DELETE FROM cron_runs WHERE ran_at < unixepoch() - 604800'),
  ]);

  console.log('cron', { source, sent, posted, at: now.toISOString() });
  return { sent, posted, source };
}

admin.post('/admin/run-cron', async (c) => {
  try {
    return c.json(await runCron(c.env, new Date(), 'manual'));
  } catch (error) {
    console.error('cron failed', { error: String(error) });
    return c.json({ error: String(error) }, 500);
  }
});

/** Re-scores messages that a since-fixed parser can now read. */
admin.post('/admin/replay', async (c) => {
  const result = await replayUnmatched(c.env.DB, parseAll, (sentAt) =>
    playDate(new Date(sentAt * 1000)),
  );
  console.log('replay', result);
  return c.json(result);
});

/**
 * Adds a newly catalogued game to everyone's selection. Run once after shipping
 * a new parser; without it the game only reaches players who sign up later.
 */
admin.post('/admin/offer-game', async (c) => {
  const game = c.req.query('game') ?? '';
  if (!isVisible(game)) return c.json({ error: 'unknown or hidden game' }, 400);

  const result = await offerGameToEveryone(c.env.DB, game);
  console.log('offer-game', { game, ...result });
  return c.json({ game, ...result });
});
