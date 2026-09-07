import { Hono } from 'hono';
import { Api } from 'grammy';
import type { AppEnv } from '../env';
import { postCompletedDigests } from '../cron/digest';
import { getPlayerByToken } from '../db/players';
import { getPlayerScores } from '../db/scores';
import { ackLines, linkedinNudge, store, syntheticMessageId } from '../lib/ingest';
import { nowSeconds, playDate } from '../lib/time';

/**
 * Results over HTTP, for the iOS Shortcut: Share → Share via → shortcut, and
 * the share text lands here without a trip through Telegram.
 *
 * The token in the path IS the authentication. It is minted by /shortcut and
 * lives in the player's Shortcut, so leaking it means somebody else can submit
 * scores as you — and nothing worse, since the endpoint does nothing else.
 * Rotating it is one command.
 *
 * Replies are plain text, shown verbatim by the Shortcut's notification.
 */
export const ingest = new Hono<{ Bindings: AppEnv }>();

const MAX_BYTES = 4096;

async function readText(c: { req: { header(name: string): string | undefined; text(): Promise<string>; json(): Promise<unknown> } }): Promise<string> {
  const type = c.req.header('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    return typeof body?.text === 'string' ? body.text : '';
  }
  return c.req.text();
}

ingest.post('/api/ingest/:token', async (c) => {
  const player = await getPlayerByToken(c.env.DB, c.req.param('token'));
  if (!player) return c.text('Unknown token. Run /shortcut in the bot to get a fresh URL.', 401);

  const text = (await readText(c)).trim();
  if (!text) return c.text('Nothing to submit: the shortcut received empty text.', 400);
  if (text.length > MAX_BYTES) return c.text('That is too long to be a result.', 413);

  const sentAt = nowSeconds();
  const date = playDate(new Date(sentAt * 1000));
  const { isNew, matches } = await store(c.env.DB, {
    chatId: player.user_id, // the DM convention: chat id = user id
    tgMessageId: syntheticMessageId(text, date),
    userId: player.user_id,
    sentAt,
    text,
  });

  if (matches.length === 0) {
    return c.text(
      "I didn't recognise a result in that. Saved it so I can learn the format.",
      422,
    );
  }
  if (!isNew) return c.text(`Already logged:\n${ackLines(matches)}`);

  const stored = await getPlayerScores(c.env.DB, player.user_id, date);
  const reply =
    `${ackLines(matches)}\n\n${stored.length} logged for ${date}.` +
    (await linkedinNudge(c.env, player.user_id, matches));

  // Mirror the DM so Telegram history stays the one place everything shows.
  // Fails for anyone who never started the bot; the score still counts.
  const api = new Api(c.env.BOT_TOKEN);
  await api.sendMessage(player.user_id, `${reply} (via shortcut)`).catch(() => {});
  await postCompletedDigests(c.env, api, player.user_id, date);

  return c.text(reply);
});
