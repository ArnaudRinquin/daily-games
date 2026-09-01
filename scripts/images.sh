#!/usr/bin/env bash
# Regenerates the PNG assets from their HTML sources.
#   miniapp-cover.png  640x360  — BotFather /newapp
#   bot-icon.png       512x512  — BotFather /setuserpic (Telegram crops to a circle)
# Rendered at 2x and downscaled so text and edges stay crisp.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

render() { # name width height
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size="$2,$3" --screenshot="$TMP/$1.png" "file://$PWD/assets/$1.html" 2>/dev/null
  sips -z "$3" "$2" "$TMP/$1.png" --out "assets/$1.png" >/dev/null
  printf '%-20s %sx%s\n' "assets/$1.png" "$2" "$3"
}

render miniapp-cover 640 360
render bot-icon 512 512
