# AgroFlow 2.0 — what's new

Written for: farmers using the app, and the project sponsor.

Version 2.0.0, October 2026.

---

## For farmers

### Your reports are proper documents now

Ask for a water usage report and you get a three-page document instead of a
page of numbers:

- **What your week looked like** — how much water went on, how many times the
  pump ran, and when the next watering is due.
- **What your crop needed against what it got**, as a chart, so a shortfall is
  something you can see rather than work out.
- **Your soil moisture across the week**, with the healthy range shaded and a
  mark wherever the pump ran.
- **Advice for the week ahead**, and where each piece of it came from.
- **The weather for your area against the sensor in your tub**, which is
  usually warmer and more humid — that is normal, and the report says so.

Pick a single zone and you get that zone in detail. Pick "All zones" and you
get the whole farm: a summary first, then every zone, then the weather.

### The report tells you when it cannot work something out

If a zone has no flow rate recorded, the report says "no estimate" rather than
showing you a zero. A zero would read as a pump that ran and delivered
nothing, which is a fault — and not what is happening. The same goes for a day
when the sensor was offline: the chart leaves a gap instead of drawing a line
through it.

### Reports stopped failing

Asking for a report used to fail outright for some farms. That is fixed. If a
report genuinely cannot be made, you now get a plain sentence saying so
instead of an error code.

### Clearer wording when picking a report

The zone picker now tells you what you will get: "All zones" is a short
summary, one zone is the full report.

---

## For the sponsor

### The admin console

- **Register a farm** and **register a kit** are now step-by-step, with the
  farm's position placed on a map instead of typed. A dropped minus sign used
  to put a Western Cape farm in Kazakhstan, and nothing downstream complained —
  the farmer simply received somebody else's weather.
- **Crops are chosen from a list the irrigation engine can actually use.** The
  old list offered Grapes, Wheat and Apples, none of which the engine
  recognises, so a zone created with one silently received no advice at all.
- **Every administrator action is recorded** — who did it and when — and shown
  on a timeline against the request or alert it belongs to.
- **Platform status** is live: six checks covering the API, the database, the
  message broker, Telegram, the weather feed and the kits.
- **Exports open properly in Excel.** They did not before: South African
  Windows splits a CSV on semicolons, so every value arrived in one column.
- Settings now shows only what is real. About twenty fields that looked
  editable but changed nothing have been removed, and the thresholds the
  system actually runs on are shown in their place.

### Honesty, deliberately

A number of screens previously showed figures that came from nowhere — a
backup date, a storage percentage, a "100% schedule compliance" that was a
hardcoded value. Those are gone. Where something is not measured, the console
now says it is not measured.

---

## What is not connected yet

Stated plainly so nothing here is a surprise in a demo.

- **Maintenance jobs** — scheduling and assigning a technician hold for the
  session only. There is no maintenance table behind them yet, and no staff
  roster.
- **Alert workflow** — assigning an alert, setting its priority and adding
  notes are session-only for the same reason. Raising and resolving alerts is
  real; the workflow around them is not stored yet.
- **Per-kit uptime** is not measured. Nothing records it, so the console says
  "not measured" rather than showing a percentage.
- **Hardware restart, remove and replace** act on the current session only.
- **Platform settings are read-only.** They are configured on the deployment,
  not from the console.
- **Irrigation schedules** in the admin are a working copy. Real schedules
  live on the zone itself and are set from the farmer's app.

---

## Upgrading

**Phones on version 1 will not receive updates published after this release.**

Updates are matched to the app version, so a phone running 1.0.0 only ever
receives 1.0.0 updates. Moving to 2.0.0 means installing the new APK — an
over-the-air update cannot carry a phone across a version change.

Nothing is lost by upgrading: accounts, farms, zones and history are all held
on the server, not on the phone.
