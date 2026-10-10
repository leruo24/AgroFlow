#!/usr/bin/env python3
"""Scene and cue timing for v4. Each cue gets the longer of the guide-voice length and its word
count read at 140 words a minute, so the team's own recordings fit the same picture.
Writes assets/vo/scenes.json and the "at" (start, seconds) of every cue in assets/vo/cues.json."""
import json, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
WPM, LEAD, FIRST_LEAD, TAIL = 140, 0.5, 2.6, 0.8
c = json.load(open("assets/vo/cues.json"))
slot = lambda x: max(x["dur"], len(x["text"].split()) / WPM * 60)
t, scenes = 0.0, []
for s in range(1, 14):
    x = next(k for k in c if k["scene"] == s)
    lead = FIRST_LEAD if s == 1 else LEAD
    x["at"] = round(t + lead, 2)
    d = round(lead + slot(x) + TAIL, 2)
    scenes.append({"scene": s, "start": round(t, 2), "dur": d}); t = round(t + d, 2)
at = t + 0.6
for x in [k for k in c if k["scene"] == 14]:
    x["at"] = round(at, 2); at += slot(x) + 0.45
d = round(at - t + 2.2, 2); scenes.append({"scene": 14, "start": t, "dur": d}); t = round(t + d, 2)
json.dump(c, open("assets/vo/cues.json", "w"), indent=1, ensure_ascii=False)
json.dump(scenes, open("assets/vo/scenes.json", "w"), indent=1)
for s in scenes: print(s)
print("total", t)
