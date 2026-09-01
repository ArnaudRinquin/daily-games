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

export type VerifyFailure =
  | 'no-init-data'
  | 'unparseable'
  | 'no-hash'
  | 'bad-hash'
  | 'no-auth-date'
  | 'expired'
  | 'no-user'
  | 'bad-user';

export type VerifyResult =
  | { ok: true; data: VerifiedInitData }
  | { ok: false; reason: VerifyFailure; keys?: string[] };

/**
 * Detailed result, for server-side logging only. The reason must never reach
 * the client: an attacker has no business knowing which check failed.
 */
export async function verifyInitDataDetailed(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: Date } = {},
): Promise<VerifyResult> {
  if (!initData) return { ok: false, reason: 'no-init-data' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  const keys = [...params.keys()].sort();
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no-hash', keys };

  const checkString = [...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const expected = toHex(await hmac(secret, checkString));
  if (!timingSafeEqual(expected, hash.toLowerCase())) {
    return { ok: false, reason: 'bad-hash', keys };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: 'no-auth-date', keys };
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const maxAge = options.maxAgeSeconds ?? MAX_AUTH_AGE_SECONDS;
  if (nowSeconds - authDate > maxAge) return { ok: false, reason: 'expired', keys };

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, reason: 'no-user', keys };

  let user: TelegramUser;
  try {
    user = JSON.parse(rawUser) as TelegramUser;
  } catch {
    return { ok: false, reason: 'bad-user', keys };
  }
  if (typeof user?.id !== 'number' || typeof user.first_name !== 'string') {
    return { ok: false, reason: 'bad-user', keys };
  }

  return { ok: true, data: { user, authDate } };
}

/** Null on any failure — the caller learns nothing about which check failed. */
export async function verifyInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: Date } = {},
): Promise<VerifiedInitData | null> {
  const result = await verifyInitDataDetailed(initData, botToken, options);
  return result.ok ? result.data : null;
}
