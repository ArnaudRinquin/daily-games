/**
 * Group membership rides in the /start payload, so tapping the link the bot
 * posts in a group both opens the DM and records the membership — one action
 * instead of "tap the link, then run /join".
 *
 * Telegram allows A-Z a-z 0-9 _ - in a start payload, max 64 chars. base64url
 * uses exactly that alphabet, so a chat id survives the round trip untouched.
 */

const GROUP_PREFIX = 'g';

function b64urlEncode(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text: string): string | null {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
}

export function encodeGroupPayload(chatId: number): string {
  return GROUP_PREFIX + b64urlEncode(String(chatId));
}

/** Null when the payload is not a group payload or is corrupt. */
export function decodeGroupPayload(payload: string): number | null {
  if (!payload.startsWith(GROUP_PREFIX)) return null;
  const decoded = b64urlDecode(payload.slice(GROUP_PREFIX.length));
  if (decoded === null || !/^-?\d{1,19}$/.test(decoded)) return null;
  const id = Number(decoded);
  return Number.isSafeInteger(id) ? id : null;
}

export function joinLink(botUsername: string, chatId: number): string {
  return `https://t.me/${botUsername}?start=${encodeGroupPayload(chatId)}`;
}

export function startLink(botUsername: string): string {
  return `https://t.me/${botUsername}?start=join`;
}
