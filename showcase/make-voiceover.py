#!/usr/bin/env python3
"""Regenerate the voiceover from assets/vo/vo-lines.json and update index.html.

Edit a line's "text" (what is said) or "at" (start time in seconds) in
assets/vo/vo-lines.json, then run:

    python3 make-voiceover.py            # all lines
    python3 make-voiceover.py vo03 vo06  # only these lines

Needs: ffmpeg, Node (npx hyperframes) and a Python with kokoro-onnx + soundfile
(`python3 -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile`, then
set HYPERFRAMES_PYTHON=.venv/bin/python). Voice and speed are set below.
It warns if a line would run into the next one.
"""
import json, os, re, subprocess, sys

VOICE = "am_michael"   # e.g. af_heart, am_adam, bf_emma, bm_george
SPEED = "1.15"
# Shorten pauses longer than 0.28 s to 0.18 s, trim ends, normalise to -16 LUFS.
FILTER = ("silenceremove=start_periods=1:start_threshold=-50dB:stop_periods=-1:"
          "stop_duration=0.28:stop_threshold=-45dB:stop_silence=0.18,areverse,"
          "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
          "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000")

here = os.path.dirname(os.path.abspath(__file__))
os.chdir(here)
lines = json.load(open("assets/vo/vo-lines.json"))
only = set(sys.argv[1:])

for l in lines:
    if only and l["id"] not in only:
        continue
    raw, out = f"assets/vo/{l['id']}_raw.wav", f"assets/vo/{l['id']}.wav"
    subprocess.run(["npx", "hyperframes", "tts", l["text"], "--voice", VOICE,
                    "--speed", SPEED, "-o", raw], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", raw, "-af", FILTER,
                    "-ar", "48000", "-ac", "1", out], check=True)
    os.remove(raw)
    l["dur"] = round(float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out],
        capture_output=True, text=True, check=True).stdout), 2)
    print(f"{l['id']}: {l['dur']} s")

json.dump(lines, open("assets/vo/vo-lines.json", "w"), indent=1)

# Rewrite the <audio> tags in index.html from the JSON.
html = open("index.html").read()
html = re.sub(r'  <audio id="vo\w+".*\n', "", html)
tags = "".join(
    f'  <audio id="{l["id"]}" src="assets/vo/{l["id"]}.wav" data-start="{l["at"]}" '
    f'data-duration="{l["dur"]}" data-volume="1" data-track-index="21"></audio>\n' for l in lines)
html = re.sub(r"(  <!-- Voiceover:[^\n]*-->\n)", lambda m: m.group(1) + tags, html, count=1)
open("index.html", "w").write(html)

ordered = sorted(lines, key=lambda l: l["at"])
for a, b in zip(ordered, ordered[1:]):
    if a["at"] + a["dur"] > b["at"]:
        print(f"WARNING: {a['id']} ends at {a['at'] + a['dur']:.2f} s, after {b['id']} starts ({b['at']} s)")
print("index.html updated. Next: npx hyperframes check, then npm run render.")
