/**
 * A `web_app` inline button only works in private chats, so the group digest
 * uses a plain URL button pointing at the Mini App's direct link. The same link
 * opens the app from a DM too, which keeps one code path.
 *
 * The short name comes from BotFather `/newapp` and has no default: an
 * unconfigured link silently resolves to nothing, which looks like a broken bot
 * rather than an unfinished setup. Until it is set, no button is attached.
 */
export function miniAppLink(botUsername: string, shortName: string): string | null {
  return shortName ? `https://t.me/${botUsername}/${shortName}` : null;
}

export function miniAppButton(botUsername: string, shortName: string) {
  const url = miniAppLink(botUsername, shortName);
  if (!url) return undefined;
  return { inline_keyboard: [[{ text: '📊 Full leaderboard', url }]] };
}
