import type { Api } from 'grammy';
import type { AppEnv } from '../env';
import { getLinks, getMeta, link, setMeta, upsertProfileStatements } from '../db/linkedin';
import { scoreStatements } from '../db/scores';
import { postCompletedDigests } from './digest';
import { nowSeconds, playDate } from '../lib/time';
import {
  fetchHub,
  fetchLeaderboard,
  scoreOf,
  VoyagerAuthError,
  type Fetch,
  type LeaderboardRow,
  type VoyagerCredentials,
} from '../lib/voyager';

/**
 * The LinkedIn import. One player (the captain, whose cookies are the
 * secrets) is connected to everyone in the group, and LinkedIn shows a
 * connection's score for every game they finished. So one session's
 * leaderboards are the whole group's LinkedIn results, and nobody pastes
 * anything.
 *
 * Idempotent by construction: scores upsert on (player, game, day). Pasting
 * the same result later just rewrites the same row.
 */

export interface ImportResult {
  /** Scores written this tick — including unchanged ones; the DB does not say. */
  imported: number;
  /** Players auto-linked by first name this tick. */
  autoLinked: number;
  /** Ranked rows whose profile belongs to nobody yet. */
  unmatched: number;
  skipped?: 'no-credentials' | 'auth' | 'error';
}

export function credentialsOf(env: AppEnv): VoyagerCredentials | null {
  if (!env.LI_AT || !env.LI_JSESSIONID) return null;
  return { liAt: env.LI_AT, jsessionId: env.LI_JSESSIONID };
}

/**
 * First-name matching, for the common case in a friend group: the LinkedIn
 * first name equals exactly one player's Telegram first name. Anything
 * ambiguous stays unlinked until /linkedin or the admin resolves it.
 */
export function autoMatch(
  profiles: readonly { profileUrn: string; firstName: string }[],
  players: readonly { user_id: number; first_name: string }[],
  linkedUsers: ReadonlySet<number>,
): Array<{ profileUrn: string; userId: number }> {
  const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const byName = new Map<string, number[]>();
  for (const p of players) {
    if (linkedUsers.has(p.user_id)) continue;
    const key = norm(p.first_name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), p.user_id]);
  }
  const out: Array<{ profileUrn: string; userId: number }> = [];
  const claimed = new Set<number>();
  const seenNames = new Map<string, number>();
  for (const pr of profiles) seenNames.set(norm(pr.firstName), (seenNames.get(norm(pr.firstName)) ?? 0) + 1);
  for (const pr of profiles) {
    const key = norm(pr.firstName);
    const candidates = byName.get(key);
    // Exactly one player AND exactly one LinkedIn profile with that name.
    if (!candidates || candidates.length !== 1 || seenNames.get(key) !== 1) continue;
    const userId = candidates[0]!;
    if (claimed.has(userId)) continue;
    claimed.add(userId);
    out.push({ profileUrn: pr.profileUrn, userId });
  }
  return out;
}

export async function importLinkedIn(
  env: AppEnv,
  api: Api,
  now: Date,
  fetchImpl: Fetch = fetch,
): Promise<ImportResult> {
  const creds = credentialsOf(env);
  if (!creds) return { imported: 0, autoLinked: 0, unmatched: 0, skipped: 'no-credentials' };

  const date = playDate(now);
  let games;
  const perGame: Array<{ gameTypeId: number; rows: LeaderboardRow[] }> = [];
  try {
    games = await fetchHub(creds, fetchImpl);
    const memberId = games[0]?.memberId;
    if (memberId) await setMeta(env.DB, 'captain_urn', `urn:li:fsd_profile:${memberId}`);
    for (const game of games) {
      perGame.push({ gameTypeId: game.gameTypeId, rows: await fetchLeaderboard(game, creds, fetchImpl) });
    }
  } catch (error) {
    if (error instanceof VoyagerAuthError) {
      await notifyCaptain(env, api, now, error.message);
      return { imported: 0, autoLinked: 0, unmatched: 0, skipped: 'auth' };
    }
    console.error('linkedin import failed', { error: String(error) });
    return { imported: 0, autoLinked: 0, unmatched: 0, skipped: 'error' };
  }

  const allRows = perGame.flatMap((g) => g.rows);
  if (allRows.length > 0) await env.DB.batch(upsertProfileStatements(env.DB, allRows));

  // Auto-link by first name, then read the links back in one go.
  let links = await getLinks(env.DB);
  const { results: players } = await env.DB
    .prepare('SELECT user_id, first_name FROM players WHERE active = 1')
    .all<{ user_id: number; first_name: string }>();
  const unlinkedProfiles = uniqueBy(allRows, (r) => r.profileUrn).filter((r) => !links.has(r.profileUrn));
  let autoLinked = 0;
  for (const m of autoMatch(unlinkedProfiles, players, new Set(links.values()))) {
    if ((await link(env.DB, { ...m, source: 'auto' })) !== 'linked') continue;
    autoLinked++;
    const profile = unlinkedProfiles.find((p) => p.profileUrn === m.profileUrn);
    await api
      .sendMessage(
        m.userId,
        `Linked you to LinkedIn as ${profile?.firstName ?? ''} ${profile?.lastName ?? ''}. ` +
          'Your LinkedIn game results now come in on their own, no need to share them. ' +
          'Not you? Send /linkedin off.',
      )
      .catch(() => {});
  }
  if (autoLinked > 0) links = await getLinks(env.DB);

  // Write scores, one batch, then fire the completion trigger for whoever got one.
  const statements: D1PreparedStatement[] = [];
  const touched = new Set<number>();
  let unmatched = 0;
  for (const { gameTypeId, rows } of perGame) {
    for (const row of rows) {
      const score = scoreOf(gameTypeId, row);
      if (!score) continue;
      const userId = links.get(row.profileUrn);
      if (userId === undefined) {
        unmatched++;
        continue;
      }
      statements.push(...scoreStatements(env.DB, userId, date, rawOf(gameTypeId, row), [score]));
      touched.add(userId);
    }
  }
  if (statements.length > 0) await env.DB.batch(statements);

  if (touched.size > 0) await postCompletedDigests(env, api, [...touched], date);

  return { imported: statements.length, autoLinked, unmatched };
}

function uniqueBy<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(key(i)) ? false : (seen.add(key(i)), true)));
}

/** What lands in scores.raw: enough to reparse, and to tell an import from a paste. */
function rawOf(gameTypeId: number, row: LeaderboardRow): string {
  return JSON.stringify({
    source: 'linkedin',
    gameTypeId,
    ranking: row.ranking,
    timeElapsed: row.timeElapsed,
    totalGuessCount: row.totalGuessCount,
    flawless: row.flawless,
  });
}

/**
 * The captain is whoever is linked to the session's own profile. Telling
 * them is the whole alerting system: a lapsed cookie otherwise looks like a
 * group that suddenly stopped playing LinkedIn. Once a day, not every tick.
 */
const ALERT_INTERVAL = 24 * 3600;

async function notifyCaptain(env: AppEnv, api: Api, now: Date, message: string) {
  const [captainUrn, lastAlert] = await Promise.all([
    getMeta(env.DB, 'captain_urn'),
    getMeta(env.DB, 'last_auth_alert'),
  ]);
  const at = nowSeconds(now);
  if (lastAlert && at - Number(lastAlert) < ALERT_INTERVAL) return;
  const links = await getLinks(env.DB);
  const captain = captainUrn ? links.get(captainUrn) : undefined;
  if (captain === undefined) {
    console.error('linkedin auth failed, no captain linked', { message });
    return;
  }
  await setMeta(env.DB, 'last_auth_alert', String(at));
  await api
    .sendMessage(captain, `⚠️ LinkedIn import stopped: ${message}`)
    .catch(() => {});
}
