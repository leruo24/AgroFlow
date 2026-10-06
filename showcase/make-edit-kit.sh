#!/usr/bin/env bash
# Builds renders/edit-kit/: the finished picture with no sound, plus the voiceover and
# the sound effects as separate full-length tracks. All three start at 0:00 and are in
# sync, so in any editor (CapCut, DaVinci Resolve, Premiere, iMovie) you drop them on
# three tracks at 0:00 and edit freely: cut, re-time, mute or replace the voice, add music.
set -euo pipefail
cd "$(dirname "$0")"
SRC=renders/INF3003W_Team2_ShowcaseDemo_2026.mp4
OUT=renders/edit-kit
mkdir -p "$OUT"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")

ffmpeg -nostdin -v error -y -i "$SRC" -an -c:v copy "$OUT/picture-no-audio.mp4"

# Mix every <audio> on a track (21 = voiceover, 20 = sound effects) at its data-start.
mix() { # $1 = track index, $2 = output
  python3 - "$1" "$2" "$DUR" <<'PY'
import re, subprocess, sys
track, out, dur = sys.argv[1], sys.argv[2], float(sys.argv[3])
tags = re.findall(r'<audio id="[^"]+"\s+src="([^"]+)"\s+data-start="([\d.]+)"\s+data-duration="[\d.]+"\s+data-volume="([\d.]+)"\s+data-track-index="(\d+)"',
                  open("index.html").read())
tags = [t for t in tags if t[3] == track]
args, chains = [], []
for i, (src, start, vol, _) in enumerate(tags):
    args += ["-i", src]
    ms = int(float(start) * 1000)
    chains.append(f"[{i}]aresample=48000,aformat=channel_layouts=stereo,volume={vol},adelay={ms}|{ms}[a{i}]")
mixin = "".join(f"[a{i}]" for i in range(len(tags)))
graph = ";".join(chains) + f";{mixin}amix=inputs={len(tags)}:normalize=0,apad,atrim=0:{dur}[out]"
subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *args, "-filter_complex", graph,
                "-map", "[out]", "-ar", "48000", "-c:a", "aac", "-b:a", "256k", out], check=True)
print(out, len(tags), "files")
PY
}
mix 21 "$OUT/voiceover.m4a"
mix 20 "$OUT/sound-effects.m4a"
echo "Edit kit ready in $OUT"
