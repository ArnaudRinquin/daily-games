import { addMembership, deactivateGroup, getAllGroupMembers, upsertGroup } from '../db/groups';
import { getPlayer } from '../db/players';
import { renderDigest } from '../cron/digest';
import { decodeGroupPayload, joinLink } from '../lib/deeplink';
import { miniAppButton } from '../lib/miniapp';
import { playDate } from '../lib/time';
import { linksText, statusText } from './messages';
import type { AppBot, AppContext } from './types';

const IN_CHAT = new Set(['member', 'administrator', 'creator', 'restricted']);
const OUT_OF_CHAT = new Set(['left', 'kicked']);

function groupIntro(botUsername: string, chatId: number): string {
  return [
    "I'll collect everyone's daily puzzle results by DM and post the leaderboard here.",
    '',
    `👉 ${joinLink(botUsername, chatId)}`,
    '',
    'Tap that once. It opens a DM, signs you up with every game selected and a 09:00',
    'reminder, and adds you to this group\'s leaderboard. Then just paste your results',
    'into the DM as you play.',
    '',
    'Already talked to me before? Run /join here instead.',
  ].join('\n');
}

/**
 * Consumes a `/start g<payload>` deep link. Returns a line to append to the
 * welcome message, or null when the payload was not a group payload.
 *
 * Telegram cannot enumerate group members, but it CAN check one, so
 * getChatMember closes the hole where a forwarded link would otherwise sign up
 * a stranger.
 */
export async function joinGroupFromPayload(
  ctx: AppContext,
  payload: string,
): Promise<string | null> {
  const chatId = decodeGroupPayload(payload);
  if (chatId === null) return null;

  const userId = ctx.from?.id;
  if (userId === undefined) return null;

  let status: string;
  let title: string;
  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    status = member.status;
    const chat = await ctx.api.getChat(chatId);
    title = 'title' in chat && chat.title ? chat.title : 'the group';
  } catch {
    return "\n\n⚠️ I couldn't verify that group link — ask someone to re-post it there.";
  }

  if (!IN_CHAT.has(status)) {
    return "\n\n⚠️ That link is for a group you're not in, so I skipped it.";
  }

  await upsertGroup(ctx.env.DB, chatId, title);
  await addMembership(ctx.env.DB, chatId, userId);
  return `\n\n🏆 You're on the leaderboard for "${title}".`;
}

export function registerGroups(bot: AppBot): void {
  // Bot added to / removed from a group.
  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;

    const status = ctx.myChatMember.new_chat_member.status;

    if (OUT_OF_CHAT.has(status)) {
      await deactivateGroup(ctx.env.DB, chat.id);
      return;
    }
    if (!IN_CHAT.has(status)) return;

    const wasOut = OUT_OF_CHAT.has(ctx.myChatMember.old_chat_member.status);
    await upsertGroup(ctx.env.DB, chat.id, chat.title);
    if (!wasOut) return; // a promotion, not an arrival — don't re-announce

    await ctx.reply(groupIntro(ctx.me.username, chat.id), {
      link_preview_options: { is_disabled: true },
    });
  });

  // Fallback for anyone who already started the bot before this group existed.
  bot.chatType(['group', 'supergroup']).command('join', async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;

    const player = await getPlayer(ctx.env.DB, userId);
    if (!player) {
      await ctx.reply(
        `${ctx.from?.first_name ?? 'You'}: DM me first so I can send you reminders 👉 ` +
          joinLink(ctx.me.username, ctx.chat.id),
        { link_preview_options: { is_disabled: true } },
      );
      return;
    }

    await upsertGroup(ctx.env.DB, ctx.chat.id, ctx.chat.title);
    const added = await addMembership(ctx.env.DB, ctx.chat.id, userId);
    await ctx.reply(
      added
        ? `✅ ${player.first_name} is on the leaderboard.`
        : `${player.first_name} is already on the leaderboard.`,
    );
  });

  /**
   * The standings on demand. Deliberately does NOT claim the day's digest, so
   * asking for the board at lunchtime does not cost you the evening post.
   */
  bot.chatType(['group', 'supergroup']).command(['board', 'leaderboard'], async (ctx) => {
    const members = (await getAllGroupMembers(ctx.env.DB)).get(ctx.chat.id) ?? [];
    if (members.length === 0) {
      await ctx.reply(
        `Nobody has joined yet 👉 ${joinLink(ctx.me.username, ctx.chat.id)}`,
        { link_preview_options: { is_disabled: true } },
      );
      return;
    }

    const text = await renderDigest(
      ctx.env,
      { chat_id: ctx.chat.id, title: ctx.chat.title },
      members,
      playDate(new Date()),
    );
    const button = miniAppButton(ctx.env.BOT_USERNAME, ctx.env.MINIAPP_SHORT_NAME);
    await ctx.reply(text, {
      link_preview_options: { is_disabled: true },
      ...(button ? { reply_markup: button } : {}),
    });
  });

  bot.chatType(['group', 'supergroup']).command('links', async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    await ctx.reply(await linksText(ctx.env.DB, userId), {
      link_preview_options: { is_disabled: true },
    });
  });

  bot.chatType(['group', 'supergroup']).command('status', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    if (!(await getPlayer(ctx.env.DB, from.id))) {
      await ctx.reply(`${from.first_name}: paste a result and I'll start tracking you.`);
      return;
    }
    await ctx.reply(await statusText(ctx.env.DB, from.id, from.first_name));
  });

  // Personal settings stay DM-only. An inline keyboard posted in a group can be
  // tapped by anyone, and the callback handlers key on whoever tapped — so a
  // second person would silently rewrite a shared message to show their own
  // selection. /games /time /pause /resume are not offered here.

  // Anything else addressed to the bot in a group: point at the DM.
  bot.chatType(['group', 'supergroup']).command('start', async (ctx) => {
    await ctx.reply(groupIntro(ctx.me.username, ctx.chat.id), {
      link_preview_options: { is_disabled: true },
    });
  });
}
