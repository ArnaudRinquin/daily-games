import { InlineKeyboard } from 'grammy';
import { visibleGames } from '../games/registry';
import {
  ensurePlayer,
  getPlayer,
  getSelectedGames,
  setPlayerActive,
  setReminderHour,
  toggleGame,
} from '../lib/db';
import type { AppBot } from './types';
import { CB, gamesKeyboard, hoursKeyboard } from './keyboards';

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function welcomeText(firstName: string, hour: number, gameCount: number): string {
  return [
    `Hi ${firstName} 👋`,
    '',
    `You're in. All ${gameCount} games are selected and I'll nudge you at ${hh(hour)}.`,
    '',
    'Paste your results here as you play — share text straight from the game is fine,',
    'and several games in one message works too. I never reveal your rank before the',
    'daily digest.',
    '',
    '/games — pick which games you play',
    '/time — change the reminder',
    '/status — what you have submitted today',
    '/pause — stop reminders',
  ].join('\n');
}

export function registerOnboarding(bot: AppBot): void {
  bot.chatType('private').command('start', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const { created, player } = await ensurePlayer(ctx.env.DB, {
      id: from.id,
      username: from.username,
      first_name: from.first_name,
    });

    // A group deep-link payload is handled in bot/groups.ts, which runs first
    // and stops the middleware chain when it consumes the payload.
    if (created) {
      await ctx.reply(welcomeText(player.first_name, player.reminder_hour, visibleGames().length));
    } else {
      await ctx.reply(
        `Welcome back, ${player.first_name}. Reminder is set for ${hh(player.reminder_hour)}.\n\n` +
          'Paste results any time. /games /time /status /pause',
      );
    }
  });

  bot.chatType('private').command('games', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const selected = await getSelectedGames(ctx.env.DB, userId);
    await ctx.reply('Which games do you play?', { reply_markup: gamesKeyboard(selected) });
  });

  bot.chatType('private').command('time', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const player = await getPlayer(ctx.env.DB, userId);
    if (!player) return;
    await ctx.reply('When should I remind you? (Paris time)', {
      reply_markup: hoursKeyboard(player.reminder_hour),
    });
  });

  bot.chatType('private').command('pause', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await setPlayerActive(ctx.env.DB, userId, false);
    await ctx.reply('Reminders paused. /resume when you want them back.');
  });

  bot.chatType('private').command('resume', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await setPlayerActive(ctx.env.DB, userId, true);
    await ctx.reply('Reminders back on.');
  });

  bot.callbackQuery(/^g:(.+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const game = ctx.match[1];
    if (!game) return;
    await toggleGame(ctx.env.DB, userId, game);
    const selected = await getSelectedGames(ctx.env.DB, userId);
    await ctx.editMessageReplyMarkup({ reply_markup: gamesKeyboard(selected) });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^h:(\d+)$/, async (ctx) => {
    const raw = ctx.match[1];
    if (!raw) return;
    const hour = await setReminderHour(ctx.env.DB, ctx.from.id, Number(raw));
    await ctx.editMessageText(`Reminder set for ${hh(hour)} Paris time.`, {
      reply_markup: new InlineKeyboard(),
    });
    await ctx.answerCallbackQuery(`${hh(hour)} it is`);
  });

  bot.callbackQuery(CB.done, async (ctx) => {
    const selected = await getSelectedGames(ctx.env.DB, ctx.from.id);
    const labels = visibleGames()
      .filter((g) => selected.includes(g.id))
      .map((g) => `${g.emoji} ${g.label}`);
    await ctx.editMessageText(
      labels.length > 0 ? `You're playing:\n${labels.join('\n')}` : 'No games selected — /games to pick some.',
      { reply_markup: new InlineKeyboard() },
    );
    await ctx.answerCallbackQuery();
  });
}
