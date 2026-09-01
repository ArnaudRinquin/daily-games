import { Api, webhookCallback } from 'grammy';
import { Hono } from 'hono';
import { api } from './api/leaderboard';
import { createBot } from './bot';
import { postDigests } from './cron/digest';
import { sendReminders } from './cron/reminders';
import type { AppEnv } from './env';

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
async function runCron(env: AppEnv, now: Date) {
  // A bare Api needs no getMe call, unlike a Bot that has to init.
  const api = new Api(env.BOT_TOKEN);
  const [sent, posted] = await Promise.all([
    sendReminders(env, api, now),
    postDigests(env, api, now),
  ]);
  console.log('cron', { sent, posted, at: now.toISOString() });
  return { sent, posted };
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
    return c.json(await runCron(c.env, new Date()));
  } catch (error) {
    console.error('cron failed', { error: String(error) });
    return c.json({ error: String(error) }, 500);
  }
});

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: AppEnv, _ctx: ExecutionContext) {
    await runCron(env, new Date());
  },
} satisfies ExportedHandler<AppEnv>;
