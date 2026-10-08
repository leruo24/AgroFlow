# Editing the AgroFlow showcase walkthrough

There are two ways to edit, depending on what you want to change.

---

## Option A: in a normal video editor (CapCut, DaVinci Resolve, Premiere, iMovie)

Use this to **cut, shorten, reorder, re-time, change the music or voice, or add your own titles**.

Build the edit kit once with `./make-edit-kit.sh`. It writes to `renders/edit-kit/`:

| File | What it is |
|---|---|
| `picture-no-audio.mp4` | The finished picture, 1920×1080, 25 fps, no sound |
| `voiceover.m4a` | The narration on its own, full length |
| `sound-effects.m4a` | The small tick/switch/chime effects on their own, full length |

`./split-clips.sh` writes one clip per scene with sound to `renders/clips/` (`01-opening.mp4` … `16-close.mp4`).
The finished video is `renders/AgroFlow_Showcase_Walkthrough_Final.mp4` (1080p), with the same video in 4K (3840×2160) as `renders/AgroFlow_Showcase_Walkthrough_Final_4K.mp4`. The previous (v2, Oct 6) version is
`renders/AgroFlow_Showcase_Walkthrough_Previous.mp4`, with its 4K render `…_Previous_4K.mp4`.

**How to use the edit kit:**
1. Make a new project at **1920×1080, 25 fps**.
2. Put `picture-no-audio.mp4` on video track 1, `voiceover.m4a` on audio track 1 and `sound-effects.m4a` on audio track 2, **all starting at 0:00**. They are in sync.
3. Edit as you like. To replace the voice with your own recording, mute `voiceover.m4a` and read `narration.md`, where each line shows the time it starts.
4. Export as **MP4 (H.264 + AAC), 1920×1080, 25 fps**.

Scene times are in `storyboard.md`.

---

## Option B: change the video itself (text, highlights, timing, voice) with HyperFrames

The video is a HyperFrames project: HTML pages animated over time, then rendered to MP4.

**One-time setup** (Node 18+ and ffmpeg):
```bash
cd showcase
npx hyperframes preview      # opens the Studio in your browser
```

**Where things are:**

| To change… | Edit… |
|---|---|
| Scene order and lengths, the "Real app / Conceptual" tags, sound effects | `index.html` |
| A scene's text, captions, highlight boxes and their timing | `compositions/c01-open.html` … `c16-close.html` (`.spot` = phone highlight, `.hl` = browser highlight; timing in the `tl.*` lines at the bottom) |
| What the narrator says, or when a line starts | `assets/vo/vo-lines.json` (`text`, `at`), then `python3 make-voiceover.py` (needs `kokoro-onnx` + `soundfile`; set `HYPERFRAMES_PYTHON` to that Python) |
| The numbers in the demo story | `capture/v3/scenario_calc.py` (engine formulas), then the matching values in `capture/v3/demo.mjs` and the compositions |
| The app screens | `capture/v3/demo.mjs`, then re-capture (below) |

**Re-capturing the real app screens** (`assets/v3/`):
```bash
# farmer app (unmodified) on Expo web
cd apps/mobile && EXPO_PUBLIC_SUPABASE_URL=https://demo.supabase.co EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=demo-key \
  EXPO_PUBLIC_AGROFLOW_API_BASE=https://api.demo.local npx expo start --web --port 8098
# admin console + landing page (unmodified)
cd apps/web/admin && VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo-key \
  VITE_AGROFLOW_API_BASE=https://api.demo.local npx vite --port 5173
# then, from showcase/capture (npm ci once):
node v3/mobile.mjs && node v3/mobile.mjs kit && node v3/admin.mjs
```

**After editing:**
```bash
npx hyperframes check     # catches mistakes
npm run render            # writes renders/AgroFlow_Showcase_Walkthrough_Final.mp4
npm run render:4k         # 4K (about 30 min); comes out ~111 MB, so re-encode under GitHub's 100 MB limit:
# ffmpeg -i in.mp4 -c:v libx264 -preset slow -b:v 2350k -pass 1 -an -f null /dev/null
# ffmpeg -i in.mp4 -c:v libx264 -preset slow -b:v 2350k -pass 2 -pix_fmt yuv420p -c:a copy -movflags +faststart out.mp4
./split-clips.sh          # re-cuts the per-scene clips
./make-edit-kit.sh        # rebuilds the Option A files
```

Keep the honesty rules in `system-audit.md`: show only features that exist in the code, keep the
"illustrative demo data", "Conceptual visualisation" and "Illustration" tags, and use no copyrighted music or images.
