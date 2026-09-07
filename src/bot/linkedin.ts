import {
  addPending,
  clearPending,
  getLinkForUser,
  getPendingForUser,
  getProfileByPublicIdentifier,
  link,
  unlink,
} from '../db/linkedin';
import { ensurePlayer } from '../db/players';
import type { AppBot } from './types';

/** `https://www.linkedin.com/in/jean-dupont/`, `linkedin.com/in/jean-dupont`, or the bare slug. */
export function publicIdentifierOf(input: string): string | null {
  const s = input.trim();
  const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(s);
  if (m?.[1]) return decodeURIComponent(m[1]);
  if (/^[\w.%-]{3,100}$/.test(s)) return s;
  return null;
}

/**
 * /linkedin — self-service mapping. The profile has to have shown up on the
 * captain's leaderboard at least once, i.e. the player is a connection and
 * has played; that is also what stops a player linking a stranger's profile.
 */
export function registerLinkedIn(bot: AppBot): void {
  bot.chatType('private').command('linkedin', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await ensurePlayer(ctx.env.DB, {
      id: userId,
      username: ctx.from?.username,
      first_name: ctx.from?.first_name ?? '',
    });
    const arg = ctx.match.trim();

    if (arg === 'off') {
      const removed = (await unlink(ctx.env.DB, userId)) || (await clearPending(ctx.env.DB, userId));
      await ctx.reply(removed ? 'Unlinked. Share your LinkedIn results by hand again.' : 'Nothing was linked.');
      return;
    }

    if (!arg) {
      const current = await getLinkForUser(ctx.env.DB, userId);
      const pending = current ? null : await getPendingForUser(ctx.env.DB, userId);
      await ctx.reply(
        current
          ? `Linked to ${current.first_name} ${current.last_name} (linkedin.com/in/${current.public_identifier ?? '?'}). ` +
              'LinkedIn games import on their own. /linkedin off to stop.'
          : pending
            ? `Waiting for linkedin.com/in/${pending.public_identifier} to show up on the leaderboard. ` +
              'It links itself the first time you finish a game. /linkedin off to cancel.'
            : 'Not linked. Send /linkedin <your profile URL>, e.g. /linkedin https://www.linkedin.com/in/jean-dupont',
        { link_preview_options: { is_disabled: true } },
      );
      return;
    }

    const slug = publicIdentifierOf(arg);
    if (!slug) {
      await ctx.reply('That does not look like a LinkedIn profile URL. Expected linkedin.com/in/<name>.');
      return;
    }
    const profile = await getProfileByPublicIdentifier(ctx.env.DB, slug);
    if (!profile) {
      // Not seen yet: remembered, and linked by the import the first time the
      // slug appears — which needs them connected to the captain on LinkedIn.
      await addPending(ctx.env.DB, { publicIdentifier: slug, userId, source: 'self' });
      await ctx.reply(
        `Noted: linkedin.com/in/${slug}. It links itself the first time you finish a LinkedIn game ` +
          '(you need to be a LinkedIn connection of the captain). /linkedin off to cancel.',
      );
      return;
    }
    await clearPending(ctx.env.DB, userId);
    const result = await link(ctx.env.DB, { profileUrn: profile.profile_urn, userId, source: 'self' });
    await ctx.reply(
      result === 'linked'
        ? `Linked to ${profile.first_name} ${profile.last_name}. Your LinkedIn results now come in on their own.`
        : 'That profile is already linked to somebody else.',
    );
  });
}
