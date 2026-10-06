# Shot list

All recordings: `assets/rec/*.mp4` (real apps, CDP screencast, 25 fps, 2× density),
interaction timings in the matching `*.events.json`. Stills: `assets/screens/*.png`.

| Shot | In → out (video) | Source | Source range | Treatment |
|---|---|---|---|---|
| 1 Title | 0:00–0:10 | composition + `assets/brand/agroflow-icon-512.png` | — | node draw, water line, title rise |
| 2 Persona/field | 0:10–0:30 | composition | — | three zones, Zone 2 dries, "ZONE 2 NEEDS ATTENTION" |
| 3a Sign in → Home | 0:31–0:39 | `m1-signin.mp4` | 0–7.9 s | phone frame, touch rings at events |
| 3b Home hold | 0:39–0:44 | `m-home.png` | — | highlight weather + "1 Unread alerts" |
| 3c Home → zones → Zone 2 | 0:44–0:55 | `m2-zones.mp4` | 0–10.9 s | "ONE VIEW OF EVERY ZONE", highlight Zone 2 card |
| 3d Zone 2 opened | 0:55–1:00 | `m-zone2.png` | — | hold |
| 4a Live overview | 1:00–1:12 | `m-zone2.png` | — | masked zoom on 19% Dry / 30°C / 36% |
| 4b Sensor → platform | 1:12–1:22 | composition | — | probe + DHT11 → ESP32 → MQTT → API → Supabase → app |
| 4c Crop & stage | 1:22–1:35 | `m3-zone.mp4` | 0–6.0 s | highlight growth bar |
| 5a Analysis | 1:35–1:47 | composition | — | four inputs → FAO-56 → advice |
| 5b Advice | 1:47–1:55 | `m-zone2-advice.png` | — | highlight Advice card |
| 5c Week ahead | 1:55–2:05 | `m3-zone.mp4` | 5.6–11.4 s | highlight "No rain expected" |
| 6a Manual run | 2:05–2:26 | `m4-manual.mp4` | 0–20.0 s | touch rings; dialog overlays at 6.87–9.47 s and 14.50–17.10 s; "INPUT VALIDATED" |
| 6b Command sent | 2:26–2:30 | `m-zone2-sent.png` | — | highlight "Manual command sent" |
| 6c Command path | 2:30–2:45 | composition | — | app → API → MQTT → ESP32 → relay → pump OFF→ON, water |
| 6d History | 2:45–2:58 | `m5-history.mp4` + `m-history.png` | 0–3.3 s | "IRRIGATION EVENT RECORDED" |
| 8a Transition | 2:58–3:01 | composition | — | "ONE FARMER'S ACTION → ONE CONNECTED PLATFORM" |
| 8b Admin tour | 3:01–3:32 | `a1-admin.mp4` | 0–7.3 s, then 13.3–37.6 s (farm drawer cut) | browser frame, cursor, highlights |
| 8c Responsive | 3:32–3:36 | `a-narrow-home.png`, `a-narrow-kits.png` | — | two phone-width frames |
| 9 System | 3:36–3:52 | composition | — | system diagram, SENSE · UNDERSTAND · ACT · MONITOR |
| 10 Close | 3:52–4:00 | `m-home.png` + brand | — | pull back, tagline |
| End plate | 4:00–4:30 | composition | — | small mark, clean space |

Sound (starter kit, quiet): tick on sensor readings and taps that change state,
switch on relay, success on pump ON, chime on the close.
