import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';
import { verifyInitData, type TelegramUser } from '../lib/initdata';

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

  const verified = await verifyInitData(initData, c.env.BOT_TOKEN);
  if (!verified) return c.json({ error: 'unauthorized' }, 401);

  c.set('viewer', verified.user);
  await next();
}
