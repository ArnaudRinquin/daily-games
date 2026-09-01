import type { Bot, Context } from 'grammy';
import type { AppEnv } from '../env';

export interface AppContext extends Context {
  env: AppEnv;
}

export type AppBot = Bot<AppContext>;
