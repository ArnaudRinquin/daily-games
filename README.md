# Daily games bot

Telegram bot for a group of friends who play daily puzzle games. It reminds each
player privately, collects results by DM, and posts a ranked leaderboard to the
group at the end of the day.

Runs entirely on the Cloudflare free tier: one Worker holds the bot webhook, the
cron, the API and the Mini App.

## Commands

```bash
pnpm test           # unit (pure) + worker (workerd + D1) projects
pnpm typecheck
pnpm exec wrangler deploy --dry-run
```

## Setup

Steps 2 and 5 fail silently if skipped.

1. BotFather `/newbot` → keep the token.
2. BotFather `/newapp` → point at the Workers URL. Web-app buttons do nothing
   until this exists.
3. `wrangler d1 create daily-games` → paste `database_id` into `wrangler.jsonc`
   → `pnpm db:remote`.
4. `wrangler secret put BOT_TOKEN`, `wrangler secret put WEBHOOK_SECRET`.
5. `wrangler deploy`, then register the webhook **with the secret**:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<worker>/telegram/webhook" \
     -d "secret_token=<WEBHOOK_SECRET>"
   ```

Set `BOT_USERNAME` in `wrangler.jsonc` to match the bot.

### Dev

Webhooks need a public URL, so dev is a second BotFather bot deployed to its own
Worker rather than a tunnel:

```bash
wrangler deploy --env dev
wrangler secret put BOT_TOKEN --env dev
```

## Design notes

Decisions that are not obvious from the code.

**Everything goes through `lib/time.ts`.** Cloudflare cron is UTC-only and
France shifts between UTC+1 and UTC+2. Nothing derives a date or hour from UTC.
The day rolls over at **04:00 Paris**, so a result pasted at 00:30 counts for the
day just played.

**Parsers fail strictly.** A message that `detect()` matches but `parse()` cannot
read is dropped rather than guessed, leaving it in the calibration corpus:

```sql
SELECT text FROM messages WHERE matched_games IS NULL ORDER BY sent_at DESC;
```

Because `scores.raw` keeps the original message, a fixed parser can be replayed
over history.

**Hidden games.** A game whose parser is a placeholder (`hidden: true`) is never
offered, never linked in a reminder, and never counted in a ranking field. Fermi
is hidden until someone pastes a real sample.

**Ranking.** Field size for `(group, game, date)` is the number of members who
*selected* that game, played or not — so a quiet day is worth as much as a busy
one. Standard competition ranking; `points = field − rank + 1`. Absent players
are listed but unscored.

**Ranking fields are computed from today's roster.** Historical boards use
current membership and current game selections, so someone deselecting Zip
retroactively shrinks every past Zip field. Acceptable for a small group;
fixing it would mean snapshotting the field per day in its own table.

**Idempotency.** Cron delivery is at-least-once and fires four times an hour;
completion and cutoff can both fire for the same day. `reminders` and `digests`
are claim tables — claim first, send second, release the claim if the send
throws so the next tick retries.

**Ingestion is one transaction.** The message log and the score writes go in a
single `db.batch`, so a message is never recorded as parsed without its scores
landing too.
