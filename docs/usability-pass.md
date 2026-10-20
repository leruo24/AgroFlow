# Farmer app usability pass (sponsor feedback, Part B item 9)

Five everyday tasks, counted on the farmer app (`apps/mobile`) from the Home screen with the
app already open and signed in, on a 390 × 844 phone. A **tap** is one press on a button, row,
field or tab. Typing in a field is listed separately. The counts are from walking through the
code paths and the web build (`expo export --platform web`) with mocked data, not from
watching farmers. That is the next step (see "Bigger ideas").

Only low-risk changes were made: wording, the order of a screen, larger targets, sensible
defaults and clearer empty, error and offline states. Nothing about how watering is decided
changed.

## Taps per task

| # | Task | Before | After | What changed |
|---|---|---|---|---|
| 1 | See today's action | 0 taps, but below the map and weather (about 1½ screens of scrolling) | **0 taps, no scrolling**: first section under the farm name | "Today" moved to the top of Home, above the map and the weather. |
| 2 | Water a zone (kit, manual run) | 5 taps: Manage Irrigation → zone → Manual → Start Manual Run → Start. The minutes box said **20**, but the kit stops every run at **5** | **5 taps**, no typing needed: Water a zone → zone → Manual → **Water now** → Start. The box now starts at **5**, which is what the kit actually runs | Plainer words ("Water a zone", "Water now", "Stop watering", "How many minutes?"), and the confirmation names the zone and says the pump stops by itself. Offline, the button is grey and says **"Needs a connection to reach your kit"** instead of failing after a wait. |
| 3 | Read an alert | 1 tap: View Alerts (or the Alerts tab) | **1 tap** | Unchanged count. The offline banner sits above the list, so an old list is never mistaken for a fresh one. |
| 4 | Log a tank refill | 3 taps after scrolling to the tank card: "Tank details and refill" (a text-only link) → litres box → Log refill. The time box showed a raw `2026-10-19T…Z` timestamp | **2 taps**, no scrolling: **Log a tank refill** (new Home quick action) → type the litres (the box is already active) → Log refill | New quick action; the litres box is focused when you arrive from it; "Log a refill" comes before "Tank size" (set once); the time box reads **Now** and only needs typing for an earlier refill; the tank link has a 48 pt target. Works offline: "Saved on this phone. It will be sent when you're back online." |
| 5 | Request a report | 2 taps: Reports → Request (water use, last 7 days, all zones are the defaults) | **2 taps** | Unchanged. The defaults already match the common request. |

Totals for the five tasks: **11 taps before → 10 after**, plus two fewer scrolls (tasks 1 and 4)
and one field no longer needing typing to be correct (task 2).

## Empty, error and offline states added or checked

- **Offline, with saved data:** every screen with a header shows "You're offline — showing data
  from today 08:15" and works read-only from what was last loaded.
- **Offline, nothing saved yet:** "You're offline, and this hasn't been loaded on this phone
  yet. It will show once you're back online." Never a spinner that does not end.
- **Waiting to send:** "1 entry saved on this phone, will be sent when you're back online",
  and if the server later refuses one (for example older than 7 days), the reason.
- **Irrigate offline:** greyed out with the reason under it; never queued.
- **Tank not set up:** the refill button is off and says to set the tank size first.

## Bigger ideas (suggestions only, not done)

1. **"Water now" on each Today card** for a zone with a kit: would make task 2 two taps (the
   button, then confirm) instead of five. It changes the Home screen's main card and needs a
   design check with farmers.
2. **Show "Water now" without choosing Manual first.** The Manual chip is only a preview (it
   does not change the zone's saved mode), but farmers may think it turns automation off. The
   API already accepts a one-off manual run in any mode.
3. **Match the minutes range to the kit.** The box accepts 1–60 minutes, but the kit's safety
   cap stops every run at 5. Either offer 1–5, or tell the farmer longer runs are cut to 5.
4. **A zone saved as "manual" shows as "Automatic"** in the zone screen: the app maps every mode
   other than `scheduled` to `automatic` (`AgroFlowContext.tsx`, `mapZoneRow`). This was already
   there; worth fixing on its own, since it misreports what the zone will do.
5. **A date and time picker** for an earlier refill instead of a typed time.
6. **Watch three farmers do these five tasks** (in their language) and count again; the numbers
   above are a walkthrough, not an observation.
7. **Translate the server's own sentences** (today's advice, alert wording) so a farmer who
   picks Afrikaans or Setswana does not get a mixed-language card.
