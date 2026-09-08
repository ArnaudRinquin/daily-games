import type { Api } from 'grammy';
import type { AppEnv } from '../env';
import { getLinks, getMeta, resolvePending, setMeta, upsertProfileStatements } from '../db/linkedin';
import { scoreStatements } from '../db/scores';
import { postCompletedDigests } from './digest';
import { linkedInPlayDate, nowSeconds } from '../lib/time';
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
  /** Ranked rows whose profile belongs to nobody yet: most of the captain's connections. */
  unmatched: number;
  skipped?: 'no-credentials' | 'auth' | 'error';
}

export function credentialsOf(env: AppEnv): VoyagerCredentials | null {
  if (!env.LI_AT || !env.LI_JSESSIONID) return null;
  return { liAt: env.LI_AT, jsessionId: env.LI_JSESSIONID };
}

export async function importLinkedIn(
  env: AppEnv,
  api: Api,
  now: Date,
  fetchImpl: Fetch = fetch,
): Promise<ImportResult> {
  const creds = credentialsOf(env);
  if (!creds) return { imported: 0, unmatched: 0, skipped: 'no-credentials' };

  const date = linkedInPlayDate(now);
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
      return { imported: 0, unmatched: 0, skipped: 'auth' };
    }
    console.error('linkedin import failed', { error: String(error) });
    return { imported: 0, unmatched: 0, skipped: 'error' };
  }

  const allRows = perGame.flatMap((g) => g.rows);
  if (allRows.length > 0) await env.DB.batch(upsertProfileStatements(env.DB, allRows));

  // Only linked profiles score. The captain's leaderboard is mostly people who
  // are not in the group at all, so nothing is guessed from names: a player
  // links themself with /linkedin <profile url>, and a slug given before the
  // profile ever showed up resolves here, the first tick it does.
  for (const { userId, profile } of await resolvePending(env.DB)) {
    await api
      .sendMessage(
        userId,
        `Linked to ${profile.first_name} ${profile.last_name} on LinkedIn. ` +
          'Your LinkedIn results now come in on their own.',
      )
      .catch(() => {});
  }
  const links = await getLinks(env.DB);

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

  return { imported: statements.length, unmatched };
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
