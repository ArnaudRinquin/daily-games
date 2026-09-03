import { webhookCallback } from 'grammy';
import { Hono } from 'hono';
import { admin, runCron } from './api/admin';
import { ingest } from './api/ingest';
import { api } from './api/leaderboard';
import { createBot } from './bot';
import type { AppEnv } from './env';

const app = new Hono<{ Bindings: AppEnv }>();

app.get('/health', (c) => c.json({ ok: true }));

// Before `api`: its initData middleware covers /api/*, and the token IS the
// auth here.
app.route('/', ingest);
app.route('/', api);
app.route('/', admin);

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

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: AppEnv, _ctx: ExecutionContext) {
    await runCron(env, new Date(), 'schedule');
  },
} satisfies ExportedHandler<AppEnv>;
