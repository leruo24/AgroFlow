## GO GREEN premium visuals (draft, do not merge)

Based on dev `3d0ea56`, after verifying PR #4 and Claude's Kit/retest work are
ancestors. No backend, API, firmware, migration, configuration/secrets, route
definitions, FAO-56 or PrimaryAction changes. Original workspace firmware edit
left untouched. Automatic preview deployments only; no production deployment.

### Presentation

- Green-led Light/Dark tokens and dated audit colour decision.
- Supplied photographic public hero/features/About/Technology scenes, with small
  representative-image captions; no fictional customer farms.
- Compact farmer photo header, stable id-based farm thumbnails, crop-appropriate
  artwork and sensor photo separate from operational readings/controls.
- Restrained staff Overview/Maintenance/Reports photos and farm covers/details.
- Five tabs, Kit checklist/help, four-task setup/hosepipe, honest data states,
  terms preview, container/gutters and reduced motion retained.
- Dark form/date controls and selected settings tabs corrected for contrast.

### Asset optimization

All ten originals retained unchanged in the repository. Web: 24 responsive WebP
variants (1,205,438 bytes total); mobile: ten optimized copies (492,332 bytes vs
3,777,224 original bytes, about 87% smaller). No upscaling or EXIF in derivatives.
Below-fold images lazy-load; hero alone is eager/high-priority. `sharp` is a
development-only reproducible optimizer dependency; no new native dependencies.

### Checks

- Admin install, TypeScript/build: passed (existing large-chunk warning).
- Full Playwright: **247/247 passed**, configured single worker, zero skips;
  first two-worker run 245/247. The two failed cases
  (stale blue-colour expectation, demo cold-open timeout) subsequently passed
  three repetitions each; the green-colour assertion was corrected.
- Mobile TypeScript: passed. Jest: 31 suites, 361 tests, one snapshot passed.
- Mobile web and Android exports: passed (not an APK/device build).
- Farmer local browser: 76 checks passed, no page errors/overflow.
- Axe: 176 screenshot scans at 390x844 and 1366x768, both themes; zero contrast
  or image-alt violations. Other semantic findings are explicitly retained in
  the JSON and documented; this is not full WCAG certification.
- Deep-link refresh/security headers: 20 public/staff + 6 farmer passed.
- Unrun: physical device/APK/EAS/iOS export, Safari/Firefox, assistive technology,
  live persistence/accounts, backend/firmware suites (unchanged), translation
  speaker review. No tests skipped intentionally.

### Evidence, fixture boundaries and handoff

[Screenshots, axe JSON, local preview commands and Claude handoff](https://github.com/leruo24/AgroFlow/blob/feat/premium-visuals/docs/test-evidence/premium-visuals/README.md).
Farmer screenshots use intercepted, simulated Mahikeng fixtures; they do not
prove live wizard, kit or persistence wiring. This PR does not implement new
personality logic, change the wizard or enable terms acceptance. Review those
through the existing services on a separate logic branch.

Keep this PR **draft**. Do not merge or promote its previews to production.
