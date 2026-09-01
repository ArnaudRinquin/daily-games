# Daily games bot

Telegram bot for a group of friends who play daily puzzle games. It reminds each
player privately, collects results by DM, and posts a ranked leaderboard to the
group at the end of the day.

Runs entirely on the Cloudflare free tier: one Worker holds the bot webhook, the
cron, the API and the Mini App.

## Commands

```bash
pnpm test           # unit (pure) + worker (workerd + D1) projects
pnpm images         # regenerate the BotFather PNGs from their HTML sources
pnpm typecheck      # Worker and Mini App
pnpm build:web      # Mini App -> web/dist, served by the assets binding
pnpm exec wrangler deploy --dry-run
```

## Setup

```bash
pnpm install
pnpm exec wrangler login   # interactive, opens a browser
pnpm bootstrap             # everything else
```

`pnpm bootstrap` is safe to re-run. It checks your Cloudflare login, validates the
bot token against `getMe`, creates the D1 database and writes its id into
`wrangler.jsonc`, applies the schema, generates and stores `WEBHOOK_SECRET`,
builds the Mini App, deploys, and registers the webhook with
`allowed_updates` scoped to what the bot actually handles.

It leaves exactly one manual step, because only BotFather can do it:

1. @BotFather → `/newapp` → pick your bot
2. Web App URL: the `workers.dev` URL the script prints
3. Copy the **short name** it gives you into `MINIAPP_SHORT_NAME` in
   `wrangler.jsonc`, then `pnpm run deploy`

Until that is done the bot works normally; there is simply no leaderboard
button. `MINIAPP_SHORT_NAME` has **no default on purpose**: an unregistered
short name produces a `t.me` link that silently resolves to nothing, which
reads as a broken bot rather than an unfinished setup.

> Named `bootstrap`, not `setup`: `pnpm setup` is a built-in pnpm command that
> configures pnpm itself and edits your shell profile, and built-ins shadow
> scripts. Same reason the deploy script is invoked as `pnpm run deploy` —
> `pnpm deploy` is also built in.

### Doing it by hand

```bash
# BOT_USERNAME first: every group invite link is built from it, and a wrong
# value posts links that look right and open nothing. The Worker refuses to
# start while it is empty.
#   wrangler.jsonc -> "BOT_USERNAME": "your_bot"

pnpm exec wrangler d1 create daily-games      # paste database_id into wrangler.jsonc
pnpm db:remote                                 # schema
pnpm exec wrangler secret put BOT_TOKEN
pnpm exec wrangler secret put WEBHOOK_SECRET
pnpm run deploy                                # note the workers.dev URL
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<worker>/telegram/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```

### Dev

Webhooks need a public URL, so dev is a second BotFather bot deployed to its own
Worker rather than a tunnel:

```bash
cp .dev.vars.example .dev.vars     # for `wrangler dev` only
pnpm exec wrangler deploy --env dev
pnpm exec wrangler secret put BOT_TOKEN --env dev
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
offered, never linked in a reminder, and never counted in a ranking field. The
same filter also drops rows for games that were once selectable and have since
been retired, so `player_games` never has to be migrated.

**La Table des Savoirs is two games, not one.** The site ships a daily quiz at
two difficulties and its own code maps them (`facile -> "Abordable"`,
`difficile -> "Expert"` — note the Expert route is `/difficile`). Ranking them
together would reward picking the hard quiz over playing well, so they are
separate catalog entries and the tier word in the share text decides which one
claims a result. Its third mode, "Événement", is deliberately unmatched: no
sample, so it lands in the corpus rather than being scored as one of these two.

**A new game reaches nobody who already signed up.** `player_games` is seeded at
signup, so shipping a parser is only half the job — run
`POST /admin/offer-game?game=<id>` once afterwards. It is per-game and explicit
on purpose: a blanket resync would silently re-add games people turned off.

**A failed Wordle still scores.** `X/6` stores as 7, so it sorts below every
success — but it still earns a rank, and therefore points. Turning up and
failing beats not turning up, which is the point of the ranking.

**Every parser is now verified against real pasted text.** `test/unit/real-samples.test.ts`
holds it verbatim; if a case there fails, the parser is wrong, not the fixture.
The share format differs by platform — web puts the score after a pipe on the
header line, the iOS app puts it on the next line with no pipe — and both are
covered.

**Unverified: the already-started deep link.** Whether `?start=g<payload>`
delivers its payload to a user who has *already* pressed Start is untested. It
decides whether `/join` stays necessary. Test it on the first real second group.

**Fermi scores are a mean error factor**, and 1.00× is perfect — already
lower-is-better, so no negation. The parser anchors on the word `score` because
the per-question lines carry the same `N.NN×` shape as the total.

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

**The webhook fails closed and answers 200.** A plain `provided !== expected`
compares `undefined` to `undefined` when the secret is unset — false — so an
unconfigured Worker would accept every request. Both sides must be present.
Separately, grammY does *not* route errors through `bot.catch` in webhook mode,
so the route catches: every DB write commits before a reply is attempted, and
ingestion is idempotent, so a non-2xx would only make Telegram redeliver an
update with nothing left to do.

**`botInfo` is supplied, not fetched.** Otherwise grammY calls `getMe` on every
single update: a wasted subrequest against the free tier's 50, and one more way
for an update to fail. The trade is that `BOT_USERNAME` becomes load-bearing —
it is what every group deep link is built from — so the Worker throws while it
is empty rather than posting links that open nothing.

**Ingestion is one transaction.** The message log and the score writes go in a
single `db.batch`, so a message is never recorded as parsed without its scores
landing too.
