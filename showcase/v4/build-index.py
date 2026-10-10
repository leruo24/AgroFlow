#!/usr/bin/env python3
"""Writes index.html from assets/vo/scenes.json (scene starts and lengths, from plan-timing.py),
shared.css and the honesty tags below. No voice is placed here: the picture renders without
narration (NOVOICE) and the voice is muxed on top afterwards (guide or the team's own)."""
import json, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
scenes = json.load(open("assets/vo/scenes.json"))
FILES = ["c01-problem", "c02-enquiry", "c03-callback", "c04-onboarding", "c05-handover", "c06-kit", "c07-setup",
         "c08-daily", "c09-run", "c10-weather", "c11-reports", "c12-admin", "c13-testing", "c14-close"]
APP, WEB, VIS, ILL, MOCK = "#168f99", "#168f99", "#4f8f62", "#9a7b5d", "#9a6214"
# (scene, from, to (None = scene end), colour, text) - times are scene-local seconds
TAGS = [
  (1, 2.4, None, VIS, "Conceptual visualisation"),
  (2, 0.3, None, WEB, "Real AgroFlow website · demo data, persona"),
  (3, 0.3, 7.0, MOCK, "Mocked Telegram chat · message text from AgroFlow's code"),
  (3, 7.0, None, APP, "Real admin console · demo data"),
  (4, 0.3, None, APP, "Real admin console · demo data"),
  (5, 0.3, 3.8, APP, "Real admin console · demo values, not a real code"),
  (5, 3.8, 13.8, MOCK, "Mocked Telegram chat · message text from AgroFlow's code"),
  (5, 13.8, None, APP, "Real AgroFlow app · demo account"),
  (6, 0.3, 9.3, VIS, "Website 3D model · visualisation"),
  (6, 9.3, 15.8, APP, "Real admin console · demo code, not a real one"),
  (6, 15.8, None, ILL, "Illustration of the kit's setup page · field names from the firmware"),
  (7, 0.3, None, APP, "Real AgroFlow app · demo data · steps shown together, done on different days"),
  (8, 0.3, None, APP, "Real AgroFlow app · advice computed by AgroFlow's engine on demo inputs"),
  (9, 0.3, 13.2, APP, "Real AgroFlow app · demo data"),
  (9, 13.2, None, VIS, "Left: website demo, visualisation, slowed · right: real app"),
  (10, 0.3, 10.1, APP, "Real AgroFlow app · advice computed by AgroFlow's engine on demo inputs"),
  (10, 10.1, 17.7, APP, "AgroFlow engine output on demo inputs"),
  (10, 17.7, None, MOCK, "Mocked Telegram chat · message text from AgroFlow's code"),
  (11, 0.3, None, APP, "Report PDF from AgroFlow's own renderer · real admin console · demo data"),
  (12, 0.3, None, APP, "Real admin console · demo data"),
  (13, 0.3, None, APP, "Test results from our local runs, 9–10 Oct 2026"),
]
css = open("shared.css").read()
total = round(scenes[-1]["start"] + scenes[-1]["dur"], 2)
out = [f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>AgroFlow Showcase v4</title>
<script src="assets/vendor/gsap.min.js"></script>
<style>
{css}
</style>
</head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-duration="{total}" data-width="1920" data-height="1080">
  <div id="bgLayer" class="clip" data-start="0" data-duration="{total}" data-track-index="0"><div id="bgDots"></div></div>
  <!-- scenes: enquiry -> call-back -> onboarding -> handover -> kit -> setup -> daily use -> run -> weather -> reports -> admin -> testing -> close -->
"""]
for s, f in zip(scenes, FILES):
    cid = f.split("-")[0]
    out.append(f'  <div id="{cid}" data-composition-id="{cid}" data-composition-src="compositions/{f}.html" data-start="{s["start"]}" data-duration="{s["dur"]}" data-track-index="1" data-width="1920" data-height="1080"></div>\n')
out.append("  <!-- honesty tags -->\n")
for i, (sc, a, b, col, text) in enumerate(TAGS, 1):
    s = scenes[sc - 1]; end = s["dur"] - 0.4 if b is None else b
    out.append(f'  <div id="tag{i}" class="clip" data-start="{round(s["start"] + a, 2)}" data-duration="{round(end - a, 2)}" data-track-index="2"><div class="tag"><i style="background:{col}"></i>{text}</div></div>\n')
out.append(f"""</div>
<script>
  const tl = gsap.timeline({{ paused: true }});
  tl.fromTo("#bgDots", {{ x: 0, y: 0 }}, {{ x: -40, y: -40, duration: {total}, ease: "none" }}, 0);
  window.__timelines["main"] = tl;
</script>
</body>
</html>
""")
open("index.html", "w").write("".join(out))
print("index.html", total, "s")
