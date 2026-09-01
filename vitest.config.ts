import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  test: {
    projects: [
      {
        // Pure functions: parsers, ranking, time, initData. No workerd, fast.
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'], globals: true },
      },
      {
        // D1-backed: cron, ingestion, digest idempotency.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // These override .dev.vars, which wrangler also loads. Verified:
              // tests see this fake token, never the real one — so a missing
              // API stub fails loudly instead of messaging real people.
              bindings: {
                TEST_MIGRATIONS: migrations,
                BOT_TOKEN: '123456789:TESTTESTTESTTESTTESTTESTTESTTESTTES',
                WEBHOOK_SECRET: 'test-secret',
              },
            },
          }),
        ],
        test: { name: 'worker', include: ['test/worker/**/*.test.ts'], globals: true },
      },
    ],
  },
});
