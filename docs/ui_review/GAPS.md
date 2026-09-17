# Mobile UI review

## Implemented

- Zone and automation editing and schedule editing now open in the shared `BlurSheet`. The existing save, cancel, validation, and loading handlers are retained.
- Zone configuration, schedule, and system status now use full-width rows with hairline dividers. The edit sheet uses rounded inputs and flat switch rows.
- The floating tab bar uses the shared blur intensity and a translucent theme surface. Android 12+ uses the SDK 31 blur method; older Android versions keep the translucent surface.
- The UI fixture now models the API's case-sensitive `Open` alert status, so unread alerts appear in review screenshots.

## Rendered review

Screenshots in [`after/`](after/) cover login, password recovery and its confirmation, Home with the map expanded and collapsed, Irrigation, unread and read Alerts, History, Settings in both themes, Profile, farm selection, the zone detail and both edit sheets, plus Home loading, empty, and error states. The rendered web sheets have visible blur and legible controls. The tab bar remains legible against Home content in light mode and Settings content in dark mode. The zone detail rows are flat and readable at 390px width. The mock command flow sent both start and stop requests.

The browser flow also passed farm switching, map expansion and collapse, alert navigation and read state, theme and notification settings, profile editing, password update, logout, and password recovery. TypeScript, web export, and iOS export passed. The iOS export required a second run with permission to spawn the Hermes compiler after Windows returned `spawn EPERM` in the restricted run.

| Check | Result | Evidence or limit |
| --- | --- | --- |
| Neutral page surfaces and typography hierarchy | Pass in captured web screens | `home.png`, `settings-light.png`, `zone-detail.png` |
| Hairline rows, restrained corners, legible touch controls | Pass in changed zone sections | `zone-detail.png`, `zone-edit.png`, `schedule-edit.png` |
| Farm selector and edit sheets render blur | Pass on web | `farm-selector.png`, `zone-edit.png`, `schedule-edit.png` |
| Floating tab bar renders a translucent blur in both themes | Pass on web | `home.png`, `settings-dark.png` |
| All screens match the approved reference side by side | Unverified | `docs/ui_reference/` is absent from this checkout |
| Real seeded data and backend flows | Unverified | Screenshots use the isolated `ui-smoke.mjs` browser fixture |
| Native blur, map tiles, and touch feel | Unverified | Requires the physical device pass |

There is no before screenshot set. The rendered captures were taken after the implementation began, so a genuine before/after comparison cannot be claimed.
