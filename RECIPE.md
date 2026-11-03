# Recipe: Daily Games

How this project is built, and how to build your own. For usage and operating
this instance, see [README.md](README.md).

## 1. Pitch

A Telegram bot for a small group of friends who play daily puzzle games
(LinkedIn games, Wordle, Waffle, Fermi…). It DMs each player a reminder,
collects pasted share text (DM, group chat, or an iPhone Shortcut), parses it
into scores, imports LinkedIn results automatically, and posts one ranked
leaderboard to the group per day, plus a Telegram Mini App for
today / week / all-time standings. Runs on the Cloudflare free tier as a single
Worker.

## 2. Ingredients

**Accounts / services**
- Cloudflare account: Workers (code + static assets), D1 (SQLite database).
- Telegram bot from BotFather (token, `/newapp` Mini App, `/setprivacy`, `/setuserpic`).
- GitHub repo: CI, auto-deploy, and the external cron (Actions).
- Optional: a LinkedIn account (the "captain") connected to every player, for the LinkedIn import.
- Optional: macOS with the `shortcuts` CLI to sign the iPhone Shortcut; Chrome + `sips` for `scripts/images.sh`.

**Tools / runtime**
- Node 24 (`.nvmrc`), pnpm 10 (pinned in `package.json` `packageManager`; CI needs it).
- TypeScript, `wrangler`, `hono` (HTTP routing), `grammy` (Telegram bot), Vite + React (Mini App), Vitest + `@cloudflare/vitest-pool-workers` (tests in workerd with real D1).

**Secrets (Worker, via `wrangler secret put`)**
| Name | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram Bot API token; also keys Mini App `initData` HMAC |
| `WEBHOOK_SECRET` | Telegram webhook `secret_token`, and the `X-Admin-Secret` for `/admin/*` |
| `LI_AT` | Captain's LinkedIn `li_at` cookie (optional; unset = no import) |
| `LI_JSESSIONID` | Captain's LinkedIn `JSESSIONID` cookie, echoed as CSRF token (optional) |

**Vars (`wrangler.jsonc` `vars`)**: `BOT_USERNAME`, `MINIAPP_SHORT_NAME`,
`PUBLIC_URL`, `TZ_NAME`, `CUTOFF_HOUR`, `DAY_ROLLOVER_HOUR`.

**GitHub Actions**
| Name | Kind | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | `ci.yml` deploy job |
| `ADMIN_SECRET` | secret | `cron.yml`; must equal the Worker's `WEBHOOK_SECRET` |
| `WORKER_URL` | variable | `cron.yml`; base URL of the deployed Worker |

Local dev: `.dev.vars` with `BOT_TOKEN`, `WEBHOOK_SECRET` (note: `.dev.vars.example`
is matched by `.gitignore`'s `.dev.vars.*`, so it is not in the repo).

## 3. Architecture

```
 Telegram ──webhook──▶ ┌──────────────── Cloudflare Worker (src/index.ts, Hono) ─────────────┐
 (DM + group msgs)     │ /telegram/webhook  grammY bot: onboarding, groups, ingest, /linkedin │
 iPhone Shortcut ────▶ │ /api/ingest/:token  share text over HTTP (token = auth)              │
 Mini App (web/) ────▶ │ /api/*              leaderboard, auth = Telegram initData HMAC       │
 GitHub Actions cron ▶ │ /admin/run-cron     reminders, digests, LinkedIn import              │
 (Cloudflare cron,     │ /admin/*            replay, offer-game, linkedin mapping             │
  configured, dead) ─▶ │ scheduled()         same runCron()                                   │
                       │ static assets       web/dist (SPA)                                   │
                       └────────────┬──────────────────────┬──────────────────────────────────┘
                                    ▼                      ▼
                                D1 (SQLite)       Telegram Bot API, LinkedIn Voyager API
```

Data flow: share text → `parseAll()` (every game's `detect` then `parse`) →
one `db.batch` writes the message log + scores → completion check → if every
active member of a group has a score for every selected game, post the digest
immediately. Cron covers reminders, the 21:00 cutoff digest, yesterday's
catch-up, and the LinkedIn import.

**Key files**
- `src/index.ts`: routing, webhook auth, `scheduled` handler.
- `src/games/types.ts`: `GameParser` contract (`detect`, `parse`, lower-is-better `value`, `display`). `src/games/registry.ts`: catalog + `parseAll`. One file per game, e.g. `src/games/waffle.ts`.
- `src/lib/time.ts`: all dates/hours in Europe/Paris, 04:00 rollover.
- `src/lib/ranking.ts`, `src/lib/digest.ts`: per-game daily rank → points, totals/averages, digest rendering.
- `src/lib/ingest.ts`: `store()` (single-batch write), `syntheticMessageId()` for HTTP submissions.
- `src/lib/initdata.ts`: Mini App auth via `crypto.subtle`.
- `src/lib/voyager.ts`, `src/cron/linkedin.ts`: LinkedIn import.
- `src/lib/deeplink.ts`: group chat id in the `/start` payload (base64url).
- `src/api/admin.ts`: `runCron()` and operator endpoints. `src/api/ingest.ts`: Shortcut endpoint. `src/api/leaderboard.ts`, `src/api/auth.ts`: Mini App API.
- `src/bot/*`: grammY handlers. `src/db/*`: one module per table group.
- `src/cron/reminders.ts`, `src/cron/digest.ts`.
- `migrations/0001_init.sql` … `0006_linkedin_pending.sql`: schema.
- `web/src/*`: Mini App (sends `Authorization: tma <initData>`). `web/public/dailygames.shortcut`: signed Shortcut.
- `scripts/setup.mjs` (`pnpm bootstrap`): one-shot provisioning.
- `.github/workflows/ci.yml` (typecheck, test, build; deploy on main), `.github/workflows/cron.yml` (external scheduler).
- `test/unit/real-samples.test.ts`: verbatim real share texts, the parser spec.

## 4. Build your own

1. **Scaffold.** `pnpm init`, add deps from `package.json`. Copy `tsconfig.json`, `web/tsconfig.json`, `web/vite.config.ts`, `vitest.config.ts`. Pin Node (`.nvmrc`) and pnpm (`packageManager`).
2. **Config.** Copy `wrangler.jsonc`; **replace or remove** `account_id`, `database_id` (both prod and `env.dev` — they currently share one id), `BOT_USERNAME`, `MINIAPP_SHORT_NAME`, `PUBLIC_URL`. Keep `assets.run_worker_first` so `/api/*`, `/telegram/*`, `/admin/*`, `/health` hit the Worker and everything else serves the SPA.
3. **Schema.** Write migrations modelled on `migrations/`: `players`, `player_games`, `groups`, `memberships`, `messages` (keyed `(chat_id, tg_message_id)`), `scores` (unique `(user_id, game, play_date)`, keep `raw`), claim tables `reminders` and `digests`, `cron_runs`.
4. **Time.** Write `lib/time.ts` first; nothing else touches UTC dates.
5. **Parsers.** Implement `GameParser` per game. Collect real share texts (web *and* iOS app) into a test file before writing the regex. Normalise so lower is better; negate higher-is-better scores.
6. **Bot.** `createBot(env)` with supplied `botInfo`; handlers for `/start <group payload>` onboarding, `my_chat_member` (group join → post invite link), DM ingest, group ingest, settings keyboards.
7. **Ingest + digest.** `store()` in one batch; after each store, check completion and post via the `digests` claim table. Ranking: `points = field − rank + 1`, field = everyone who selected the game.
8. **Cron.** `runCron()`: insert `cron_runs` row first, import, then reminders + digests. Expose it as `scheduled()` and `POST /admin/run-cron`.
9. **Mini App.** Vite + React in `web/`, built to `web/dist`, served as Worker assets. API verifies `initData`.
10. **Tests.** Unit project for pure code; worker project with `cloudflareTest` + `readD1Migrations` and a fake `BOT_TOKEN` binding.
11. **Deploy.** `pnpm exec wrangler login`, then `pnpm bootstrap` (validates token via `getMe`, creates D1, applies `0001`, sets `BOT_TOKEN`/`WEBHOOK_SECRET`, builds, deploys, calls `setWebhook` with `allowed_updates: ['message','callback_query','my_chat_member']`). Then apply later migrations by hand (see gotchas).
12. **BotFather.** `/newapp` → Worker URL → put short name in `MINIAPP_SHORT_NAME`, redeploy. `/setprivacy` → Disable, then remove and re-add the bot to each group. `/setuserpic`.
13. **CI + cron.** Copy `.github/workflows/ci.yml` and `cron.yml`; set `CLOUDFLARE_API_TOKEN`, `ADMIN_SECRET`, `WORKER_URL`.
14. **Optional.** LinkedIn: `wrangler secret put LI_AT` / `LI_JSESSIONID`. Shortcut: build plist, `shortcuts sign --mode anyone`, put in `web/public/`.

## 5. Design decisions and gotchas

**Scheduling**
- Cloudflare Cron Triggers never fired on this account (registered via API, handler works over HTTP, `* * * * *` equally silent). Still configured; GitHub Actions `cron.yml` POSTs `/admin/run-cron?source=external` instead.
- GitHub's scheduler is best-effort: two runs in six hours observed; `*/5` was no better than `*/15` (high-frequency schedules deprioritised). Public repos' scheduled workflows are disabled after 60 days without activity.
- So the scheduler is off the critical path: digest posts on completion at ingest time; reminders fire at *or after* their hour (never past the cutoff); a digest missed overnight is caught up on the next tick (only if someone played).
- Claim tables (`reminders`, `digests`): claim first, send, release on throw. Running several schedulers is harmless.
- `cron_runs` row is written *before* the work (counts `-1`), otherwise a crashing tick is indistinguishable from no tick. Cron trigger changes take up to 15 min to propagate.

**Deploy / DB**
- CI deploys code on push to main; D1 migrations stay manual. In prod, `wrangler d1 migrations apply` fails here; apply each file with `wrangler d1 execute daily-games --remote --file=migrations/000N_….sql`. `pnpm bootstrap` and `pnpm db:remote` only run `0001_init.sql`.
- `account_id` pinned in `wrangler.jsonc` so multi-account logins and CI target the right account.
- Name the script `bootstrap`, not `setup` (`pnpm setup` is a pnpm built-in); call `pnpm run deploy`, not `pnpm deploy`.

**Telegram**
- Webhook fails closed: `!expected || !provided || provided !== expected` (undefined === undefined trap). Always answer 200 on handler errors: grammY doesn't use `bot.catch` in webhook mode, writes already committed, ingest is idempotent.
- Supply `botInfo` so grammY doesn't call `getMe` per update (free tier: 50 subrequests). Consequence: `BOT_USERNAME` must be right; Worker throws if unset because deep links are built from it.
- Mini App `initData`: exclude only `hash` from the data-check string; `signature` is signed. Excluding it broke every launch.
- Group ingest needs privacy mode off *and* re-adding the bot (not retroactive). Players seen only in groups are created inactive (bot can't DM someone who never started it).
- Ingestion is one transaction: message log + scores in a single `db.batch`, so a message is never marked parsed without its scores.
- Telegram message ids are per chat: key `messages` on `(chat_id, tg_message_id)` (migration `0003`).
- Settings keyboards are DM-only: in a group anyone can tap, and callbacks key on the tapper. `/board` in a group doesn't claim the day's digest.
- Group membership travels in the `/start` payload (base64url fits Telegram's allowed alphabet), so one tap = DM + join.

**Parsing / scoring**
- Parsers fail strictly: `detect` hit + `parse` null → dropped, message kept in the unmatched corpus. Store any group message that *looks* like a result, even with no parser; `POST /admin/replay` re-scores after a fix.
- Web and iOS share formats differ (score after a pipe vs next line).
- Avoid `-0` when negating (Waffle, Table des Savoirs).
- Fails sort below successes (Wordle `X/6` → 7, Pinpoint no-hit → 6, Waffle `X/5` → 1).
- Field = everyone who selected the game, so a quiet day isn't worth less. Average needs 60% of days since joining. Field uses today's roster (deselecting shrinks past fields).
- New games need `POST /admin/offer-game?game=<id>`: `player_games` is seeded at signup.
- Day rolls over at 04:00 Paris; Cloudflare cron is UTC-only. LinkedIn puzzles roll at midnight LA, so imports are dated by the LA calendar date.
- Shortcut submissions use a negative FNV-style hash of text + day as message id, so double taps are no-ops.

**LinkedIn import**
- No official API: replays the captain's browser session against Voyager GraphQL. `queryId` hashes can rotate on LinkedIn deploys → import silently returns nothing; refresh ids in `src/lib/voyager.ts` from browser traffic.
- `li_at` is httpOnly (copy from DevTools Application tab). 401/403/999/login redirect = lapsed session → captain DM'd once a day.
- No name-based auto-linking: the captain's leaderboard is mostly strangers. Link via `/linkedin <profile url>` (pending slug resolves on first appearance) or admin endpoint.
- Completion = every selected game of every active member, else the first imported Queens would post the board.

## 6. Ways to adapt it

- **Games:** swap parsers in `src/games/`; registry order = display order. Add real samples to `test/unit/real-samples.test.ts` first.
- **Timezone / hours:** `TZ_NAME`, `CUTOFF_HOUR`, `DAY_ROLLOVER_HOUR` vars and `lib/time.ts` constants.
- **Scoring:** `src/lib/ranking.ts` (points formula, 60% eligibility floor).
- **Chat platform:** bot layer is isolated in `src/bot/`; storage, parsing, ranking are platform-free.
- **Scheduler:** delete `cron.yml` if Cloudflare cron works on your account, or use an external pinger (cron-job.org) hitting `/admin/run-cron`.
- **Drop optional parts:** LinkedIn (leave `LI_*` unset), Shortcut (`/api/ingest`), Mini App (leave `MINIAPP_SHORT_NAME` empty; button is gated).
