#!/bin/bash
# Open the freshly built Orbie as a brand-new friend: its own home folder, so your real Orbie's data is not touched.
# Quit your own Orbie first (only one can run at a time). Add "reset" to start over as a new person.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/target/release/bundle/macos/Orbie.app"
TEST="$HOME/OrbieTestFriend"

[ -d "$APP" ] || { echo "Build the app first: mac/scripts/release.sh" >&2; exit 1; }
if pgrep -xq ironhide-mac; then echo "Orbie is still open. Quit it (Cmd+Q, or the menu bar icon → Quit), then run this again." >&2; exit 1; fi
[ "${1:-}" = reset ] && rm -rf "$HOME/OrbieTestFriend"
mkdir -p "$TEST"
open -n --env HOME="$TEST" --env IRONHIDE_HOME="$TEST/.config/ironhide" "$APP"
echo "Test friend is open. Its data is in $TEST"
