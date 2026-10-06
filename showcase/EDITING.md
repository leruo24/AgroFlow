# Editing the AgroFlow showcase video

There are two ways to edit, depending on what you want to change.

---

## Option A: in a normal video editor (CapCut, DaVinci Resolve, Premiere, iMovie)

Use this to **cut, shorten, reorder, re-time, change the music or voice, or add your own titles**.

In `renders/edit-kit/`:

| File | What it is |
|---|---|
| `picture-no-audio.mp4` | The finished picture, 1920×1080, 25 fps, no sound |
| `voiceover.wav` | The narration on its own, full length |
| `sound-effects.wav` | The small click/tick/chime effects on their own, full length |

There are also per-scene clips with sound in `renders/clips/` (`01-title.mp4` … `10-endplate.mp4`) and the finished video with sound in `renders/INF3003W_Team2_ShowcaseDemo_2026.mp4`.

**How to use the edit kit:**
1. Make a new project at **1920×1080, 25 fps**.
2. Put `picture-no-audio.mp4` on video track 1, `voiceover.wav` on audio track 1, and `sound-effects.wav` on audio track 2, **all starting at 0:00**. They are in sync.
3. Edit as you like. To replace the voice with your own recording, mute `voiceover.wav` and record over `narration.md`, where each line shows the time it starts.
4. Export as **MP4 (H.264 + AAC), 1920×1080, 25 fps**.

Scene times, so you can find things:

| Scene | Time |
|---|---|
| 01 Title | 0:00–0:10 |
| 02 Persona | 0:10–0:30 |
| 03 Open the app | 0:30–1:00 |
| 04 Zone readings | 1:00–1:35 |
| 05 How the advice is made | 1:35–2:13 |
| 06 Taking action | 2:13–3:06 |
| 07 Administrator | 3:06–3:50 |
| 08 System & safety | 3:50–4:12 |
| 09 Close | 4:12–4:20 |
| 10 End plate | 4:20–4:50 |

The editing software can't change words or highlights *inside* the picture. For that, use Option B.

---

## Option B: change the video itself (text, highlights, timing, voice) with HyperFrames

The video is a HyperFrames project: HTML pages animated over time, then rendered to MP4. You can open it in **HyperFrames Studio** and see every change live.

**One-time setup on your computer** (needs Node 18+ and ffmpeg):
```bash
git clone https://github.com/leruo24/AgroFlow.git
cd AgroFlow && git checkout dev && cd showcase
npx hyperframes preview      # opens the Studio in your browser
```
Or install the HyperFrames desktop app and open the `showcase` folder.

**Where things are:**

| To change… | Edit… |
|---|---|
| Scene order, scene lengths, the small "Real app / Conceptual" labels, sound effects | `index.html` (each scene is a `data-start` / `data-duration` line) |
| A scene's text, captions, highlight boxes and their timing | `compositions/s01-title.html` … `s11-endplate.html`. Highlight boxes are `<div class="spot">` (phone) or `<div class="hl">` (admin), with `left/top/width/height` in pixels; their timing is in the `tl.to(...)` lines in the `<script>` at the bottom. |
| What the narrator says, or when a line starts | `assets/vo/vo-lines.json` (`text`, `at` in seconds), then run `python3 make-voiceover.py` |
| Voice or speed | `VOICE` and `SPEED` at the top of `make-voiceover.py` |
| The demo data shown in the apps | `capture/demo-data.mjs`, then re-record with `npm run record:mobile` / `npm run record:admin` (needs the apps running, see the top of each recorder script) |

**After editing:**
```bash
npx hyperframes check     # catches mistakes
npm run render            # writes renders/INF3003W_Team2_ShowcaseDemo_2026.mp4
./split-clips.sh          # re-cuts the per-scene clips
./make-edit-kit.sh        # rebuilds the Option A files
```
The high-quality settings used for the delivered file are `npx hyperframes render -f 25 -q delivery --crf 12 -o renders/INF3003W_Team2_ShowcaseDemo_2026.mp4`.

Keep the honesty rules from `system-audit.md`: only show features that exist in the code, keep the "illustrative demo data" and "Conceptual visualisation" labels, and use no copyrighted music or images.
