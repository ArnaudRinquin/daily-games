import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { AppEnv } from '../env';
import { registerGroups } from './groups';
import { registerIngest } from './ingest';
import { registerOnboarding } from './onboarding';
import type { AppBot, AppContext } from './types';

export type { AppBot, AppContext } from './types';

/**
 * Supplying botInfo skips grammY's `getMe` call. That call would otherwise run
 * on every single webhook update: one wasted subrequest against the free tier's
 * 50, and one more way for an update to fail and be retried.
 *
 * The bot's numeric id is the part of the token before the colon.
 */
function botInfo(env: AppEnv): UserFromGetMe {
  return {
    id: Number(env.BOT_TOKEN.split(':')[0]),
    is_bot: true,
    first_name: env.BOT_USERNAME,
    username: env.BOT_USERNAME,
    can_join_groups: true,
    // Privacy mode stays ON: the only group input is a command addressed to us.
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    supports_join_request_queries: false,
    can_connect_to_business: false,
    can_manage_bots: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
  };
}

export function createBot(env: AppEnv): AppBot {
  const bot: AppBot = new Bot<AppContext>(env.BOT_TOKEN, { botInfo: botInfo(env) });

  bot.use(async (ctx, next) => {
    ctx.env = env;
    await next();
  });

  registerGroups(bot);
  registerOnboarding(bot);
  registerIngest(bot);

  // No bot.catch: it is ignored in webhook mode. The Worker's webhook route
  // catches instead.

  return bot;
}
