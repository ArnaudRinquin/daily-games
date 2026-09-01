import { gameById, parseAll } from '../games/registry';
import { getPlayerScores, logMessageStatement, scoreStatements } from '../lib/db';
import { playDate } from '../lib/time';
import type { AppBot } from './types';

function ackLines(matches: readonly { game: string; display: string }[]): string {
  return matches
    .map((m) => {
      const game = gameById(m.game);
      return `✅ ${game ? `${game.emoji} ${game.label}` : m.game} — ${m.display}`;
    })
    .join('\n');
}

export function registerIngest(bot: AppBot): void {
  bot.chatType('private').on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // commands are handled elsewhere

    const matches = parseAll(text);
    const sentAt = ctx.message.date;
    const date = playDate(new Date(sentAt * 1000));

    // The log and the scores go in one D1 batch, which is one transaction.
    // Logging first and writing scores second would let a failed score write
    // leave a message marked as parsed with nothing to show for it — and the
    // redelivery guard would then discard the retry.
    const [logResult] = await ctx.env.DB.batch([
      logMessageStatement(ctx.env.DB, {
        tgMessageId: ctx.message.message_id,
        userId,
        sentAt,
        text,
        matchedGames: matches.map((m) => m.game),
      }),
      ...scoreStatements(ctx.env.DB, userId, date, text, matches),
    ]);

    if (logResult?.meta.changes !== 1) return; // redelivered webhook

    if (matches.length === 0) {
      await ctx.reply(
        "I didn't recognise a result in that. Paste the share text straight from the " +
          "game and I'll pick it up — I've saved this one so I can learn the format.",
      );
      return;
    }

    const today = playDate(new Date());
    const stored = await getPlayerScores(ctx.env.DB, userId, date);
    // Deliberately no rank: the digest is the reveal.
    await ctx.reply(
      `${ackLines(matches)}${date === today ? '' : `\n(counted for ${date})`}\n\n` +
        `${stored.length} logged for ${date}. Results go up in the group tonight.`,
    );
  });
}
