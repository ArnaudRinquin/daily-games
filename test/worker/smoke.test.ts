import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, expect, test } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

test('migrations apply and schema exists', async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all<{ name: string }>();
  const names = results.map((r) => r.name);
  expect(names).toContain('players');
  expect(names).toContain('reminders');
  expect(names).toContain('digests');
});
