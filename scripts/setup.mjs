#!/usr/bin/env node
/**
 * One-shot production setup. Everything here needs a Cloudflare login and a bot
 * token, which is why it is a script you run rather than something already done.
 *
 * Safe to re-run: every step checks before it acts.
 */
import { execFileSync, execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const DB_NAME = 'daily-games';
const CONFIG = 'wrangler.jsonc';

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

const step = (n, msg) => console.log(`\n${c.b(`[${n}/8]`)} ${msg}`);
const wrangler = (args, opts = {}) =>
  execFileSync('pnpm', ['exec', 'wrangler', ...args], { encoding: 'utf8', ...opts });

function fail(message, hint) {
  console.error(`\n${c.err('✘')} ${message}`);
  if (hint) console.error(`  ${c.dim(hint)}`);
  process.exit(1);
}

function patchConfig(pattern, replacement, label) {
  const before = readFileSync(CONFIG, 'utf8');
  const after = before.replace(pattern, replacement);
  if (before === after) return false;
  writeFileSync(CONFIG, after);
  console.log(`  ${c.ok('✔')} ${label}`);
  return true;
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  // 1 ────────────────────────────────────────────────────────────── auth
  step(1, 'Checking Cloudflare login');
  const who = wrangler(['whoami'], { stdio: ['ignore', 'pipe', 'ignore'] });
  if (/not authenticated/i.test(who)) {
    fail('Not logged in to Cloudflare.', 'Run: pnpm exec wrangler login');
  }
  console.log(`  ${c.ok('✔')} authenticated`);

  // 2 ─────────────────────────────────────────────────────────── bot token
  step(2, 'Bot token');
  const token = (await rl.question('  Paste the BotFather token: ')).trim();
  if (!/^\d+:[\w-]+$/.test(token)) fail('That does not look like a bot token (digits:letters).');

  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
  if (!me.ok) fail(`Telegram rejected the token: ${me.description ?? 'unknown error'}`);
  const username = me.result.username;
  console.log(`  ${c.ok('✔')} @${username}`);

  patchConfig(/"BOT_USERNAME": "[^"]*"/, `"BOT_USERNAME": "${username}"`, `BOT_USERNAME set to ${username}`);

  // 3 ───────────────────────────────────────────────────────────────── D1
  step(3, 'D1 database');
  let databases = [];
  try {
    databases = JSON.parse(wrangler(['d1', 'list', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    /* no databases yet */
  }
  let db = databases.find((d) => d.name === DB_NAME);
  if (db) {
    console.log(`  ${c.warn('•')} ${DB_NAME} already exists, reusing it`);
  } else {
    wrangler(['d1', 'create', DB_NAME], { stdio: 'inherit' });
    databases = JSON.parse(wrangler(['d1', 'list', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }));
    db = databases.find((d) => d.name === DB_NAME);
    if (!db) fail('Created the database but could not read its id back.');
  }
  patchConfig(/"database_id": "PLACEHOLDER_RUN_wrangler_d1_create"/, `"database_id": "${db.uuid}"`, `database_id ${db.uuid}`);

  // 4 ─────────────────────────────────────────────────────────── migrations
  step(4, 'Applying the schema');
  wrangler(['d1', 'execute', DB_NAME, '--remote', '--file=migrations/0001_init.sql', '-y'], {
    stdio: 'inherit',
  });

  // 5 ────────────────────────────────────────────────────────────── secrets
  step(5, 'Secrets');
  const webhookSecret = randomBytes(32).toString('hex');
  wrangler(['secret', 'put', 'BOT_TOKEN'], { input: token, stdio: ['pipe', 'inherit', 'inherit'] });
  wrangler(['secret', 'put', 'WEBHOOK_SECRET'], {
    input: webhookSecret,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  // 6 ─────────────────────────────────────────────────────────────── deploy
  step(6, 'Building and deploying');
  execSync('pnpm run build:web', { stdio: 'inherit' });
  const out = wrangler(['deploy', '--env='], { stdio: ['ignore', 'pipe', 'inherit'] });
  process.stdout.write(out);
  const url = out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i)?.[0];
  if (!url) fail('Deployed, but could not find the Worker URL in the output.', 'Read it from the deploy output above and register the webhook by hand.');

  // 7 ────────────────────────────────────────────────────────────── webhook
  step(7, 'Registering the webhook');
  const hook = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${url}/telegram/webhook`,
      secret_token: webhookSecret,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    }),
  }).then((r) => r.json());
  if (!hook.ok) fail(`setWebhook failed: ${hook.description}`);
  console.log(`  ${c.ok('✔')} ${url}/telegram/webhook`);

  // 8 ───────────────────────────────────────────────────────── what is left
  step(8, 'One manual step left');
  console.log(`
  The leaderboard button needs a Mini App, which only BotFather can create:

    1. Message @BotFather → ${c.b('/newapp')} → pick @${username}
    2. Give it a title, description and a 640x360 image
    3. Web App URL: ${c.b(url)}
    4. It asks for a ${c.b('short name')} — copy it

  Then finish with:

    ${c.b(`sed -i '' 's/"MINIAPP_SHORT_NAME": ""/"MINIAPP_SHORT_NAME": "<short name>"/' ${CONFIG}`)}
    ${c.b('pnpm run deploy')}

  ${c.dim('Until then the bot works fine — there is simply no leaderboard button.')}

  ${c.ok('Try it now:')} open https://t.me/${username} and send /start
`);
} finally {
  rl.close();
}
