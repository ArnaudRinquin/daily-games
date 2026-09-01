/**
 * Telegram Mini App authentication. The client hands us a signed `initData`
 * query string; we recompute the HMAC and compare.
 *
 *   secret   = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   expected = HMAC_SHA256(key = secret, message = data_check_string)
 *
 * `data_check_string` is every remaining parameter as `key=value`, sorted by
 * key, joined with newlines. Both `hash` and `signature` are excluded —
 * `signature` is Telegram's newer third-party-validation field, and leaving it
 * in makes every check fail with no visible reason.
 *
 * Workers has no Node crypto, so this is crypto.subtle throughout.
 */

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: number;
}

export const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent, value-constant comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Null on any failure — a caller has no business knowing which check failed. */
export async function verifyInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: Date } = {},
): Promise<VerifiedInitData | null> {
  if (!initData) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get('hash');
  if (!hash) return null;

  const checkString = [...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const expected = toHex(await hmac(secret, checkString));
  if (!timingSafeEqual(expected, hash.toLowerCase())) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const maxAge = options.maxAgeSeconds ?? MAX_AUTH_AGE_SECONDS;
  if (nowSeconds - authDate > maxAge) return null;

  const rawUser = params.get('user');
  if (!rawUser) return null;

  let user: TelegramUser;
  try {
    user = JSON.parse(rawUser) as TelegramUser;
  } catch {
    return null;
  }
  if (typeof user?.id !== 'number' || typeof user.first_name !== 'string') return null;

  return { user, authDate };
}
