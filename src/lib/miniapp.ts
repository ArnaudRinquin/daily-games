/**
 * A `web_app` inline button only works in private chats, so the group digest
 * uses a plain URL button pointing at the Mini App's direct link. The same link
 * opens the app from a DM too, which keeps one code path.
 *
 * The short name comes from BotFather `/newapp`; the button does nothing at all
 * until that exists.
 */
export function miniAppLink(botUsername: string, shortName: string): string {
  return `https://t.me/${botUsername}/${shortName}`;
}

export function miniAppButton(botUsername: string, shortName: string) {
  return {
    inline_keyboard: [
      [{ text: '📊 Full leaderboard', url: miniAppLink(botUsername, shortName) }],
    ],
  };
}
