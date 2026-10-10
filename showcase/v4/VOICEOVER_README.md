# Recording the team's voice-over (v4)

The video is finished and timed. You only record your lines; a script places them.

- `../renders/AgroFlow_v4_GUIDE.mp4`: the video with a computer guide voice, **for timing only**.
  Watch it to hear where each line goes.
- `../renders/AgroFlow_v4_NOVOICE.mp4`: the same picture and timing with no narration. Your voices go on this.
- `VOICEOVER_SCRIPT.md`: every line, who reads it, its start time, its slot, word count and target length.
- `../renders/INF3003W_Team02_ShowcaseDemo_v4.srt`: subtitles from the script.

## How to record

1. **One file per line**, named exactly as in the script, saved in `showcase/v4/vo-team/`:
   `s01_leruo.wav`, `s02_olwethu.wav`, `s03_olwethu.wav`, `s04_philisile.wav`, `s05_philisile.wav`,
   `s06_leruo.wav`, `s07_luba.wav`, `s08_luba.wav`, `s09_leruo.wav`, `s10_leruo.wav`,
   `s11_olwethu.wav`, `s12_olwethu.wav`, `s13_leruo.wav`, and the close as four sub-cues:
   `s14a_luba.wav`, `s14b_leruo.wav`, `s14c_philisile.wav`, `s14d_olwethu.wav`.
2. **WAV, 48 kHz** (mono or stereo, 16- or 24-bit).
3. **A quiet room**: no fan, no echoey bathroom, phone on silent, mouth a hand's width from the mic.
4. **Start each file with 1 second of silence**, then read the line. The script expects that second.
5. Read at a relaxed pace, about 140 words a minute. The script lists each line's target length;
   a little shorter is fine, longer runs into the next line.

## Putting it together

From the repository root on Windows (needs ffmpeg 5.1+ on the PATH), single line:

```powershell
powershell -ExecutionPolicy Bypass -File showcase\v4\mux-voiceover.ps1
```

It writes `showcase/renders/INF3003W_Team02_ShowcaseDemo_v4.mp4` (H.264 + AAC, 1920×1080, 25 fps),
levels every clip to the same loudness, and places each one at its line's start time.
If a recording runs longer than its slot it is **not cut**: the script warns and lists it, so you can
re-record it. Missing files are listed too, and the rest are still placed.
