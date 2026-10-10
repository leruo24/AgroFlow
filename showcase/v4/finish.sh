#!/bin/bash
# Turns the rendered picture into the two v4 deliverables, with identical picture and timing:
#   renders/AgroFlow_v4_NOVOICE.mp4  picture + silent AAC track (the team's voices go on this)
#   renders/AgroFlow_v4_GUIDE.mp4    the same file with the guide voice placed by mux-voiceover.ps1
# Usage (after: npx --yes hyperframes@0.8.137 render -f 25 -q delivery --crf 12 -o ../renders/AgroFlow_v4_picture.mp4):
#   ./finish.sh        (needs ffmpeg and pwsh)
set -euo pipefail
cd "$(dirname "$0")"
R=../renders
ffmpeg -v error -y -i "$R/AgroFlow_v4_picture.mp4" -f lavfi -i anullsrc=r=48000:cl=stereo \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart "$R/AgroFlow_v4_NOVOICE.mp4"
pwsh -NoProfile -File mux-voiceover.ps1 -Video "$R/AgroFlow_v4_NOVOICE.mp4" -VoDir assets/vo -LeadSilence 0 -Out "$R/AgroFlow_v4_GUIDE.mp4"
for f in NOVOICE GUIDE; do
  ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,sample_rate:format=duration,size -of compact "$R/AgroFlow_v4_$f.mp4"
done
