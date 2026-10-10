#!/usr/bin/env python3
"""Writes VOICEOVER_SCRIPT.md, the subtitles (../renders/INF3003W_Team02_ShowcaseDemo_v4.srt)
and assets/vo/cue-sheet.csv (read by mux-voiceover.ps1) from assets/vo/cues.json and
assets/vo/scenes.json. Run after plan-timing.py."""
import csv, json, os, re
os.chdir(os.path.dirname(os.path.abspath(__file__)))
WPM = 140
cues = json.load(open("assets/vo/cues.json"))
scenes = {s["scene"]: s for s in json.load(open("assets/vo/scenes.json"))}
total = round(max(s["start"] + s["dur"] for s in scenes.values()), 2)
words = lambda c: len(c["text"].split())
target = lambda c: round(words(c) / WPM * 60, 1)
ordered = sorted(cues, key=lambda c: c["at"])
for i, c in enumerate(ordered):
    sc = scenes[c["scene"]]
    nxt = ordered[i + 1]["at"] if i + 1 < len(ordered) else total
    c["limit"] = round(min(nxt, sc["start"] + sc["dur"]) if c["scene"] != 14 else nxt, 2)
    c["end"] = round(c["at"] + max(c["dur"], words(c) / WPM * 60), 2)

def tc(t, srt=False):
    h, r = divmod(t, 3600); m, s = divmod(r, 60)
    if srt:
        ms = int(round((s - int(s)) * 1000))
        if ms == 1000: s, ms = s + 1, 0
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{ms:03d}"
    return f"{int(m)}:{s:05.2f}"

# ---- VOICEOVER_SCRIPT.md ------------------------------------------------------------------
md = ["# AgroFlow showcase v4: voice-over script", "",
      f"Video length {tc(total)} ({total} s), 1920×1080, 25 fps. The picture is fixed: every line has a start time and a time slot.",
      "Each line's slot is long enough to read it at about **140 words a minute**. The guide voice in",
      "`AgroFlow_v4_GUIDE.mp4` is a computer voice for timing only; record your own and replace it",
      "(see `VOICEOVER_README.md`).", "",
      "Times are `minutes:seconds` from the start of the video. **In** is when your first word should start;",
      "**Out** is when you should be finished by (the next line starts there, or the scene changes).", "",
      "| Speaker | Lines |", "|---|---|",
      "| Leruo | 1 problem, 6 field kit, 9 execution, 10 weather change, 13 testing, close line b |",
      "| Olwethu | 2 enquiry, 3 call-back, 11 reports, 12 admin view, close line d |",
      "| Philisile | 4 onboarding, 5 Telegram and first sign-in, close line c |",
      "| Lubaelihle | 7 zone setup in the app, 8 daily use, close line a |", ""]
for c in ordered:
    sc = scenes[c["scene"]]
    md += [f"## {c['scene']}. {c['title']} · {c['speaker']}" + (f" ({c['id'][3]})" if c["scene"] == 14 else ""), "",
           f"- File: `vo-team/{c['id']}.wav`",
           f"- Scene: {tc(sc['start'])} – {tc(sc['start'] + sc['dur'])}",
           f"- In: **{tc(c['at'])}** · Out by: **{tc(c['limit'])}** (slot {round(c['limit'] - c['at'], 1)} s)",
           f"- Words: {words(c)} · target at 140 wpm: {target(c)} s · guide voice: {c['dur']} s", "",
           f"> {c['text']}", ""]
md += ["## Close (scene 14) as sub-cues", "",
       "The close has four speakers, one line each, so it is four files with their own start times:",
       "`s14a_luba.wav`, `s14b_leruo.wav`, `s14c_philisile.wav`, `s14d_olwethu.wav` (times above).", ""]
open("VOICEOVER_SCRIPT.md", "w").write("\n".join(md))

# ---- SRT ------------------------------------------------------------------------------------
def chunks(text, n=84):
    parts = re.split(r"(?<=[.;:?!])\s+", text)
    out = []
    for p in parts:
        while len(p) > n:
            cut = p.rfind(" ", 0, n)
            if "," in p[:n] and p.rfind(", ", 0, n) > n * 0.45:
                cut = p.rfind(", ", 0, n) + 1
            out.append(p[:cut].strip()); p = p[cut:].strip()
        if p: out.append(p)
    return out

def two_lines(s, n=44):
    if len(s) <= n: return s
    cut = s.rfind(" ", 0, len(s) // 2 + 6)
    return s[:cut] + "\n" + s[cut + 1:]

srt, k = [], 1
for c in ordered:
    parts = chunks(c["text"]); span = c["end"] - c["at"]; wsum = sum(len(p.split()) for p in parts); t = c["at"]
    for p in parts:
        d = span * len(p.split()) / wsum
        srt.append(f"{k}\n{tc(t, True)} --> {tc(min(t + d, c['limit']) - 0.04, True)}\n{two_lines(p)}\n"); k += 1; t += d
os.makedirs("../renders", exist_ok=True)
open("../renders/INF3003W_Team02_ShowcaseDemo_v4.srt", "w").write("\n".join(srt))
open("../renders/AgroFlow_v4_GUIDE.srt", "w").write("\n".join(srt))

# ---- cue sheet for the mux script -------------------------------------------------------------
with open("assets/vo/cue-sheet.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["id", "speaker", "start", "limit"])
    for c in ordered: w.writerow([c["id"], c["speaker"], c["at"], c["limit"]])
print("VOICEOVER_SCRIPT.md, SRT and cue sheet written;", len(ordered), "cues,", k - 1, "subtitles, total", total)
