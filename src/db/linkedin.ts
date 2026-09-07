import type { LeaderboardRow } from '../lib/voyager';
import { nowSeconds } from '../lib/time';

export interface LinkedInProfileRow {
  profile_urn: string;
  first_name: string;
  last_name: string;
  public_identifier: string | null;
  last_seen: number;
}

export interface LinkedInLinkRow {
  profile_urn: string;
  user_id: number;
  source: 'auto' | 'self' | 'admin';
  linked_at: number;
}

/** Remember every profile the leaderboard showed, so unmapped ones can be listed and matched. */
export function upsertProfileStatements(db: D1Database, rows: readonly LeaderboardRow[]): D1PreparedStatement[] {
  const now = nowSeconds();
  const seen = new Set<string>();
  const out: D1PreparedStatement[] = [];
  for (const r of rows) {
    if (seen.has(r.profileUrn)) continue;
    seen.add(r.profileUrn);
    out.push(
      db
        .prepare(
          `INSERT INTO linkedin_profiles (profile_urn, first_name, last_name, public_identifier, last_seen)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (profile_urn) DO UPDATE SET
             first_name = excluded.first_name,
             last_name = excluded.last_name,
             public_identifier = excluded.public_identifier,
             last_seen = excluded.last_seen`,
        )
        .bind(r.profileUrn, r.firstName, r.lastName, r.publicIdentifier, now),
    );
  }
  return out;
}

/** profile urn → Telegram user id, for everyone linked. */
export async function getLinks(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db.prepare('SELECT profile_urn, user_id FROM linkedin_links').all<LinkedInLinkRow>();
  return new Map(results.map((r) => [r.profile_urn, r.user_id]));
}

export async function getLinkForUser(db: D1Database, userId: number): Promise<(LinkedInLinkRow & LinkedInProfileRow) | null> {
  return db
    .prepare(
      `SELECT l.*, p.first_name, p.last_name, p.public_identifier, p.last_seen
       FROM linkedin_links l JOIN linkedin_profiles p USING (profile_urn)
       WHERE l.user_id = ?`,
    )
    .bind(userId)
    .first<LinkedInLinkRow & LinkedInProfileRow>();
}

/**
 * Link one profile to one player. Both sides are unique: relinking a player
 * moves them, and a profile already claimed by somebody else is refused —
 * that is the only way two players could end up with the same LinkedIn.
 */
export async function link(
  db: D1Database,
  params: { profileUrn: string; userId: number; source: LinkedInLinkRow['source'] },
): Promise<'linked' | 'taken'> {
  const owner = await db
    .prepare('SELECT user_id FROM linkedin_links WHERE profile_urn = ?')
    .bind(params.profileUrn)
    .first<{ user_id: number }>();
  if (owner && owner.user_id !== params.userId) return 'taken';
  await db.batch([
    db.prepare('DELETE FROM linkedin_links WHERE user_id = ?').bind(params.userId),
    db
      .prepare('INSERT INTO linkedin_links (profile_urn, user_id, source, linked_at) VALUES (?, ?, ?, ?)')
      .bind(params.profileUrn, params.userId, params.source, nowSeconds()),
  ]);
  return 'linked';
}

export async function unlink(db: D1Database, userId: number): Promise<boolean> {
  const r = await db.prepare('DELETE FROM linkedin_links WHERE user_id = ?').bind(userId).run();
  return r.meta.changes === 1;
}

export async function getProfileByPublicIdentifier(
  db: D1Database,
  publicIdentifier: string,
): Promise<LinkedInProfileRow | null> {
  return db
    .prepare('SELECT * FROM linkedin_profiles WHERE lower(public_identifier) = lower(?)')
    .bind(publicIdentifier)
    .first<LinkedInProfileRow>();
}

/** Profiles the leaderboard shows that belong to nobody yet. */
export async function getUnlinkedProfiles(db: D1Database): Promise<LinkedInProfileRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.* FROM linkedin_profiles p
       LEFT JOIN linkedin_links l USING (profile_urn)
       WHERE l.profile_urn IS NULL
       ORDER BY p.last_seen DESC`,
    )
    .all<LinkedInProfileRow>();
  return results;
}

/* ---------- links asked for by slug, before the profile has been seen ---------- */

export interface LinkedInPendingRow {
  public_identifier: string;
  user_id: number;
  source: 'self' | 'admin';
  created_at: number;
}

/** One pending slug per player; asking again replaces it. */
export async function addPending(
  db: D1Database,
  params: { publicIdentifier: string; userId: number; source: LinkedInPendingRow['source'] },
): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM linkedin_pending WHERE user_id = ?').bind(params.userId),
    db
      .prepare(
        'INSERT OR REPLACE INTO linkedin_pending (public_identifier, user_id, source, created_at) VALUES (?, ?, ?, ?)',
      )
      .bind(params.publicIdentifier.toLowerCase(), params.userId, params.source, nowSeconds()),
  ]);
}

export async function getPendingForUser(db: D1Database, userId: number): Promise<LinkedInPendingRow | null> {
  return db.prepare('SELECT * FROM linkedin_pending WHERE user_id = ?').bind(userId).first<LinkedInPendingRow>();
}

export async function clearPending(db: D1Database, userId: number): Promise<boolean> {
  const r = await db.prepare('DELETE FROM linkedin_pending WHERE user_id = ?').bind(userId).run();
  return r.meta.changes === 1;
}

/**
 * Turn every pending slug whose profile has now been seen into a real link.
 * Returns what got linked so the caller can tell the players.
 */
export async function resolvePending(
  db: D1Database,
): Promise<Array<{ userId: number; profile: LinkedInProfileRow }>> {
  const { results } = await db
    .prepare(
      `SELECT pe.user_id, pe.source, pr.*
       FROM linkedin_pending pe
       JOIN linkedin_profiles pr ON lower(pr.public_identifier) = pe.public_identifier`,
    )
    .all<LinkedInPendingRow & LinkedInProfileRow>();

  const linked: Array<{ userId: number; profile: LinkedInProfileRow }> = [];
  for (const row of results) {
    const result = await link(db, { profileUrn: row.profile_urn, userId: row.user_id, source: row.source });
    await clearPending(db, row.user_id);
    if (result === 'linked') linked.push({ userId: row.user_id, profile: row });
  }
  return linked;
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM linkedin_meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO linkedin_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}
