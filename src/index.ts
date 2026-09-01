import { Api, webhookCallback } from 'grammy';
import { Hono } from 'hono';
import { api } from './api/leaderboard';
import { createBot } from './bot';
import { postDigests } from './cron/digest';
import { sendReminders } from './cron/reminders';
import type { AppEnv } from './env';
import { isVisible, parseAll } from './games/registry';
import { offerGameToEveryone, replayUnmatched } from './lib/db';
import { playDate } from './lib/time';

const app = new Hono<{ Bindings: AppEnv }>();

app.get('/health', (c) => c.json({ ok: true }));

app.route('/', api);

app.post('/telegram/webhook', async (c) => {
  // Fail closed. A plain `provided !== expected` compares undefined to
  // undefined when the secret is unset, which is false — so an unconfigured
  // Worker would accept every unauthenticated request. Both sides must be
  // present and non-empty before anything else is constructed.
  const expected = c.env.WEBHOOK_SECRET;
  const provided = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (!expected || !provided || provided !== expected) {
    return c.text('unauthorized', 401);
  }
  const bot = createBot(c.env);
  try {
    return await webhookCallback(bot, 'hono', { secretToken: expected })(c);
  } catch (error) {
    // grammY does NOT route errors through bot.catch in webhook mode — they
    // propagate here. Answer 200 anyway: every DB write commits before the
    // reply is attempted, so the data is already safe, and ingestion is
    // idempotent. A non-2xx would only make Telegram redeliver an update that
    // has nothing left to do.
    console.error('webhook handler failed', { error: String(error) });
    return c.text('ok');
  }
});

/** The work one cron tick does. Shared with the admin trigger below. */
async function runCron(env: AppEnv, now: Date, source: 'schedule' | 'manual') {
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

/**
 * Runs a tick on demand, behind the same secret as the webhook. Cron fires
 * every 15 minutes, which is a painfully slow loop when something is wrong.
 */
app.post('/admin/run-cron', async (c) => {
  const expected = c.env.WEBHOOK_SECRET;
  const provided = c.req.header('X-Admin-Secret');
  if (!expected || !provided || provided !== expected) {
    return c.text('unauthorized', 401);
  }
  try {
    return c.json(await runCron(c.env, new Date(), 'manual'));
  } catch (error) {
    console.error('cron failed', { error: String(error) });
    return c.json({ error: String(error) }, 500);
  }
});

/** Re-scores messages that a since-fixed parser can now read. */
app.post('/admin/replay', async (c) => {
  const expected = c.env.WEBHOOK_SECRET;
  const provided = c.req.header('X-Admin-Secret');
  if (!expected || !provided || provided !== expected) {
    return c.text('unauthorized', 401);
  }
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
app.post('/admin/offer-game', async (c) => {
  const expected = c.env.WEBHOOK_SECRET;
  const provided = c.req.header('X-Admin-Secret');
  if (!expected || !provided || provided !== expected) {
    return c.text('unauthorized', 401);
  }
  const game = c.req.query('game') ?? '';
  if (!isVisible(game)) return c.json({ error: 'unknown or hidden game' }, 400);

  const result = await offerGameToEveryone(c.env.DB, game);
  console.log('offer-game', { game, ...result });
  return c.json({ game, ...result });
});

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: AppEnv, _ctx: ExecutionContext) {
    await runCron(env, new Date(), 'schedule');
  },
} satisfies ExportedHandler<AppEnv>;
