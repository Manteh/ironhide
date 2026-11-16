#!/bin/bash
# Build a self-contained Orbie.app (Node, libmpv, ffmpeg and ffprobe inside) and zip it for a GitHub release.
# Needs, on the build Mac only: Rust + tauri-cli, Homebrew mpv and ffmpeg, Node. The people installing need nothing.
#   mac/scripts/release.sh            -> dist/Orbie-<version>-arm64.zip
set -euo pipefail
cd "$(dirname "$0")/.."            # mac/
ROOT="$(cd .. && pwd)"
# one version for everything: package.json (tauri.conf.json points at it); Cargo.toml must match
VERSION=$(node -p "require('$ROOT/package.json').version")
CARGO_VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
[ "$VERSION" = "$CARGO_VERSION" ] || { echo "✕ package.json is $VERSION but src-tauri/Cargo.toml is $CARGO_VERSION: make them the same" >&2; exit 1; }
ARCH=$(uname -m)
APP="$PWD/src-tauri/target/release/bundle/macos/Orbie.app" # absolute: the smoke test runs from inside the bundle
OUT="$ROOT/dist"

echo "▸ building the app"
cargo tauri build --bundles app >/dev/null

RES="$APP/Contents/Resources/ironhide"
BIN="$RES/bin"
mkdir -p "$BIN"

echo "▸ installing only what the service needs into the app"
DEPS=$(node scripts/daemon-deps.mjs "$ROOT/src/daemon.js")
STAGE=$(mktemp -d)
node -e '
  const [root, stage, ...want] = process.argv.slice(1), pkg = require(root + "/package.json");
  const deps = Object.fromEntries(want.map((d) => { if (!pkg.dependencies[d]) throw new Error(d + " is imported but not in package.json"); return [d, pkg.dependencies[d]]; }));
  require("fs").writeFileSync(stage + "/package.json", JSON.stringify({ name: "ironhide-app-deps", private: true, type: "module", dependencies: deps }));
' "$ROOT" "$STAGE" $DEPS
cp "$ROOT/package-lock.json" "$STAGE/" 2>/dev/null || true
(cd "$STAGE" && npm install --omit=dev --no-audit --no-fund --silent >/dev/null)
rm -rf "$RES/node_modules" && mv "$STAGE/node_modules" "$RES/node_modules" && rm -rf "$STAGE"
echo "  $(du -sh "$RES/node_modules" | cut -f1) of packages ($DEPS)"

echo "▸ saving the Updates numbers (the app has no git inside it)"
(cd "$ROOT" && node src/update-stats.js) > "$RES/updates-stats.json"

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
# start the bundled service with an empty home (no keys, no friends) and ask it if it's alive
SMOKE_HOME=$(mktemp -d); SMOKE_PORT=7699
(cd "$RES" && HOME="$SMOKE_HOME" IRONHIDE_HOME="$SMOKE_HOME/.config/ironhide" IRONHIDE_PORT=$SMOKE_PORT IRONHIDE_NO_BRIDGE=1 IRONHIDE_BIN="$BIN" PATH="$BIN:/usr/bin:/bin" \
  "$BIN/node" src/daemon.js >"$SMOKE_HOME/daemon.log" 2>&1) & SMOKE_PID=$!
ok=0; for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$SMOKE_PORT/api/health" 2>/dev/null | grep -q '"service":"ironhide"' && { ok=1; break; }; sleep 0.2; done
curl -fsS -X POST "http://127.0.0.1:$SMOKE_PORT/api/shutdown" >/dev/null 2>&1 || kill $SMOKE_PID 2>/dev/null
wait $SMOKE_PID 2>/dev/null || true # it was stopped on purpose: a non-zero status here is expected
[ $ok = 1 ] && echo "service ok" || { echo "✕ the bundled service did not start:" >&2; tail -20 "$SMOKE_HOME/daemon.log" >&2; exit 1; }
rm -rf "$SMOKE_HOME"
codesign --verify --deep --strict "$APP" && echo "signature ok"

mkdir -p "$OUT"
ZIP="$OUT/Orbie-$VERSION-$ARCH.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
echo "✓ $ZIP ($(du -h "$ZIP" | cut -f1))"
