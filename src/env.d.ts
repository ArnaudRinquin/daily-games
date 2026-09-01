/// <reference path="../worker-configuration.d.ts" />

// Secrets live in `wrangler secret`, so they are absent from the generated
// bindings. Interface merging adds them to the same Cloudflare.Env type that
// both the Worker handlers and `cloudflare:test` use.
declare namespace Cloudflare {
  interface Env {
    BOT_TOKEN: string;
    WEBHOOK_SECRET: string;
  }
}
