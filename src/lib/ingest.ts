import { gameById, parseAll } from '../games/registry';
import { linkedinGames } from '../games/linkedin';
import { getLinkForUser } from '../db/linkedin';
import { logMessageStatement } from '../db/messages';

const LINKEDIN_GAME_IDS = new Set(linkedinGames.map((g) => g.id));
import { scoreStatements } from '../db/scores';
import { playDate } from './time';

/**
 * Appended to the ack when somebody pastes a LinkedIn result by hand while
 * the import could have done it for them. Empty once they are linked, or when
 * no LinkedIn game is in the paste, or when the import is not configured.
 */
export async function linkedinNudge(
  env: { DB: D1Database; LI_AT?: string | undefined },
  userId: number,
  matches: readonly { game: string }[],
): Promise<string> {
  if (!env.LI_AT) return '';
  if (!matches.some((m) => LINKEDIN_GAME_IDS.has(m.game))) return '';
  if (await getLinkForUser(env.DB, userId)) return '';
  return (
    '\n\nYou don\'t have to share LinkedIn results by hand. Send me your profile, ' +
    '/linkedin https://www.linkedin.com/in/your-name, and I\'ll fetch them myself from now on.'
  );
}

export function ackLines(matches: readonly { game: string; display: string }[]): string {
  return matches
    .map((m) => {
      const game = gameById(m.game);
      return `✅ ${game ? `${game.emoji} ${game.label}` : m.game} — ${m.display}`;
    })
    .join('\n');
}

/**
 * Writes the message log and any scores in ONE D1 batch, which is one
 * transaction. Returns false when this exact message was already stored, i.e.
 * a redelivered webhook or a Shortcut run twice.
 */
export async function store(
  db: D1Database,
  params: {
    chatId: number;
    tgMessageId: number;
    userId: number;
    sentAt: number;
    text: string;
  },
): Promise<{ isNew: boolean; matches: ReturnType<typeof parseAll>; date: string }> {
  const matches = parseAll(params.text);
  const date = playDate(new Date(params.sentAt * 1000));

  const [logResult] = await db.batch([
    logMessageStatement(db, {
      chatId: params.chatId,
      tgMessageId: params.tgMessageId,
      userId: params.userId,
      sentAt: params.sentAt,
      text: params.text,
      matchedGames: matches.map((m) => m.game),
    }),
    ...scoreStatements(db, params.userId, date, params.text, matches),
  ]);

  return { isNew: logResult?.meta.changes === 1, matches, date };
}

/**
 * A message id for text that never went through Telegram. The log table keys
 * on (chat, message id), so an HTTP submission needs one that cannot collide
 * with a real Telegram id: those are positive, this is always negative.
 *
 * Hashing text + day makes a repeat submission of the same result a no-op,
 * which is what a Shortcut tapped twice deserves. FNV-1a, 32-bit.
 */
export function syntheticMessageId(text: string, date: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${date}\n${text}`) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return -(h + 1);
}
