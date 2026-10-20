# Farmer app: spacing and layout pass (fix/app-spacing)

This pass changed layout and wording only. The watering advice (FAO-56), what each
button does, and the data are all unchanged. New and changed strings are in en, af and tn.
The af and tn strings are drafts that need review.

Screenshots of every screen at 320×568, 390×844, 430×932 and 1366×768 are in
`docs/test-evidence/app-spacing/before/` and `.../after/`. Each screen has two shots: the
top of the screen (`<size>-<screen>.png`) and the screen scrolled to the end
(`<size>-<screen>-bottom.png`). `scripts/spacing-screenshots.mjs` takes them from the real
web export, using the same demo farm each time.

## The shared parts

| What | Where |
|---|---|
| Spacing scale 4 / 8 / 12 / 16 / 24 / 32 (`Space.xs … xxl`) | `constants/colors.ts` |
| Type scale by role: title 28, section 18, body 15, label 13, small 11/12 (`TypeScale`) | `constants/colors.ts` |
| Layout: 16 side gutter, 16 card padding, 12 between cards, 12 from a heading to its first card, 24 between sections (`Layout`) | `constants/colors.ts` |
| One card look (`cardStyle`, `<Card>`, `<CardList>`): padding 16, radius 12, 1 px border, surface background | `components/ui/Card.tsx` |
| Two-column label/value grid: each cell is exactly half the row, and values stay on one line and shrink slightly rather than wrap (`<InfoGrid>`) | `components/ui/InfoGrid.tsx` |
| Equal-width stats row with the value above the label (`<StatsRow>`) | `components/ui/StatsRow.tsx` |
| Friendly, translated labels for stored values (crop, soil, mode, health, sensor, trigger), plus the empty-state wording | `lib/labels.ts` |
| Bottom padding = floating tab bar + its margin + bottom safe area + 16 (`useBottomPadding`) | `hooks/useScreenPadding.ts` |
| Page header: title and help/avatar buttons on one centred row, subtitle full width below | `components/ScreenHeader.tsx` |

The padding, margin and gap values in the style files and screens were snapped to the scale
(179 values, with ties rounding down). Values of 0–3 px (hairlines, optical nudges) and
values above 32 (fixed sizes such as 48 px touch targets) were left as they were.

**Empty states, one wording everywhere:**
- "Waiting for your kit's first reading"
- "No watering yet"
- "None yet today"
- "No kit connected"
- "Not set yet"
- "No crop yet"

These replace "No reading", "No data", "Never", "Unavailable" and "Unknown".

## Fixes per screen

**All screens**
- Every scroll view ends above the floating tab bar, with the safe area and 16 px to spare.
- Every screen uses one 16 px gutter (some were 24 px).
- Web: once the app is up, the page body and the `theme-color` tag take the screen
  background. This removes the grey band above the page on iPhone and Android web; before,
  the body kept the loading video's #F9FBF8.
- Android: a `StatusBar` with icons that match the theme. The app is edge to edge, so the
  screen colour shows behind the bar.
- Header: the subtitle runs the full width, so it no longer wraps early beside the buttons at
  320–390 px. The title can take two lines.
- Tab bar at < 360 px: a smaller side margin and label, so the "Irrigation" tab label fits.

**Home**
- The Today zones and the tank are cards, 12 px apart.
- The metrics are a real two-column grid.
- "Irrigating: Unknown" is now "Watering now": a count of zones with a run underway, or
  "No kit connected" when the farm has no kit. "No data" became "None yet today", and
  "No reading" became the kit wording.

**Irrigation**
- The stats row has equal columns and no longer runs together. "Unknown" is a count, or "—"
  with "No kit connected".
- Each zone is a card.
- "leafy_veg" now shows as "Leafy vegetables", and the health value is friendly ("Not known
  yet").
- The four readings are a two-column grid. The last watering shows as "20 Oct 2026", not
  "2026-10-20".
- "Manage zone" is never under the tab bar.
- All the screen's text is translated (it was English-only).

**Zone detail**
- Live readings: one card with a two-column grid, replacing the three-across tiles that broke
  "Temperatur/e" and cut "Unava…" at 320 px.
- The "Flow Rate" tile was removed. It always said "Unavailable" because the zone record does
  not carry the flow rate.
- A zone with no kit says "No kit connected" instead of "Unavailable" and "Unknown".
- Labels for crop, mode, health, sensor status and relay ("Not reported by the kit"). The
  schedule shows "Not set yet" instead of blanks and "0 min".
- Header: the zone name takes two lines and the place line two lines, with 12 px between the
  header items (was 24).
- The section caption sits under its heading instead of wrapping beside it.

**Alerts**
- The stats row uses `StatsRow`.
- Each alert is a card, with a red border when it is critical.
- The dismissed list uses cards too.
- The labels are translated ("New", "Restore", "Dismissed", "Time not known").

**History**
- Both lists are cards.
- The trigger source is a label ("Started by you", "Automatic", "Schedule") instead of
  "manual · irrigation".

**Reports**
- Each report is a card.
- The gutter is 16 px.
- The list ends above the bottom safe area.

**Settings, Profile, Tank and pH, Forecast, Kit, Soil, Crop, Request, Enquiry**
- 16 px gutter, the bottom padding, and spacing on the scale.

**Setup wizard**
- 16 px gutter in the progress header, body and footer, and the bottom padding.

**Sign-in, reset password, set password, one-tap sign-in**
- Spacing on the scale and the bottom padding (inset + 16).

## Tests

- `components/__tests__/appSpacing.test.tsx` (15 tests):
  - every known crop, soil, mode, health, sensor and trigger value has a label in en, af and
    tn, never the raw value or a missing key;
  - the values the sponsor saw map correctly; unknown values are tidied, never shown raw;
  - the empty-state phrases exist in all three languages;
  - the spacing scale and the bottom-padding sum;
  - a snapshot of `Card`, `InfoGrid` and `StatsRow`;
  - a grid cell is half the row and a number stays on one line;
  - Irrigation and zone detail show none of "leafy_veg", "Unknown", "No data",
    "Unavailable", "Never" or "Not configured".
- Mobile: `tsc` clean; jest 151 of 151 and 1 of 1 snapshot; `expo export` for web and for
  Android both succeed.

## Not fixed (and why)

- **Much of the app is still English-only.** About 337 strings were translated before this
  pass. Irrigation, the zone's live readings, Alerts and History labels, and every new string
  are now in en, af and tn. Still hard-coded English, so not translated: zone detail's
  other sections ("Schedule & Weather", "System Status", their row labels), the sign-in and
  password screens, Reports, Tank, Forecast and Profile. Translating them is its own job.
- **The zone's flow rate is not shown.** The zone record does not carry it, so its tile was
  removed rather than kept as "Unavailable". Bringing the flow rate into the zone model would
  be a data change.
- **"Watering now" counts runs sent to a kit**, because the kit does not report its valve.
  That is as close to real as the data allows.
- **Native status bar and safe areas could not be checked on a real Android phone or
  iPhone** here: the screenshots are the web build. The code uses the safe-area insets and
  expo-status-bar, but a quick look on a device is still worth doing.
- **Drip's greeting bubble** floats over the content on narrow screens by design, and was not
  moved.
