# Storyboard — AgroFlow · UCT School of IT Showcase 2026 · INF3003W Team 2

1920×1080, 25 fps. Active demonstration 0:00–4:20, editor end plate 4:20–4:50 (v2, aligned with the team's system description; see `CLIP-REVIEW.md`).

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
| 2 | 0:10–0:30 | Persona & problem | "MEET OUR FARMER — Smallholder Farmer". Watering by habit. Three crop zones; Zone 2 dries, "ZONE 2 NEEDS ATTENTION". The field folds into a phone (app opening screen). | Conceptual |
| 3 | 0:30–1:00 | Farmer opens AgroFlow | App opens on Home: Drip says "Water Zone 2 now: about 5 min (~8 L)." → weather, farm status (1 unread alert) → Manage Irrigation → all zones; Zone 2 "Health: Critical, 19%" → Manage Zone. | Real UI |
| 4 | 1:00–1:35 | Understand the zone | Live Overview: 19% **Dry**, 30°C, 36%. Diagram: soil probe + DHT11 → ESP32 kit → MQTT (TLS) → AgroFlow.Api on Railway → Supabase. Crop + growth stage. | Real UI + conceptual |
| 5 | 1:35–2:13 | How the advice is worked out | FAO-56 in four steps (weather thirst · crop stage · soil & roots · daily tally), reality check (sensor) and rain check (skip) → "Water Zone 2 now: about 5 min (~8 L)", minutes from flow rate. App: Advice card → the week ahead, no rain. | Conceptual + real UI |
| 6 | 2:13–3:06 | Irrigation action, validation, outcome | Manual → 90 → "Invalid Duration…" (INPUT VALIDATED) → 5 → confirm → "Manual command sent". Command path → relay, pump on. Event recorded. History: "Irrigation ran for 5 minutes · Zone 2 · manual". | Real UI + conceptual |
| 8 | 3:06–3:50 | Platform Administrator | "ONE FARMER'S ACTION → ONE CONNECTED PLATFORM". Admin Home → Requests → Kits (Zone 2 kit; Change WiFi · Open setup page · Revoke) → Alerts (Zone 2 alert → detail) → Reports (Farm Reports, live data: PDF/Excel) → Activity. Phone width. "Farmers manage their farms. Administrators oversee the platform." | Real UI |
| 9 | 3:50–4:12 | Complete system & kit safety | Field ⇄ platform (incl. Railway, Telegram) ⇄ app / console. "The kit stays safe, even offline": 5-min cap, per-kit key, offline fallback after 10 min (≤ 60 s runs, 5 min rest). SENSE · UNDERSTAND · ACT · MONITOR. | Conceptual |
| 10 | 4:12–4:20 | Close | Farmer Home pulls back into brand: "AGROFLOW — From field conditions to informed irrigation." | Real UI + brand |
| — | 4:20–4:50 | Editor end plate | Small AgroFlow mark bottom-left, large clean space, very subtle node drift. | — |

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
