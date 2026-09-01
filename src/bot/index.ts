import { Bot } from 'grammy';
import type { AppEnv } from '../env';
import { registerGroups } from './groups';
import { registerIngest } from './ingest';
import { registerOnboarding } from './onboarding';
import type { AppBot, AppContext } from './types';

export type { AppBot, AppContext } from './types';

export function createBot(env: AppEnv): AppBot {
  const bot: AppBot = new Bot<AppContext>(env.BOT_TOKEN);

  bot.use(async (ctx, next) => {
    ctx.env = env;
    await next();
  });

  registerGroups(bot);
  registerOnboarding(bot);
  registerIngest(bot);

  bot.catch((err) => {
    console.error('bot error', { update: err.ctx.update.update_id, error: String(err.error) });
  });

  return bot;
}
