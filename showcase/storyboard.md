# Storyboard — AgroFlow · UCT School of IT Showcase 2026 · INF3003W Team 2

1920×1080, 25 fps. Active demonstration 0:00–4:00, editor end plate 4:00–4:30.

**Persona:** Smallholder Farmer (no named persona material exists in the repository;
no demographic detail is invented). **Second persona:** Platform Administrator.

**Situation:** the farmer grows three zones on *Green Valley (demo)* — tomato, spinach,
maize. Zone 2 (spinach) waters on a schedule; its next run is Friday, but its soil is
already dry (19%, below its 30% start level). AgroFlow shows it, explains it, and the
farmer acts in a few taps. The run is 5 minutes because the current firmware stops every
pump cycle at 5 minutes (`SAFETY_MAX_RUN_MS`), so a longer command would not run as asked.

Real UI = screen recordings of the unmodified apps (demo data, labelled on screen).
Conceptual = original motion graphics, labelled on screen.

| # | Time | Beat | Picture | Kind |
|---|---|---|---|---|
| 1 | 0:00–0:10 | Title | Network nodes draw, water line flows, real AgroFlow icon, "AGROFLOW · Smart Irrigation Management System · UCT School of IT Showcase 2026 · INF3003W · Team 2" | Conceptual |
| 2 | 0:10–0:30 | Persona & problem | "MEET OUR FARMER — Smallholder Farmer". Three crop zones drawn (Tomato, Spinach, Maize). Zone 2 dries (soil colour shifts), "ZONE 2 NEEDS ATTENTION". The field folds into a phone. | Conceptual |
| 3 | 0:30–1:00 | Farmer opens AgroFlow | Sign in → Home (weather, farm status: 1 unread alert) → Manage Irrigation → all zones; Zone 2 "Health: Critical, 19%" highlighted → Manage Zone. Overlay: "ONE VIEW OF EVERY ZONE". | Real UI |
| 4 | 1:00–1:35 | Understand the zone | Push into Live Overview: 19% Soil Moisture **Dry**, 30°C, 36%. Pull out: soil probe + DHT11 → ESP32 → MQTT (TLS) → AgroFlow.Api → Supabase → app. Back to the zone: crop + growth stage. | Real UI + conceptual |
| 5 | 1:35–2:05 | Data → action | "AGROFLOW ANALYSES": crop & stage, soil, weather forecast, zone levels → FAO-56 water balance → IRRIGATION ADVICE. Back to app: Advice "Water Zone 2 now: about 5 min (~8 L)." → The week ahead: no rain expected. | Conceptual + real UI |
| 6 | 2:05–2:58 | Irrigation action, validation, outcome | Switch Zone 2 to Manual → type 90 → Start → "Invalid Duration — Enter a duration between 1 and 60 minutes." (INPUT VALIDATED) → 5 → "Run irrigation for 5 minutes?" → Start → "Manual command sent". Command path graphic → relay, pump OFF→ON, water to crop. History: "Irrigation recorded — Irrigation ran for 5 minutes · Zone 2 · manual". | Real UI + conceptual |
| 8 | 2:58–3:36 | Platform Administrator | "ONE FARMER'S ACTION → ONE CONNECTED PLATFORM". Admin Home (needs attention, KPIs, system health) → Farms & zones → Kits (Zone 2 kit: Online, last seen, token, status) → Alerts (Zone 2 critical alert → detail) → Maintenance → Activity. Same console at phone width. "Farmers manage their farms. Administrators oversee the platform." | Real UI |
| 9 | 3:36–3:52 | Complete system | FIELD (sensors, ESP32, pump) ⇄ AGROFLOW PLATFORM ⇄ FARMER APP / ADMIN CONSOLE, packets both ways. Then SENSE · UNDERSTAND · ACT · MONITOR. | Conceptual |
| 10 | 3:52–4:00 | Close | Farmer Home pulls back into brand: "AGROFLOW — From field conditions to informed irrigation." | Real UI + brand |
| — | 4:00–4:30 | Editor end plate | Small AgroFlow mark bottom-left, large clean space, very subtle node drift. | — |

(Scene 7 "validation" is folded into Scene 6, where it happens naturally in the story:
the farmer's first duration is rejected, corrected, and accepted.)

## On-screen honesty

- Bottom-left tag throughout: "Real AgroFlow app · illustrative demo data" or
  "Conceptual visualisation".
- The two app dialogs (validation, confirmation) are browser/OS dialogs that page
  recording cannot capture. Their text is captured verbatim from the running app
  (`assets/rec/mobile-dialogs.json`) and shown in a neutral system-dialog overlay
  labelled "App dialog (text captured from the app)".
- No AI claim, no savings/yield/uptime statistics.
