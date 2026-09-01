import { GAMES, gameById, parseAll } from '../games/registry';
import {
  addMembership,
  ensurePlayerSeen,
  getPlayerScores,
  logMessageStatement,
  scoreStatements,
  upsertGroup,
} from '../lib/db';
import { playDate } from '../lib/time';
import type { AppBot, AppContext } from './types';

function ackLines(matches: readonly { game: string; display: string }[]): string {
  return matches
    .map((m) => {
      const game = gameById(m.game);
      return `✅ ${game ? `${game.emoji} ${game.label}` : m.game} — ${m.display}`;
    })
    .join('\n');
}

/** Cheap first pass: does this text look like anybody's result at all? */
function looksLikeAResult(text: string): boolean {
  return GAMES.some((g) => !g.hidden && g.detect(text));
}

/**
 * Writes the message log and any scores in ONE D1 batch, which is one
 * transaction. Returns false when this exact message was already stored, i.e.
 * a redelivered webhook.
 */
async function store(
  ctx: AppContext,
  params: {
    chatId: number;
    tgMessageId: number;
    userId: number;
    sentAt: number;
    text: string;
  },
): Promise<{ isNew: boolean; matches: ReturnType<typeof parseAll>; date: string }> {
  const matches = parseAll(params.text);
  const date = playDate(new Date(params.sentAt * 1000));

  const [logResult] = await ctx.env.DB.batch([
    logMessageStatement(ctx.env.DB, {
      chatId: params.chatId,
      tgMessageId: params.tgMessageId,
      userId: params.userId,
      sentAt: params.sentAt,
      text: params.text,
      matchedGames: matches.map((m) => m.game),
    }),
    ...scoreStatements(ctx.env.DB, params.userId, date, params.text, matches),
  ]);

  return { isNew: logResult?.meta.changes === 1, matches, date };
}

export function registerIngest(bot: AppBot): void {
  // ---------------------------------------------------------------- DM path
  bot.chatType('private').on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // commands are handled elsewhere

    // Log first, always. A DM that parses to nothing is the raw material for
    // fixing the parsers later, so it must be stored either way.
    const { isNew, matches, date } = await store(ctx, {
      chatId: ctx.chat.id,
      tgMessageId: ctx.message.message_id,
      userId,
      sentAt: ctx.message.date,
      text,
    });
    if (!isNew) return; // redelivered webhook

    if (matches.length === 0) {
      await ctx.reply(
        "I didn't recognise a result in that. Paste the share text straight from the " +
          "game and I'll pick it up — I've saved this one so I can learn the format.",
      );
      return;
    }

    const stored = await getPlayerScores(ctx.env.DB, userId, date);
    const today = playDate(new Date());
    // Deliberately no rank: the digest is the reveal.
    await ctx.reply(
      `${ackLines(matches)}${date === today ? '' : `\n(counted for ${date})`}\n\n` +
        `${stored.length} logged for ${date}. Results go up in the group tonight.`,
    );
  });

  // ------------------------------------------------------------- group path
  //
  // People paste results into the group out of habit, and a score posted there
  // used to vanish silently — the bot could not even say so, because privacy
  // mode hid the message from it. Reading groups also sidesteps the platform's
  // hardest constraint: a bot cannot DM someone who has never started it, but
  // it can still see and rank what they post here.
  bot.chatType(['group', 'supergroup']).on('message:text', async (ctx) => {
    const from = ctx.from;
    if (!from || from.is_bot) return;

    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    // Only messages that look like a result are stored. Ordinary group chatter
    // must not pollute the calibration corpus — but a MALFORMED result still
    // lands there, because `detect` fires before `parse` gives up.
    if (!looksLikeAResult(text)) return;

    await ensurePlayerSeen(ctx.env.DB, {
      id: from.id,
      username: from.username,
      first_name: from.first_name,
    });
    await upsertGroup(ctx.env.DB, ctx.chat.id, ctx.chat.title);
    await addMembership(ctx.env.DB, ctx.chat.id, from.id);

    const { isNew, matches, date } = await store(ctx, {
      chatId: ctx.chat.id,
      tgMessageId: ctx.message.message_id,
      userId: from.id,
      sentAt: ctx.message.date,
      text,
    });
    if (!isNew || matches.length === 0) return;

    // Acknowledge in the DM, never in the group: the group asked for a
    // leaderboard, not a bot narrating every paste. Fails silently for anyone
    // who has never started the bot, which is exactly the case this supports.
    try {
      await ctx.api.sendMessage(
        from.id,
        `${ackLines(matches)}\n\nPicked that up from "${ctx.chat.title}" — logged for ${date}.`,
      );
    } catch {
      // Never started the bot, or blocked it. The score still counts.
    }
  });
}
