import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';
import { verifyInitDataDetailed, type TelegramUser } from '../lib/initdata';

export interface ApiVariables {
  viewer: TelegramUser;
}

export type ApiContext = Context<{ Bindings: AppEnv; Variables: ApiVariables }>;

/**
 * Mini Apps authenticate with the signed `initData` string, sent as
 * `Authorization: tma <initData>` — Telegram's own convention.
 */
export async function requireViewer(c: ApiContext, next: Next): Promise<Response | void> {
  const header = c.req.header('Authorization') ?? '';
  const initData = header.startsWith('tma ') ? header.slice(4) : '';

  const result = await verifyInitDataDetailed(initData, c.env.BOT_TOKEN);
  if (!result.ok) {
    // Logged, never returned: the client learns only that it failed.
    console.error('initData rejected', {
      reason: result.reason,
      keys: result.keys ?? [],
      length: initData.length,
    });
    return c.json({ error: 'unauthorized' }, 401);
  }

  c.set('viewer', result.data.user);
  await next();
}
