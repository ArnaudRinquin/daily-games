/**
 * LinkedIn's internal API ("Voyager"): the one the linkedin.com frontend talks
 * to. There is no official games API, so this is the browser's own session,
 * replayed from the Worker.
 *
 * Auth is two cookies pasted once as secrets. `li_at` is the session (about a
 * year), `JSESSIONID` doubles as the CSRF token and must be echoed in a header.
 * When either lapses, LinkedIn answers with a redirect to login or a 401/403,
 * never with a parse error — so those statuses are the "re-paste" signal.
 *
 * The two queries were lifted from the games hub's own network traffic, see
 * ../../test/fixtures/voyager for real (scrubbed) responses. The `queryId`
 * hashes are persisted-query fingerprints and can rotate on a LinkedIn
 * deploy; when that happens the hub returns a GraphQL error and the import
 * degrades to nothing, while paste and the Shortcut keep working.
 */

/** LinkedIn's numeric game types, as they appear in `urn:li:fsd_game:(member,type,puzzle)`. */
export const GAME_TYPES: Readonly<Record<number, string>> = {
  1: 'pinpoint',
  2: 'crossclimb',
  3: 'queens',
  4: 'wend',
  5: 'tango',
  6: 'zip',
  7: 'minisudoku',
  8: 'patches',
};

const BASE = 'https://www.linkedin.com/voyager/api/graphql?includeWebMetadata=true';

const HUB_QUERY_ID = 'voyagerIdentityDashGameEntryPoints.4666a73a66c1a9663577e1c37f1ac13a';
const LEADERBOARD_QUERY_ID =
  'voyagerIdentityDashGameConnectionsEntities.a5fed1d462445e698d896bd5563fed9c';

/** Rest.li's page size for the full leaderboard, same as the "See full leaderboard" page. */
export const PAGE_SIZE = 25;

export function hubUrl(): string {
  return `${BASE}&variables=(gameEntryPointType:GAME_HUB)&queryId=${HUB_QUERY_ID}`;
}

/** Rest.li wants the urn fully %-encoded inside the variables tuple. */
function encodeUrn(urn: string): string {
  return urn.replace(/[:(),]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function leaderboardUrl(game: HubGame, start: number): string {
  const urn = encodeUrn(`urn:li:fsd_game:(${game.memberId},${game.gameTypeId},${game.puzzleId})`);
  return `${BASE}&variables=(gameUrn:${urn},start:${start},count:${PAGE_SIZE})&queryId=${LEADERBOARD_QUERY_ID}`;
}

export interface HubGame {
  memberId: string;
  gameTypeId: number;
  puzzleId: number;
  /** The captain's own state; the leaderboard is what matters for everyone else. */
  solved: boolean;
}

export interface LeaderboardRow {
  profileUrn: string;
  firstName: string;
  lastName: string;
  publicIdentifier: string | null;
  /** null for connections who opted out of the leaderboard: no score for them. */
  ranking: number | null;
  timeElapsed: number | null;
  totalGuessCount: number | null;
  flawless: boolean;
}

export interface LeaderboardPage {
  rows: LeaderboardRow[];
  total: number;
}

/* ---------- parsing: pure, exercised against the fixtures ---------- */

interface Normalized {
  data?: unknown;
  included?: Array<Record<string, unknown>>;
}

const GAME_TYPE = 'com.linkedin.voyager.dash.identity.game.Game';
const PROFILE_TYPE = 'com.linkedin.voyager.dash.identity.profile.Profile';
const GAME_URN = /^urn:li:fsd_game:\(([^,]+),(\d+),(\d+)\)$/;

export function parseHub(json: unknown): HubGame[] {
  const included = (json as Normalized | null)?.included ?? [];
  const games: HubGame[] = [];
  for (const item of included) {
    if (item.$type !== GAME_TYPE) continue;
    const m = GAME_URN.exec(String(item.entityUrn ?? ''));
    if (!m?.[1] || !m[2] || !m[3]) continue;
    const record = item.gameStoredRecord as { gamePlayState?: string } | null | undefined;
    games.push({
      memberId: m[1],
      gameTypeId: Number(m[2]),
      puzzleId: Number(m[3]),
      solved: /^END/.test(record?.gamePlayState ?? ''),
    });
  }
  return games;
}

/** Depth-first search for the Rest.li collection: `{ elements: [...], paging: {...} }`. */
function findCollection(node: unknown): { elements: unknown[]; paging?: { total?: number } } | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.elements)) return obj as { elements: unknown[]; paging?: { total?: number } };
  for (const value of Object.values(obj)) {
    const found = findCollection(value);
    if (found) return found;
  }
  return null;
}

export function parseLeaderboard(json: unknown): LeaderboardPage {
  const doc = (json ?? {}) as Normalized;
  const profiles = new Map<string, { firstName: string; lastName: string; publicIdentifier: string | null }>();
  for (const item of doc.included ?? []) {
    if (item.$type !== PROFILE_TYPE) continue;
    profiles.set(String(item.entityUrn), {
      firstName: String(item.firstName ?? ''),
      lastName: String(item.lastName ?? ''),
      publicIdentifier: typeof item.publicIdentifier === 'string' ? item.publicIdentifier : null,
    });
  }

  const collection = findCollection(doc.data);
  if (!collection) return { rows: [], total: 0 };

  const rows: LeaderboardRow[] = [];
  for (const el of collection.elements as Array<Record<string, unknown>>) {
    const player = (el.playerDetails as { player?: Record<string, unknown> } | undefined)?.player;
    const profileUrn = player?.['*profile'];
    if (typeof profileUrn !== 'string') continue;
    const profile = profiles.get(profileUrn) ?? { firstName: '', lastName: '', publicIdentifier: null };
    const score = (el.gameScore ?? {}) as { timeElapsed?: number | null; totalGuessCount?: number | null };
    rows.push({
      profileUrn,
      ...profile,
      ranking: typeof el.ranking === 'number' ? el.ranking : null,
      timeElapsed: typeof score.timeElapsed === 'number' ? score.timeElapsed : null,
      totalGuessCount: typeof score.totalGuessCount === 'number' ? score.totalGuessCount : null,
      flawless: el.isFlawless === true,
    });
  }
  return { rows, total: collection.paging?.total ?? rows.length };
}

/* ---------- the score a row is worth, in this bot's terms ---------- */

function fmtSeconds(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Same `value`/`display` the paste parsers produce for the same result, so an
 * imported score and a pasted one for the same game compare and render alike.
 * Returns null for rows that carry no score: opted-out connections, and a
 * shape this code does not understand.
 */
export function scoreOf(
  gameTypeId: number,
  row: LeaderboardRow,
): { game: string; value: number; display: string } | null {
  const game = GAME_TYPES[gameTypeId];
  if (!game || row.ranking === null) return null;
  if (game === 'pinpoint') {
    const n = row.totalGuessCount;
    if (n === null || n < 1 || n > 5) return null;
    return { game, value: n, display: `${n}/5` };
  }
  const s = row.timeElapsed;
  if (s === null || s < 0) return null;
  return { game, value: s, display: fmtSeconds(s) };
}

/* ---------- fetching ---------- */

export class VoyagerAuthError extends Error {
  constructor(public status: number) {
    super(`LinkedIn session rejected (${status}). Re-paste li_at and JSESSIONID.`);
  }
}

export interface VoyagerCredentials {
  liAt: string;
  jsessionId: string;
}

export type Fetch = typeof fetch;

export async function voyagerGet(
  url: string,
  creds: VoyagerCredentials,
  fetchImpl: Fetch = fetch,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    redirect: 'manual',
    headers: {
      cookie: `li_at=${creds.liAt}; JSESSIONID="${creds.jsessionId}"`,
      'csrf-token': creds.jsessionId,
      accept: 'application/vnd.linkedin.normalized+json+2.1',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    },
  });
  // 999 is LinkedIn's "not a browser I like" — treated like a lapsed session
  // because the operator's fix is the same: look, then re-paste.
  if (res.status === 401 || res.status === 403 || res.status === 999 || (res.status >= 300 && res.status < 400)) {
    throw new VoyagerAuthError(res.status);
  }
  if (!res.ok) throw new Error(`voyager ${res.status}`);
  return res.json();
}

export async function fetchHub(creds: VoyagerCredentials, fetchImpl: Fetch = fetch): Promise<HubGame[]> {
  return parseHub(await voyagerGet(hubUrl(), creds, fetchImpl));
}

/** Every page of one game's connections leaderboard. Capped, in case `total` lies. */
export async function fetchLeaderboard(
  game: HubGame,
  creds: VoyagerCredentials,
  fetchImpl: Fetch = fetch,
): Promise<LeaderboardRow[]> {
  const rows: LeaderboardRow[] = [];
  const MAX_PAGES = 8;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows: pageRows, total } = parseLeaderboard(
      await voyagerGet(leaderboardUrl(game, page * PAGE_SIZE), creds, fetchImpl),
    );
    rows.push(...pageRows);
    if (pageRows.length === 0 || rows.length >= total) break;
  }
  return rows;
}
