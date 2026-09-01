import { SELF } from 'cloudflare:test';
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
