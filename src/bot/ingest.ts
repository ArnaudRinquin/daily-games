import { gameById, parseAll } from '../games/registry';
import { getPlayerScores, logMessage, upsertScores } from '../lib/db';
import { playDate } from '../lib/time';
import type { AppBot } from './types';

function ackText(
  matches: readonly { game: string; display: string }[],
  date: string,
  isToday: boolean,
): string {
  const lines = matches.map((m) => {
    const game = gameById(m.game);
    return `✅ ${game ? `${game.emoji} ${game.label}` : m.game} — ${m.display}`;
  });
  // Never a rank: the digest is the reveal.
  const forDay = isToday ? '' : `\n(counted for ${date})`;
  return `${lines.join('\n')}${forDay}`;
}

export function registerIngest(bot: AppBot): void {
  bot.chatType('private').on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // commands are handled elsewhere

    const matches = parseAll(text);
    const sentAt = ctx.message.date;

    // Log first, always. A message that parses to nothing is the raw material
    // for fixing the parsers later, so it must be stored either way.
    const isNew = await logMessage(ctx.env.DB, {
      tgMessageId: ctx.message.message_id,
      userId,
      sentAt,
      text,
      matchedGames: matches.map((m) => m.game),
    });
    if (!isNew) return; // redelivered webhook

    if (matches.length === 0) {
      await ctx.reply(
        "I didn't recognise a result in that. Paste the share text straight from the " +
          "game and I'll pick it up — I've saved this one so I can teach myself the format.",
      );
      return;
    }

    const date = playDate(new Date(sentAt * 1000));
    await upsertScores(ctx.env.DB, userId, date, text, matches);

    const today = playDate(new Date());
    const stored = await getPlayerScores(ctx.env.DB, userId, date);
    const remaining = stored.length;
    await ctx.reply(
      `${ackText(matches, date, date === today)}\n\n${remaining} logged for ${date}. ` +
        'Results go up in the group tonight.',
    );
  });
}
