#!/usr/bin/env bash
# Runs a command with Cloudflare credentials. CI (and anyone who exports
# CLOUDFLARE_API_TOKEN) passes straight through; locally the scoped token is
# pulled from 1Password via .env.op, so no `wrangler login` session is needed.
#
#   bash scripts/cf.sh wrangler deploy      (or: pnpm cf deploy)
set -euo pipefail
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then exec "$@"; fi
if ! command -v op >/dev/null; then
  echo "1Password CLI (op) not found: brew install 1password-cli, or export CLOUDFLARE_API_TOKEN." >&2
  exit 1
fi
exec op run --env-file="$(cd "$(dirname "$0")/.." && pwd)/.env.op" -- "$@"
