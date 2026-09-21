# Mobile device and desktop bug verification

> **Superseded on 2026-09-21: `expo-blur` has been removed from the app.**
> Everything below about frosted/blurred tab bars and sheet backdrops is a
> record of how it worked then, not how it works now. The blur layer crashed
> the app natively on startup in Expo Go SDK 57 on both iPhone and Android —
> clean bundle, no red screen, straight back to the Expo Go home screen. The
> tab bar is now a solid `tabBarSurface` token with a hairline border and
> shadow, and sheet backdrops use a `scrim` token. The `BlurSheet` component
> keeps its name and API but no longer blurs anything. Do not treat the blur
> described below as a regression to be fixed. See section 2 of
> `docs/ORIENTATION.md`.

Captured on 2026-09-17 with a 390 × 844 Chromium viewport, isolated API fixtures, and Expo SDK 57. The fixture contains 12 zones, 24 alerts, and 24 history events so every tab can scroll. These images are browser renders, not physical device captures.

## 1. Metro startup

`netstat -ano` found a stale Node listener on port 8081 even though `Get-NetTCPConnection` found none. After stopping that PID, `npx expo start --clear` reached `Waiting on http://localhost:8081` and bundled the web entry. Its only error was `An unknown error occurred while installing React Native DevTools. Details: spawn EPERM` in the restricted process sandbox. Metro still served HTTP 200. A repeat start with process permission had no such error. The new `npm run start:clean` script stops only Node listeners on 8081, then starts Expo with a cleared cache; its own run stopped another stale Node listener, reached Metro ready, and bundled web successfully.

## 2. Frosted tab bar and sheets

The tab bar background was already defined once in the Tabs navigator, and the bar was already absolutely positioned. The actual visual defect was that it painted an opaque `colors.surface` over its background. Expo BlurView on web also sets its own `rgba(249, 249, 249, 0.35)` background, so a color passed directly to the blur component would be overridden. The navigator now renders a BlurView plus a separate theme overlay, with a translucent fallback on Android below API 31. The bar remains absolute and the tab scroll views keep their bottom clearance.

The browser check scrolled each screen, positioned real page text at y≈791 under the bar whose top was y=769, and confirmed the rendered blur filter was `saturate(1.8) blur(9px)` with a separate `rgba(255, 255, 255, 0.16)` overlay. Each pair below is the same scroll position. The *underlay* image temporarily hides only the two bar background layers in the test browser to expose the page content behind them; the *frosted* image is the unmodified rendered app.

| Tab | Frosted | Underlay |
| --- | --- | --- |
| Home | [image](home-frosted.png) | [image](home-underlay.png) |
| Irrigation | [image](irrigation-frosted.png) | [image](irrigation-underlay.png) |
| Alerts | [image](alerts-frosted.png) | [image](alerts-underlay.png) |
| History | [image](history-frosted.png) | [image](history-underlay.png) |
| Settings | [image](settings-frosted.png) | [image](settings-underlay.png) |

The sheet backdrop blur remained present in the rendered [Farm Selector](farm-sheet.png), [Edit Zone](edit-zone.png), and [Edit Schedule](edit-schedule.png). The browser checks found a blur filter on each open sheet.

## 3. Lag investigation

Before changing performance code, a 1.2-second automated scroll on each dense tab showed a 16.7 ms median animation frame and zero frames over 33 ms. The context value is recreated on provider renders and alert/history rows use keyed `.map()`, but the desktop trace did not show a rerender storm. These observations did not justify changing the context or list rendering.

The Home map had a measurable source of work: its `key` included the zoom value, forcing a full map surface remount on every zoom. The three-zoom browser benchmark found three remounts before the change and none after removing that key. Total Chrome `TaskDuration` for the same three zooms fell from 120 ms to 73 ms (39% lower); tile appearance times were 44/45/36 ms before and 25/20/25 ms after. The web map now tracks loaded state per zoom so the image failure timer still works when the component persists. The Android below API 31 tab bar uses a translucent surface to avoid the older blur path; native frame timing remains unmeasured here.

## Final checks

- `npx tsc --noEmit`: passed.
- `npx expo export --platform web`: passed; 18 static routes exported.
- `npx expo export --platform ios`: passed and produced a Hermes `.hbc` bundle. The restricted first attempt failed at Hermes `spawn EPERM`; the process-permitted retry passed.
- Five dense tab renders and three sheet renders: passed. The browser fixture is in `apps/mobile/scripts/ui-smoke.mjs`.

Physical iOS/Android touch performance and native blur appearance still require device measurements; the before/after performance claim above applies to Chromium web map zoom.
