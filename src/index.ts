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
  // Checked before anything else is constructed: an unauthenticated request
  // must not be able to make us do work.
  if (c.req.header('X-Telegram-Bot-Api-Secret-Token') !== c.env.WEBHOOK_SECRET) {
    return c.text('unauthorized', 401);
  }
  const bot = createBot(c.env);
  return webhookCallback(bot, 'hono', { secretToken: c.env.WEBHOOK_SECRET })(c);
});

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: AppEnv, _ctx: ExecutionContext) {
    const now = new Date();
    // A bare Api needs no getMe call, unlike a Bot that has to init.
    const api = new Api(env.BOT_TOKEN);
    const [sent, posted] = await Promise.all([
      sendReminders(env, api, now),
      postDigests(env, api, now),
    ]);
    if (sent > 0 || posted > 0) console.log('cron', { sent, posted });
  },
} satisfies ExportedHandler<AppEnv>;
