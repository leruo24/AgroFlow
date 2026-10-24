# AgroFlow UI redesign handoff

- Branch: `feat/agroflow-ui-redesign`
- Target: `dev`
- Status: implementation complete; do not deploy or merge from this handoff

## Summary

- Reworked the shared light/dark palette around warm white, navy text and irrigation blue actions, with green retained for crops and healthy states.
- Replaced the public theme select with an accessible Light/System/Dark water-themed segmented control. The preference persists, responds to keyboard arrows and is applied before first paint.
- Simplified the public header to Home, Our service, About, Get the app and Contact. Our service is a compact disclosure containing Solutions, How it works, Technology and Service & pricing.
- Removed Experience from public navigation, redirects `/experience` to `/get-the-app`, and retained the useful app gallery on Get the app.
- Added explicit mobile-menu close/focus behavior, responsive media loading, reduced-motion handling and restrained button ripples.
- Kept the Technology viewer behavior and static fallback, while making the irrigation preview explicitly simulated, visually isolated from command APIs and automatically stopping after eight seconds.
- Modernised the farmer app dock with a readable blue/navy gradient and corrected light-theme profile-link contrast.
- Rebuilt the staff sidebar as compact collapsible groups, moved Profile/Notifications/Log out to its footer, and added a focus-managed mobile drawer with explicit close, Escape and short-height scrolling.
- Preserved authentication, API contracts, pricing/legal integrations, enquiry behavior, irrigation safety, localization, database schema and firmware.

## Screenshot evidence

All screenshots use local fixtures or simulated farms. The full evidence set is under [`test-evidence/ui-redesign-2026-10-24`](./test-evidence/ui-redesign-2026-10-24/).

| Surface | Theme and size | Before | After |
| --- | --- | --- | --- |
| Public home | Light, 390×844 | [before](./test-evidence/ui-redesign-2026-10-24/before/public-home-light-phone.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/public-home-light-phone.png) |
| Public home | Dark, 390×844 | [before](./test-evidence/ui-redesign-2026-10-24/before/public-home-dark-phone.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/public-home-dark-phone.png) |
| Public home | Light, 1366×768 | [before](./test-evidence/ui-redesign-2026-10-24/before/public-home-light-desktop.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/public-home-light-desktop.png) |
| Public home | Dark, 1366×768 | [before](./test-evidence/ui-redesign-2026-10-24/before/public-home-dark-desktop.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/public-home-dark-desktop.png) |
| Farmer home | Light, 390×844 | [before](./test-evidence/ui-redesign-2026-10-24/before/farmer-home-light-phone.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/farmer-home-light-390.png) |
| Farmer home | Dark, 390×844 | [before](./test-evidence/ui-redesign-2026-10-24/before/farmer-home-dark-phone.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/farmer-home-dark-390.png) |
| Farmer home | Light, 1366×768 | [before](./test-evidence/ui-redesign-2026-10-24/before/farmer-home-light-desktop.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/farmer-home-light-1366.png) |
| Farmer home | Dark, 1366×768 | [before](./test-evidence/ui-redesign-2026-10-24/before/farmer-home-dark-desktop.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/farmer-home-dark-1366.png) |
| Staff dashboard | Light, 390×844 | [before](./test-evidence/ui-redesign-2026-10-24/before/staff-dashboard-light-phone.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/staff-dashboard-light-phone.png) |
| Staff dashboard | Dark, 390×844 | [before](./test-evidence/ui-redesign-2026-10-24/before/staff-dashboard-dark-phone.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/staff-dashboard-dark-phone.png) |
| Staff dashboard | Light, 1366×768 | [before](./test-evidence/ui-redesign-2026-10-24/before/staff-dashboard-light-desktop.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/staff-dashboard-light-desktop.png) |
| Staff dashboard | Dark, 1366×768 | [before](./test-evidence/ui-redesign-2026-10-24/before/staff-dashboard-dark-desktop.png) | [after](./test-evidence/ui-redesign-2026-10-24/after/staff-dashboard-dark-desktop.png) |

Additional evidence: [public mobile menu, light](./test-evidence/ui-redesign-2026-10-24/after/public-menu-light-phone.png), [public mobile menu, dark](./test-evidence/ui-redesign-2026-10-24/after/public-menu-dark-phone.png), [staff drawer, light](./test-evidence/ui-redesign-2026-10-24/after/staff-drawer-light-phone.png), [staff drawer, dark](./test-evidence/ui-redesign-2026-10-24/after/staff-drawer-dark-phone.png), and public Technology/farmer Profile captures in the same directory.

## Verification

- Mobile TypeScript: `npx tsc --noEmit` — passed.
- Mobile component tests: `npx jest --runInBand` — 31 suites, 362 tests and 1 snapshot passed.
- Mobile Expo web export: passed; 2,886 modules and 30 assets exported.
- Mobile visual/accessibility matrix: 76 route/viewport/theme checks; 0 Axe contrast failures, 0 horizontal-overflow failures and 0 page errors.
- Admin TypeScript: `npm run typecheck` — passed.
- Admin production build: `npm run build` — passed; Vite reports the existing large-chunk advisory for the Three.js/main bundles.
- Public/staff evidence runner: 4/4 full cases passed; the two phone drawer/menu refresh cases also passed.
- Admin Playwright full run 1: 247/248 passed; the only failure was an outdated test that tried to click Service & pricing without opening the new Our service disclosure. The corrected release-wiring file then passed 4/4.
- Admin Playwright full run 2: 247/248 passed, including the corrected pricing test. One async installer-drawer test intermittently observed `0` immediately after filling `6`; the same test passed in the first full run. Its assertion was strengthened to confirm the current drawer input value before submission, then passed 10/10 repeated runs while still verifying the exact `{ provenance: "measured", flowRateLpm: 6 }` request body.
- `git diff --check` — passed.

No live enquiries, Telegram messages, enrollment codes, passwords, irrigation commands or external writes were used.

## Missing media assets

The repository does not contain the three finished tutorial videos described in the brief. Before embedding them, supply for each of the three videos:

1. The approved video file or stable HTTPS media URL.
2. Its approved title and intended page/order.
3. An approved poster image.
4. A WebVTT caption file and transcript, if available.

No placeholder URLs, fake video controls or invented tutorial topics were added.

## Functional issues and limitations

- The ChatGPT-hosted reference pages required owner authentication and were not accessible without bypassing it, so implementation followed the written specification and existing repository design assets.
- No issue requiring a backend, database, firmware or API-contract change was found.
- The production build succeeds but still emits Vite's large-chunk warning for the Three.js and main bundles. Further splitting is a separate performance task.
- The full Playwright suite exposed the async installer-drawer test race described above. It did not reproduce in 10 strengthened repetitions; this handoff records the observation rather than hiding it.
