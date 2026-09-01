import { Hono } from 'hono';
import type { AppEnv } from './env';

const app = new Hono<{ Bindings: AppEnv }>();

app.get('/health', (c) => c.json({ ok: true }));

app.post('/telegram/webhook', async (c) => {
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (!secret || secret !== c.env.WEBHOOK_SECRET) return c.text('forbidden', 403);
  return c.text('ok'); // Phase 1 wires grammY here
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, _env: AppEnv, _ctx: ExecutionContext) {
    // Phase 4: reminders + digest
  },
} satisfies ExportedHandler<AppEnv>;
