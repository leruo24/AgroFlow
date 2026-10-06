# Shot list

All recordings: `assets/rec/*.mp4` (real apps, CDP screencast, 25 fps, 2× density),
interaction timings in the matching `*.events.json`. Stills: `assets/screens/*.png`.

| Shot | In → out (video) | Source | Source range | Treatment |
|---|---|---|---|---|
| 1 Title | 0:00–0:10 | composition + `assets/brand/agroflow-icon-512.png` | — | node draw, water line, title rise |
| 2 Persona/field | 0:10–0:30 | composition + `m-splash.png` | — | three zones, Zone 2 dries, "ZONE 2 NEEDS ATTENTION" |
| 3a Open app → Home + Drip | 0:30–0:40 | `m1-open.mp4` | 0–10.4 s | highlight Drip, weather, farm status |
| 3b Home → zones → Zone 2 | 0:40–0:51 | `m2-zones.mp4` | 0–11.0 s | "ONE VIEW OF EVERY ZONE", highlight Zone 2 card |
| 3c Zone 2 opened | 0:51–1:00 | `m-zone2.png` | — | hold |
| 4a Live overview | 1:00–1:12 | `m-zone2.png` | — | masked zoom on 19% Dry / 30°C / 36% |
| 4b Sensor → platform | 1:12–1:22 | composition | — | probe + DHT11 → ESP32 → MQTT → API (Railway) → Supabase |
| 4c Crop & stage | 1:22–1:35 | `m3-zone.mp4` | 0–6.0 s | highlight growth bar |
| 5a FAO-56 four steps | 1:35–1:55 | composition | — | 4 steps, 2 checks, advice |
| 5b Advice | 1:55–2:03 | `m-zone2-advice.png` | — | highlight Advice card |
| 5c Week ahead | 2:03–2:13 | `m3-zone.mp4` + `m-forecast.png` | 5.7–9.6 s | highlight "No rain expected" |
| 6a Manual run | 2:13–2:34 | `m4-manual.mp4` | 0–19.8 s | touch rings; dialog overlays at 6.83–9.43 s and 14.44–17.04 s; "INPUT VALIDATED" |
| 6b Command sent | 2:34–2:38 | `m-zone2-sent.png` | — | highlight "Manual command sent" |
| 6c Command path | 2:38–2:53 | composition | — | app → API → MQTT → ESP32 → relay → pump OFF→ON, water |
| 6d History | 2:53–3:06 | `m5-history.mp4` + `m-history.png` | 0–3.3 s | "IRRIGATION EVENT RECORDED" |
| 8a Transition | 3:06–3:09 | composition | — | "ONE FARMER'S ACTION → ONE CONNECTED PLATFORM" |
| 8b Admin tour | 3:09–3:46 | `a1-admin.mp4` | 0–8.55, 12.1–27.3, 29.9–43.6 s (farm page and alert close cut) | browser frame, cursor, highlights |
| 8c Responsive | 3:46–3:50 | `a-narrow-home.png`, `a-narrow-kits.png` | — | two phone-width frames |
| 9 System & safety | 3:50–4:12 | composition | — | system diagram, kit safety card, SENSE · UNDERSTAND · ACT · MONITOR |
| 10 Close | 4:12–4:20 | `m-home.png` + brand | — | pull back, tagline |
| End plate | 4:20–4:50 | composition | — | small mark, clean space |

Sound (starter kit, quiet): tick on sensor readings and taps that change state,
switch on relay, success on pump ON, chime on the close.
