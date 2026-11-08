#!/bin/bash
# Install or update IronHide in one line:
#   curl -fsSL https://raw.githubusercontent.com/Manteh/ironhide/main/install.sh | bash
# Downloads the latest release from GitHub, puts IronHide.app in /Applications (or ~/Applications), and opens it.
# Everything it needs (Node, the mpv player, ffmpeg) is inside the app: nothing else gets installed.
set -euo pipefail

REPO="Manteh/ironhide"
say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "IronHide is a Mac app."
ARCH=$(uname -m)
[ "$ARCH" = "arm64" ] || die "This build is for Apple Silicon Macs (M1 and later)."
MAJOR=$(sw_vers -productVersion | cut -d. -f1)
[ "$MAJOR" -ge 12 ] || die "IronHide needs macOS 12 or later."

say "▸ Finding the latest IronHide…"
API=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest") || die "Could not reach GitHub."
URL=$(printf '%s' "$API" | grep -o "\"browser_download_url\": *\"[^\"]*IronHide-[^\"]*-$ARCH\.zip\"" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
TAG=$(printf '%s' "$API" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$URL" ] || die "No download found in the latest release."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
say "▸ Downloading IronHide $TAG…"
curl -fL --progress-bar "$URL" -o "$TMP/IronHide.zip"
ditto -x -k "$TMP/IronHide.zip" "$TMP"
[ -d "$TMP/IronHide.app" ] || die "The download did not contain IronHide.app."

DEST=/Applications
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
if pgrep -xq ironhide-mac; then
  say "▸ Closing the running IronHide…"
  osascript -e 'quit app "IronHide"' >/dev/null 2>&1 || true
  sleep 2
fi
say "▸ Installing to $DEST…"
rm -rf "$DEST/IronHide.app"
mv "$TMP/IronHide.app" "$DEST/"
# downloaded apps are quarantined by macOS; this one is ad-hoc signed, so clear the flag instead of asking you to
xattr -dr com.apple.quarantine "$DEST/IronHide.app" 2>/dev/null || true

say "✓ IronHide $TAG is installed. Opening it…"
open "$DEST/IronHide.app"
cat <<'EOF'

First time? Add two keys in Settings → Connectors:
  • a debrid account (TorBox recommended) for instant streams
  • a free TMDB key (themoviedb.org/settings/api) for recommendations, search and charts
EOF
