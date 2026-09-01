import { webhookCallback } from 'grammy';
import { Hono } from 'hono';
import { createBot } from './bot';
import type { AppEnv } from './env';

const app = new Hono<{ Bindings: AppEnv }>();

app.get('/health', (c) => c.json({ ok: true }));

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
  async scheduled(_event: ScheduledController, _env: AppEnv, _ctx: ExecutionContext) {
    // Phase 4: reminders + digest
  },
} satisfies ExportedHandler<AppEnv>;
