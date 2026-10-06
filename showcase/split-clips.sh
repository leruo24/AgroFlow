#!/usr/bin/env bash
# Splits the final render into one MP4 per scene (see CLIP-REVIEW.md).
# Re-encodes so every clip starts on its exact frame (H.264 + AAC, 25 fps).
set -euo pipefail
cd "$(dirname "$0")"
SRC=renders/INF3003W_Team2_ShowcaseDemo_2026.mp4
OUT=renders/clips
mkdir -p "$OUT"
while read -r name start end; do
  ffmpeg -v error -y -ss "$start" -to "$end" -i "$SRC" \
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 25 \
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$OUT/$name.mp4"
  echo "$name  $start–$end s"
done <<'EOF'
01-title       0   10
02-persona     10  30
03-open-app    30  60
04-zone        60  95
05-advice      95  133
06-act         133 186
07-admin       186 230
08-system      230 252
09-close       252 260
10-endplate    260 290
EOF
