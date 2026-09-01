#!/usr/bin/env bash
# Regenerates assets/miniapp-cover.png (BotFather /newapp wants exactly 640x360).
# Rendered at 2x and downscaled so text and hairlines stay crisp.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=640,360 --screenshot="$TMP/cover@2x.png" \
  "file://$PWD/assets/miniapp-cover.html" 2>/dev/null
sips -z 360 640 "$TMP/cover@2x.png" --out assets/miniapp-cover.png >/dev/null
rm -rf "$TMP"
sips -g pixelWidth -g pixelHeight assets/miniapp-cover.png | tail -2
