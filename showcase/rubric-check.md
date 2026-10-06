# Showcase rubric check (verified on the preview render before the final)

Evidence is the time code in the video.

## System demonstration
- [x] **Main features** — zone readings 1:00, FAO-56 advice 1:35–1:55, forecast 1:55, manual irrigation 2:05, history 2:45, admin oversight 2:58–3:36.
- [x] **Brief system walkthrough** — field → platform → app 1:12–1:22; app → pump 2:30–2:45; whole system 3:36.
- [x] **Site design** — real farmer app (production web build) and real admin console, unmodified.
- [x] **UX** — every tap/click shown at its real moment (touch rings, cursor); real navigation and feedback.
- [x] **Consistency** — one demo farm, one zone and one alert followed from farmer to administrator.
- [x] **Logical sequence** — problem → open app → understand → advice → act → field → record → oversight.
- [x] **Mobile experience** — 0:30–2:58.
- [x] **Web experience** — 2:58–3:36, plus the console at phone width (3:32).

## User interface
- [x] **Not too busy** — one caption, a short step list and one highlight at a time.
- [x] **Original design** — all graphics made for this video; only the real AgroFlow icon is reused.
- [x] **Ease of use** — the irrigation action is four taps (Manual → duration → Start → confirm).
- [x] **Not too many clicks** — the same four taps, shown on screen.
- [x] **Clear messages** — "Invalid Duration — Enter a duration between 1 and 60 minutes." and "Manual command sent".
- [x] **Logical flow** — Home → all zones → Zone 2 → advice → forecast → action → history.

## Functionality
- [x] **Appropriate scope** — the farmer journey plus admin oversight.
- [x] **Meaningful complexity** — sensor → MQTT → service → database, FAO-56 water balance, command path back to the relay.
- [x] **Working implementation** — every feature shown is implemented in `dev` (see `system-audit.md`).

## Stability
- [x] **No crashes** — no error screens. The dev-only React key warning was avoided by using the production build.
- [x] **Coherent data** — the same values appear in the app and the console (19%, Critical alert 301, kit A4CF12B7E9C4).
- [x] **Realistic data** — chosen to obey the backend rules: Critical below 20%, scheduled zones don't auto-start, 5-minute firmware cap.

## Validation / testing
- [x] **Real input validation** — at 2:12: 90 minutes rejected, corrected to 5, confirmed. Dialog text captured verbatim from the running app.

## Story
- [x] **Persona-driven** — Smallholder Farmer, then Platform Administrator.
- [x] **Not a test-case list** — one situation, Zone 2 drying out, carries the whole demo.
- [x] **Business value** — a clear action instead of raw numbers, in a few taps, with a record afterwards. No invented statistics.
- [x] **Beginning, problem, action, outcome** — 0:10 problem, 2:05 action, 2:45 outcome, 3:36 the whole system.

## Accuracy checks
- [x] No "AI-powered" claim: the engine is described as a deterministic FAO-56 calculation.
- [x] No savings, yield or uptime figures.
- [x] Admin is shown overseeing, not irrigating (and says so).
- [x] Real UI and conceptual graphics are labelled on screen throughout.
- [x] The two app dialogs are labelled "App dialog · text captured from the running app".
- [x] No secrets on screen: demo `.invalid` e-mails, password masked, placeholder hosts only.
