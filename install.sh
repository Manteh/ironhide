#!/bin/bash
# Orbie installer.
#   curl -fsSL https://raw.githubusercontent.com/Manteh/orbie-app/HEAD/install.sh | bash
# While the repo is private (needs the GitHub CLI, logged in):
#   gh api repos/Manteh/orbie-app/contents/install.sh -H "Accept: application/vnd.github.raw" | bash
# Downloads the latest release, puts Orbie.app in /Applications (or ~/Applications) and opens it.
# Everything the app needs (Node, the mpv player, ffmpeg) is inside it: nothing else gets installed.
# IRONHIDE_DEST=<folder> installs somewhere else; IRONHIDE_NO_OPEN=1 skips opening it.
set -uo pipefail
export LC_ALL=en_US.UTF-8

REPO="Manteh/orbie-app"

# ── look ────────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m' D=$'\033[2m' R=$'\033[0m' RED=$'\033[38;2;255;105;97m' OK=$'\033[38;2;48;209;88m'
  W=$'\033[38;2;245;245;247m' G=$'\033[38;2;142;142;147m' HIDE=$'\033[?25l' SHOW=$'\033[?25h' CLR=$'\r\033[2K'
  COLOR=1
else
  B='' D='' R='' RED='' OK='' W='' G='' HIDE='' SHOW='' CLR=$'\r' COLOR=0
fi
TMP=$(mktemp -d)
cleanup() { printf '%s' "$SHOW"; rm -rf "$TMP"; }
trap cleanup EXIT
trap 'printf "\n"; exit 130' INT

logo() {
  local shades=(255 238 220 202 184 160) i=0
  printf '\n'
  while IFS= read -r line; do
    if [ $COLOR = 1 ]; then printf '  \033[38;2;%d;%d;%dm%s\033[0m\n' "${shades[$i]}" "${shades[$i]}" "${shades[$i]}" "$line"
    else printf '  %s\n' "$line"; fi
    i=$((i + 1))
  done <<'EOF'
██╗██████╗  ██████╗ ███╗   ██╗██╗  ██╗██╗██████╗ ███████╗
██║██╔══██╗██╔═══██╗████╗  ██║██║  ██║██║██╔══██╗██╔════╝
██║██████╔╝██║   ██║██╔██╗ ██║███████║██║██║  ██║█████╗
██║██╔══██╗██║   ██║██║╚██╗██║██╔══██║██║██║  ██║██╔══╝
██║██║  ██║╚██████╔╝██║ ╚████║██║  ██║██║██████╔╝███████╗
╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝╚═════╝ ╚══════╝
EOF
}

STEP=0 TOTAL=4
done_step() { printf '%s  %s✓%s  %s%s%s\n' "$CLR" "$OK" "$R" "$W" "$1" "$R"; }
fail() {
  printf '%s  %s✕%s  %s%s%s\n' "$CLR" "$RED" "$R" "$B" "$1" "$R" >&2
  [ -n "${2:-}" ] && printf '     %s%s%s\n' "$G" "$2" "$R" >&2
  printf '\n' >&2; exit 1
}

# run a command with a spinner beside its label
spin() {
  local label=$1; shift
  STEP=$((STEP + 1))
  "$@" >"$TMP/log" 2>&1 &
  local pid=$! f=0 frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
  printf '%s' "$HIDE"
  while kill -0 "$pid" 2>/dev/null; do
    printf '%s  %s%s%s  %s  %s%d/%d%s' "$CLR" "$W" "${frames[$((f % 10))]}" "$R" "$label" "$G" "$STEP" "$TOTAL" "$R"
    f=$((f + 1)); sleep 0.08
  done
  wait "$pid"; local rc=$?
  printf '%s' "$SHOW"
  return $rc
}

human() { awk -v b="$1" 'BEGIN{ if (b>=1048576) printf "%.1f MB", b/1048576; else printf "%.0f KB", b/1024 }'; }
line_of() { local s=''; local k; for ((k = 0; k < $1; k++)); do s+='━'; done; printf '%s' "$s"; }

# download with a bar: url, size, file, [curl args...]
download() {
  local url=$1 size=$2 out=$3; shift 3
  STEP=$((STEP + 1))
  curl -fsSL "$@" "$url" -o "$out" 2>"$TMP/log" &
  local pid=$! width=28 start=$SECONDS
  printf '%s' "$HIDE"
  while kill -0 "$pid" 2>/dev/null; do
    local have=0; [ -f "$out" ] && have=$(stat -f %z "$out")
    local pct=0; [ "$size" -gt 0 ] && pct=$((have * 100 / size))
    [ $pct -gt 100 ] && pct=100
    local n=$((pct * width / 100)) el=$((SECONDS - start)) speed=''
    [ $el -gt 0 ] && speed="  ·  $(human $((have / el)))/s"
    printf '%s  %s↓%s  Downloading  %s%s%s%s%s%s  %s%3d%%%s  %s%s%s%s' "$CLR" "$W" "$R" \
      "$W" "$(line_of $n)" "$R" "$D" "$(line_of $((width - n)))" "$R" "$B" "$pct" "$R" "$G" "$(human "$have")" "$speed" "$R"
    sleep 0.15
  done
  wait "$pid"; local rc=$?
  printf '%s' "$SHOW"
  return $rc
}

# a value from a JSON file (macOS plutil reads JSON, so no python or jq needed)
jget() { plutil -extract "$2" raw -o - "$1" 2>/dev/null; }

# ── go ──────────────────────────────────────────────────────────────────────
logo
printf '\n  %sMovies and shows, instantly.%s   %sInstaller for macOS%s\n\n' "$W" "$R" "$G" "$R"

# this Mac
[ "$(uname -s)" = "Darwin" ] || fail "Orbie is a Mac app."
ARCH=$(uname -m)
[ "$ARCH" = "arm64" ] || fail "This Mac has an Intel chip." "Orbie 1.0 runs on Apple Silicon (M1 and later)."
OSV=$(sw_vers -productVersion)
[ "${OSV%%.*}" -ge 15 ] || fail "macOS $OSV is too old." "Orbie needs macOS 15 Sequoia or later."
CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Apple Silicon")
done_step "$CHIP  ·  macOS $OSV"

# 1. the latest release: a public repo needs nothing, a private one uses your GitHub CLI login
AUTH=()
fetch_release() {
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" -o "$TMP/rel.json" 2>/dev/null && return 0
  command -v gh >/dev/null && gh api "repos/$REPO/releases/latest" >"$TMP/rel.json" && touch "$TMP/private"
}
spin "Finding the latest version" fetch_release ||
  fail "Couldn't read the Orbie releases." "Check your connection. If the repo is private, install the GitHub CLI and run: gh auth login"
if [ -f "$TMP/private" ]; then
  TOKEN=$(gh auth token 2>/dev/null) || fail "The GitHub CLI isn't logged in." "Run: gh auth login"
  AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/octet-stream")
fi
TAG=$(jget "$TMP/rel.json" tag_name)
i=0 ASSET=''
while NAME=$(jget "$TMP/rel.json" "assets.$i.name"); do
  case "$NAME" in Orbie-*-"$ARCH".zip|IronHide-*-"$ARCH".zip) ASSET=$i; break ;; esac # IronHide: releases from before the rename
  i=$((i + 1))
done
[ -n "$ASSET" ] || fail "The latest release ($TAG) has no download for this Mac."
SIZE=$(jget "$TMP/rel.json" "assets.$ASSET.size")
if [ ${#AUTH[@]} -gt 0 ]; then URL=$(jget "$TMP/rel.json" "assets.$ASSET.url")
else URL=$(jget "$TMP/rel.json" "assets.$ASSET.browser_download_url"); fi
DEST=${IRONHIDE_DEST:-/Applications}
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
CURRENT=$(defaults read "$DEST/Orbie.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || defaults read "$DEST/IronHide.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)
if [ "v$CURRENT" = "$TAG" ]; then done_step "Orbie $TAG  ${G}already installed, refreshing it"
elif [ -n "$CURRENT" ]; then done_step "Orbie $TAG  ${G}updating from v$CURRENT"
else done_step "Orbie $TAG"; fi

# 2. download
download "$URL" "$SIZE" "$TMP/Orbie.zip" ${AUTH[@]+"${AUTH[@]}"} || fail "The download failed." "$(tail -1 "$TMP/log")"
done_step "Downloaded $(human "$SIZE")"

# 3. unpack and check the signature
# an older release unpacks as IronHide.app: it goes in under the new name
unpack() {
  ditto -x -k "$TMP/Orbie.zip" "$TMP/x" || return 1
  [ -d "$TMP/x/Orbie.app" ] || { [ -d "$TMP/x/IronHide.app" ] && mv "$TMP/x/IronHide.app" "$TMP/x/Orbie.app"; } || return 1
  codesign --verify --deep --strict "$TMP/x/Orbie.app"
}
spin "Unpacking and verifying" unpack || fail "The download is damaged." "Run the installer again."
done_step "Unpacked and verified"

# 4. install
install_app() {
  if pgrep -xq ironhide-mac; then osascript -e 'quit app "Orbie"' -e 'quit app "IronHide"' >/dev/null 2>&1; sleep 2; pkill -x ironhide-mac 2>/dev/null; fi
  # the app's own service, if a crash left it behind (it stops by itself within seconds, this just doesn't wait)
  pkill -f "(Orbie|IronHide).app/Contents/Resources/ironhide/src/daemon.js" 2>/dev/null
  # the app was called IronHide before: take the old copy away so there is only one
  rm -rf "$DEST/IronHide.app"
  rm -rf "$DEST/Orbie.app" && mv "$TMP/x/Orbie.app" "$DEST/" || return 1
  # downloaded apps are quarantined by macOS; this one is ad-hoc signed, so the flag is cleared here
  xattr -dr com.apple.quarantine "$DEST/Orbie.app" 2>/dev/null; return 0
}
spin "Installing" install_app || fail "Couldn't write to $DEST." "$(tail -1 "$TMP/log")"
done_step "Installed in ${DEST/#$HOME/~}"

# ── done ────────────────────────────────────────────────────────────────────
printf '\n  %s%sOrbie is ready.%s' "$B" "$W" "$R"
[ -n "${IRONHIDE_NO_OPEN:-}" ] && printf '\n\n' || printf '  %sOpening it now…%s\n\n' "$G" "$R"
if [ -z "$CURRENT" ]; then
  printf '  %sAdd two keys in Settings → Connectors and you are set:%s\n' "$G" "$R"
  printf '    %s›%s %sDebrid%s  %sTorBox recommended, for instant streams%s\n' "$G" "$R" "$W" "$R" "$G" "$R"
  printf '    %s›%s %sTMDB%s    %sfree at themoviedb.org/settings/api, for picks and search%s\n\n' "$G" "$R" "$W" "$R" "$G" "$R"
fi
printf '  %sUpdate any time by running the same line again.%s\n\n' "$D" "$R"
[ -n "${IRONHIDE_NO_OPEN:-}" ] || open "$DEST/Orbie.app"
