#!/usr/bin/env python3
"""Guide voice-over (timing only): one WAV per cue in assets/vo/cues.json, Kokoro am_michael.
The team replaces it with their own recordings (see VOICEOVER_README.md).
Needs ffmpeg, npx hyperframes and HYPERFRAMES_PYTHON pointing at a Python with kokoro-onnx + soundfile.
    python3 make-guide-vo.py [cue ids...]"""
import json, os, subprocess, sys
VOICE, SPEED = "am_michael", "1.0"
FILTER = ("silenceremove=start_periods=1:start_threshold=-50dB:stop_periods=-1:stop_duration=0.5:"
          "stop_threshold=-45dB:stop_silence=0.35,areverse,silenceremove=start_periods=1:start_threshold=-50dB,"
          "areverse,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000")
os.chdir(os.path.dirname(os.path.abspath(__file__)))
cues = json.load(open("assets/vo/cues.json")); only = set(sys.argv[1:])
for c in cues:
    if only and c["id"] not in only: continue
    raw, out = f"assets/vo/{c['id']}_raw.wav", f"assets/vo/{c['id']}.wav"
    subprocess.run(["npx", "--yes", "hyperframes@0.8.137", "tts", c.get("say", c["text"]), "--voice", VOICE, "--speed", SPEED, "-o", raw], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", raw, "-af", FILTER, "-ar", "48000", "-ac", "1", out], check=True)
    os.remove(raw)
    c["dur"] = round(float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], capture_output=True, text=True, check=True).stdout), 2)
    print(c["id"], c["dur"], "s", round(len(c["text"].split()) / c["dur"] * 60), "wpm", flush=True)
json.dump(cues, open("assets/vo/cues.json", "w"), indent=1, ensure_ascii=False)
