#!/usr/bin/env bash
# Splits the final render into one MP4 per scene (see storyboard.md).
# Re-encodes so every clip starts on its exact frame (H.264 + AAC, 25 fps).
set -euo pipefail
cd "$(dirname "$0")"
SRC=renders/AgroFlow_Showcase_Walkthrough_Final.mp4
OUT=renders/clips
mkdir -p "$OUT"
while read -r name start end; do
  ffmpeg -nostdin -v error -y -ss "$start" -to "$end" -i "$SRC" \
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 25 \
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$OUT/$name.mp4"
  echo "$name  $start–$end s"
done <<'EOF'
01-opening            0        10.91
02-problem            10.91    34.34
03-field-kit          34.34    58.29
04-architecture       58.29    74.47
05-farmer-app         74.47    95.97
06-science            95.97    120.48
07-why                120.48   138.96
08-farmer-decides     138.96   155.94
09-irrigation         155.94   176.35
10-next-7-days        176.35   195.5
11-weather-update     195.5    217.9
12-alerts             217.9    235.51
13-incomplete-setup   235.51   250.86
14-admin              250.86   272.71
15-summary            272.71   283.43
16-close              283.43   293.23
EOF
