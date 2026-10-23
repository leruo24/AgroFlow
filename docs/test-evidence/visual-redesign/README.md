# Visual redesign evidence

All data is synthetic; all API/Supabase traffic uses mocked test hosts. No real
farmer, credential, kit or irrigation action is represented.

165 PNGs cover 320×844, 390×844, 768×1024 and 1366×768 viewports in English,
Afrikaans and Setswana. Long public/staff pages are captured full-page.

- `public-*`: Home, About, Contact, development component catalogue; Home at 200% text.
- `mobile-*`: Home, zone, tank, Settings, Simple view and Home at 200% text.
- `staff-dashboard-*`, `staff-onboarding-*`: existing staff routes in all sizes/languages.
- `staff-390-dark.png`: dark account menu and work surfaces.
- `playwright-final.json`: final 34-test public/demo/evidence regression, all passing.
- `playwright-followup.json`: final 4-test dark-colour/navigation recheck, all passing.
- `playwright-contracts.json`: 14 contract/legal/catalogue checks, all passing.
- `playwright-demo-followup.json`: 4 demo-copy regressions, all passing.
- `playwright-demo-responsive.json`: 3 demo cases passing, including a screenshot/overflow loop at six widths.
- `public-experience-2d-en-*`: actual lightweight simulated demo at all requested widths,
  plus the existing 1024/1440 checks. The old 80-minute label is not presented.

New af/tn copy is draft and requires fluent-speaker review. Existing English-only
staff/form/demo copy is visible where its original components have not yet been localised.
Screenshots are not a claim of completed language review or accessibility certification.
External map tiles are deliberately blocked by the farmer fixture harness.

See [the handoff report](../../visual-redesign.md) for scope, route changes,
check counts, integration dependencies and device checks that remain outstanding.

Reproduce the public/staff matrix from `apps/web/admin` with
`npx playwright test visual-redesign.spec.ts`; the test configuration uses mock services.
For farmer captures, export with the dummy settings described at the top of
`apps/mobile/scripts/visual-redesign-screenshots.mjs`, then run that script.
Optional `VISUAL_WIDTH` and `VISUAL_LANGUAGE` environment variables limit a recheck.
