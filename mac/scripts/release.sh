#!/bin/bash
# Build a self-contained IronHide.app (Node, libmpv, ffmpeg and ffprobe inside) and zip it for a GitHub release.
# Needs, on the build Mac only: Rust + tauri-cli, Homebrew mpv and ffmpeg, Node. The people installing need nothing.
#   mac/scripts/release.sh            -> dist/IronHide-<version>-arm64.zip
set -euo pipefail
cd "$(dirname "$0")/.."            # mac/
ROOT="$(cd .. && pwd)"
VERSION=$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
ARCH=$(uname -m)
APP="src-tauri/target/release/bundle/macos/IronHide.app"
OUT="$ROOT/dist"

echo "▸ building the app"
cargo tauri build --bundles app >/dev/null

RES="$APP/Contents/Resources/ironhide"
BIN="$RES/bin"
mkdir -p "$BIN"

echo "▸ bundling Node $(node -v)"
cp "$(command -v node)" "$BIN/node"
# only this Mac's architecture: a universal Node is twice the size
if lipo -info "$BIN/node" | grep -q "are:"; then lipo -thin "$ARCH" "$BIN/node" -output "$BIN/node.thin" && mv "$BIN/node.thin" "$BIN/node"; fi
chmod 755 "$BIN/node"

echo "▸ bundling ffmpeg and ffprobe"
for t in ffmpeg ffprobe; do cp "$(python3 -c "import os,shutil;print(os.path.realpath(shutil.which('$t')))")" "$BIN/$t"; chmod 755 "$BIN/$t"; done

echo "▸ bundling libmpv and its libraries"
python3 scripts/bundle_libs.py "$APP" "$BIN/ffmpeg" "$BIN/ffprobe"
codesign --force --sign - "$BIN/node"
codesign --force --deep --sign - "$APP"

echo "▸ checking it runs on its own"
"$BIN/ffmpeg" -hide_banner -version | head -1
"$BIN/node" -e "console.log('node', process.version)"
codesign --verify --deep --strict "$APP" && echo "signature ok"

mkdir -p "$OUT"
ZIP="$OUT/IronHide-$VERSION-$ARCH.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
echo "✓ $ZIP ($(du -h "$ZIP" | cut -f1))"
