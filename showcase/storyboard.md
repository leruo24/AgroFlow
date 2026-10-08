# Storyboard — AgroFlow Showcase Walkthrough (v3)

1920×1080, 25 fps, 4:53 (293.2 s), H.264 + AAC. Narrated (see `narration.md`).
Output: `renders/AgroFlow_Showcase_Walkthrough_Final.mp4`. The v2 video (4:50, Oct 6) is kept as
`renders/AgroFlow_Showcase_Walkthrough_Previous.mp4`.

**One story:** field → sensing → weather + crop → FAO-56 water balance → actionable recommendation →
farmer decision → irrigation → monitoring → weather change → plan recalculates → admin oversight →
Sense · Understand · Act · Monitor.

**Demo situation** (illustrative data, worked out in `capture/v3/scenario_calc.py` with the engine's formulas):
farm *Green Valley (demo)*, three irrigation zones — **Tomato field** (tomato, loam, 50 m², pump 25 L/min,
day 66 of ~145), **Spinach beds**, **Maize block** (no flow rate set yet). Today (Thursday): ETo 5.8 mm,
Kc 1.09, ETc 6.4 mm, TAW 91 mm, RAW 31.5 mm, Dr 35 mm, 2 mm of rain forecast → *Water about 70 min this
morning (about 1750 L)*. The farmer applies 1,500 L instead and records it (Dr → 5 mm). Projected next
watering: Tuesday. Then 22 mm of rain is forecast for Saturday → no watering expected this week.

Real UI = the unmodified AgroFlow apps (farmer app on Expo web, admin console on Vite) answering with the
demo data; labelled on screen. Conceptual = original motion graphics; labelled on screen.

| # | Scene (file) | Time | Picture | Kind |
|---|---|---|---|---|
| 1 | Opening (`c01-open`) | 0:00–0:10.9 | Field with crop rows, drip line, the kit on a post and the probe; AgroFlow icon, "AGROFLOW · by MafiHub", tagline, UCT showcase line | Brand + illustration |
| 2 | Problem (`c02-problem`) | 0:10.9–0:34.3 | When / how much / how long / what if; connectivity, water, uneven fields → five inputs → FAO-56 water balance → a decision. "Deterministic. Not AI." | Conceptual |
| 3 | Field kit (`c03-kit`) | 0:34.3–0:58.3 | Enclosure closed → open: ESP32, relay module, 5 V power; cable glands to the YL-69 resistive Soil Moisture Sensor (GPIO 32), DHT11 (GPIO 27), relay → pump (GPIO 25). 30 s reports, 5-min cap, offline fallback | Illustration (no photo or 3D model exists) |
| 4 | Architecture (`c04-arch`) | 0:58.3–1:14.5 | Kit → MQTT/TLS (HiveMQ Cloud) → AgroFlow API (.NET, Railway) → Supabase Postgres; Open-Meteo in; app, console, Telegram out | Conceptual |
| 5 | Farmer app (`c05-app`) | 1:14.5–1:36.0 | Home "Today" cards. WATER TODAY: 35 mm · 1,750 L · ≈70 min with the arithmetic; High confidence; Spinach beds next Saturday | Real UI |
| 6 | Science (`c06-science`) | 1:36.0–2:00.5 | ETo → Kc → ETc → TAW/RAW → Dr; root-zone gauge; Dr ≥ RAW → irrigation needed | Conceptual |
| 7 | Why (`c07-why`) | 2:00.5–2:19.0 | Tap "Why am I seeing this?" (real sheet); numbers grid; admin's real technical line; Dr ≥ RAW, rain < use → WATER TODAY | Real UI |
| 8 | Farmer in control (`c08-decide`) | 2:19.0–2:35.9 | "AgroFlow recommends. The farmer decides." I watered → 1500 L → "Watering logged. Today's advice now counts it." → "No watering needed today"; soil-feel sheet | Real UI |
| 9 | Irrigation action (`c09-act`) | 2:35.9–2:56.4 | Manual run: 90 → "Invalid Duration" → 5 → confirm → sent; app → API → MQTT → ESP32 relay → pump → soil wets; run reported; History | Real UI + sped-up visualisation |
| 10 | Next 7 days (`c10-week`) | 2:56.4–3:15.5 | The week-ahead screen; projected depletion per day vs RAW; Tuesday likely; "no weekly reset" | Real UI + visualisation |
| 11 | Weather update (`c11-update`) | 3:15.5–3:37.9 | HEAVY RAIN EXPECTED Saturday 22 mm; forecast screen updates; bars recalculate; PLAN UPDATED; four rain rules | Real UI + visualisation |
| 12 | Alerts + check the field (`c12-alerts`) | 3:37.9–3:55.5 | Telegram heavy-rain text + Why; one probe = one spot; kit/sensor checks; real kit-status card; soil-feel sheet | AgroFlow text + real UI |
| 13 | Incomplete setup (`c13-setup`) | 3:55.5–4:10.9 | Maize block: litres only, Medium confidence, "Add the pump's flow rate…"; Finish setup with the 500 mL bottle helper | Real UI |
| 14 | Admin (`c14-admin`) | 4:10.9–4:32.7 | Public website → Home → Requests → farm detail (same advice) → Run advice now → Kits → Alerts → Maintenance → Reports → Activity | Real UI |
| 15 | Summary (`c15-summary`) | 4:32.7–4:43.4 | Five inputs → actionable irrigation guidance → SENSE → UNDERSTAND → ACT → MONITOR | Conceptual |
| 16 | Close (`c16-close`) | 4:43.4–4:53.2 | AgroFlow by MafiHub · "Practical irrigation decisions, grounded in field data." · UCT School of IT Showcase 2026 · INF3003W Team 2 | Brand |

## On-screen honesty

- Bottom-left tag in every scene after the opening: "Real AgroFlow app · illustrative demo data",
  "Conceptual visualisation", "Illustration · not a photograph", or a mix where a scene has both.
- The two app dialogs (validation, confirmation) are browser dialogs that page recording cannot capture.
  Their text was captured verbatim from the running app and is shown in a neutral overlay labelled
  "App dialog · text captured from the running app".
- The Telegram alert is laid out from the exact text the backend sends and is labelled as such.
- No AI claim, no yield/savings statistics, no hardware the kit does not have.
