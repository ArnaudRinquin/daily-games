import { SELF, env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

describe('webhook auth', () => {
  test('rejects a request with no secret header', async () => {
    const res = await SELF.fetch('https://example.com/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  test('rejects a wrong secret', async () => {
    const res = await SELF.fetch('https://example.com/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'not-the-secret',
      },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });
});

test('health check responds', async () => {
  const res = await SELF.fetch('https://example.com/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

describe('webhook fails closed', () => {
  test('rejects when the Worker has no WEBHOOK_SECRET configured', async () => {
    // Comparing an absent header to an absent secret is undefined !== undefined,
    // which is false — an unconfigured Worker must not accept the request.
    const res = await SELF.fetch('https://example.com/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  test('rejects an empty secret header', async () => {
    const res = await SELF.fetch('https://example.com/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': '',
      },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });
});

describe('configuration guards', () => {
  test('BOT_USERNAME is load-bearing and must be set', async () => {
    const { createBot } = await import('../../src/bot');
    // Every group invite link is built from the username, so an empty one has
    // to be loud rather than producing links that open nothing.
    expect(() => createBot({ ...env, BOT_USERNAME: '' } as unknown as typeof env)).toThrow(
      /BOT_USERNAME/,
    );
  });

  test('a configured username builds the bot fine', async () => {
    const { createBot } = await import('../../src/bot');
    expect(() =>
      createBot({ ...env, BOT_USERNAME: 'daily_games_bot' } as unknown as typeof env),
    ).not.toThrow();
  });
});
