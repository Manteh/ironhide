#!/bin/bash
# Turn Screen Studio exports into the small files the showcase page loads.
#   ./encode.sh ~/Movies/fidelity.mp4 ~/Movies/architecture.mp4 ...
# Each input name becomes media/<name>.webm, media/<name>.mp4 and media/<name>.jpg (a poster frame).
# The page expects: home, version, search, together, sanctuary. Clips are silent, capped at 1920 wide and 30 fps.
set -euo pipefail
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed: brew install ffmpeg"; exit 1; }
OUT="$(cd "$(dirname "$0")" && pwd)"
for IN in "$@"; do
  NAME="$(basename "${IN%.*}")"
  VF="scale='min(1920,iw)':-2,fps=30"
  echo "→ $NAME"
  ffmpeg -y -loglevel error -i "$IN" -an -vf "$VF" -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart "$OUT/$NAME.mp4"
  ffmpeg -y -loglevel error -i "$IN" -an -vf "$VF" -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -pix_fmt yuv420p "$OUT/$NAME.webm"
  ffmpeg -y -loglevel error -ss 1 -i "$IN" -frames:v 1 -vf "scale='min(1280,iw)':-2" -q:v 3 "$OUT/$NAME.jpg"
  ls -lh "$OUT/$NAME".{mp4,webm} | awk '{print "   " $5 "  " $9}'
done
