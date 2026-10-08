# Showcase rubric check (v3)

Evidence is the time code in `renders/AgroFlow_Showcase_Walkthrough_Final.mp4` (4:53).

## System demonstration
- [x] **Main features** — actionable advice on Home 1:14, FAO-56 explained 1:36, "Why am I seeing this?" 2:00,
  farmer logs what they did 2:19, run from the app 2:36, week ahead 2:56, weather update and recalculation 3:15,
  alerts and sensor checks 3:38, incomplete setup 3:55, admin oversight 4:11.
- [x] **Brief system walkthrough** — field kit 0:34, architecture 0:58, app → pump 2:46, summary 4:33.
- [x] **Site design** — real farmer app, real public website and admin console, unmodified.
- [x] **UX** — taps shown at their recorded moments; real sheets, dialogs and confirmation messages.
- [x] **Consistency** — one farm, one Tomato field and one set of numbers (Dr 35 mm, RAW 31.5 mm, 1,750 L, 70 min)
  from the Home card through the Why sheet to the admin's Run-advice drawer.
- [x] **Logical sequence** — problem → sensing → decision → farmer's choice → action → outlook → weather change → alerts → oversight.
- [x] **Mobile experience** — 1:14–4:11. **Web experience** — 4:11–4:33.

## Accuracy
- [x] No AI claim ("a deterministic calculation, not AI", 0:30).
- [x] Hardware limited to the kit's real parts: ESP32, YL-69 resistive Soil Moisture Sensor, DHT11, relay, pump, 5 V power.
- [x] Field / irrigation-zone language throughout; the kit drawing is labelled as an illustration.
- [x] Farmer autonomy: recommendations only; the farmer's own amount is what is recorded.
- [x] Rain logic matches the code: skip only when rain ≥ the day's crop use.
- [x] Every simulated or conceptual picture is tagged on screen.
