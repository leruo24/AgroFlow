# Bugfix and polish pass

Branch `fix/polish-before-deploy`, one commit per item of the brief, plus
`feat/designed-reports` for item 8b once its two templates arrived.

This is the report for item 12. It says what changed, what each change was
actually fixing, what I did not do and why, and what to click to check it.

---

## The short version

| Item | What it was | State |
|---|---|---|
| A | Admin was dense tables and free-text fields | Done — click-driven console |
| 1 | Mobile "Make me this report" returned a bare 500 | Done — diagnosed in the log, plain words in the app |
| 2 | Login page sat in a green band, not centred | Done |
| 3 | App icon inconsistent; watermark risk | Done — all 8 assets audited, **a new APK is needed** |
| 4 | "Monitoring not yet implemented" in three places | Done — `GET /api/admin/health`, six checks |
| 5 | No record of who did what | Done — `admin_audit_log`, timelines, Activity page |
| 6 | Free-text forms, a crop list the engine could not read | Done — two wizards, pickers, crop list fixed |
| 7 | "Export summary" was unreadable in Excel | Done — real `.xlsx`, a PDF, nine CSVs fixed |
| 8 | Irrigation data named no farm; litres from the wrong column | Done — plus alerts, farmers, dates |
| 8b | Reports as designed PDFs matching two templates | Done — both templates arrived; see below |
| B | Debug pass | Done — ten false-success toasts removed |
| 9–11 | Tests, checks, land | Done — 631 tests pass |

---

## Item 8b — the designed report

Both templates arrived after the first pass, so this is now done.

Picking a zone for a water usage report used to produce the same terse
farm-wide summary as picking "All zones". It now produces the document in
`agroflow-report-template.pdf`:

- **Page 1** — the week in four figures, "How your system works" in plain
  sentences, and water used per day.
- **Page 2** — what the crop needed against what it got, the soil moisture
  trace with its healthy band and a marker at every pump run, and the week's
  advice with the source of each line.
- **Page 3** — the area forecast against the sensor in the tub, the daily
  table with a week totals row, and a glossary of the three terms the report
  cannot avoid using.

Plus the workbook from `agroflow-data-template.xlsx` — Summary, Daily and
Weather comparison — at `GET /api/farmer/reports/water-usage/xlsx?zoneId=…`.

Both are rendered from one `WaterUsageReportModel`. That is the entire reason
it exists: the first thing that would go wrong is the spreadsheet disagreeing
with the document about a total.

**Nothing changed for "All zones".** The farm-wide report is untouched, so the
scheduler, the Telegram delivery and the admin console all go on working. The
zone now travels into the stored regeneration path too, so regenerating a
report returns the document the farmer actually received.

### Two things nearly shipped broken, both silently

**SVG text renders only in Lato.** QuestPDF has no chart element and the
packaged build does not expose SkiaSharp, so the charts are generated as SVG.
But QuestPDF resolves a `font-family` only against the fonts it has
registered, and it ships exactly one. Naming Helvetica, Arial or sans-serif
does not fall back — it drops the `<text>` element. The first render had
every bar in place and not one axis label, value or legend, and nothing threw.
Caught by rendering the PDF and looking at it.

**A decimal comma is invisible damage.** Inside an SVG path it truncates the
shape, and Skia draws the result as a blank box rather than failing. In the
workbook it makes Excel read the cell as text, so the column still looks right
and every total quietly stops counting it. Everything numeric now goes through
`InvariantCulture`, and two tests force `af-ZA` to prove it.

### The workbook is written by hand

No spreadsheet library exists in the backend, and the brief's one new
dependency went to `exceljs` in the admin. An `.xlsx` is a zip of XML, and the
subset needed for sheets of labelled numbers is small enough to write
honestly — inline strings rather than a shared string table, since the saving
is irrelevant at this size and the table is the fiddliest part of the format.
Sheet names are sanitised: Excel rejects `: \ / ? * [ ]` and anything over 31
characters by refusing to open the file at all, and a zone name is whatever
the farmer typed.

### What it will not print

A zone with no flow rate yields no water figure anywhere — **not a zero**. In
the PDF that is an em dash; in the workbook an empty cell, which is what
Excel's own `SUM` and `AVERAGE` ignore. Migration `0018` is explicit about
this, and a zero reads as a pump that ran and delivered nothing. A day with no
reading leaves a gap in the line rather than a segment drawn across it,
because a straight line over a missing day is an invented measurement. A crop
with no planting date simply has no growth stage line.

---

## What each item was actually fixing

### Item 5 — who did what

`service_request.status` said "scheduled" and nothing said by whom or when.
A disputed visit came down to whoever remembered it differently.

- Migration `0037`: `admin_audit_log`, append-only **by grant** — `select` to
  authenticated, `insert`/`update`/`delete` revoked — and admin-only by
  policy. `service_request` gains `assigned_to`, `scheduled_by`/`at`,
  `completed_by`/`at`.
- The actor comes from the JWT's `sub` claim **only**, never a parameter, so
  nobody can write somebody else's name into a permanent record.
- An audit write never fails the action it describes. If `0037` has not been
  applied, revoking a stolen kit still works; the dropped row is logged at
  Error. That is a deliberate trade — completeness of the log for
  availability of the action — because the one incident the log exists to
  record is the worst possible moment for an admin to be unable to act.
- Ten write endpoints record. `GET /api/admin/activity` (filtered, capped at
  500) and `/api/admin/activity/{type}/{id}` for one thing's history.
  Summaries are built server-side so the page and the exports cannot word the
  same action three different ways.
- Requests gained a who/when timeline, a picker-driven Assign and a detail
  panel. Alerts gained the same timeline.

### Item 6 — wizards, and a crop list that was quietly broken

**The crop list offered Grapes, Wheat and Apples.** None of the three resolve
in `Fao56EngineReference`. A zone created with one got no crop coefficient, no
season lengths and therefore **no irrigation advice at all** — and nothing
anywhere said so. The farmer simply never received a recommendation for that
zone, and there was no error to go looking for. This is the most consequential
bug in the pass, and the least visible.

It is now the engine-resolvable set, the first six of which are exactly what
the farmer can request in the app, so a request and the zone an admin builds
from it speak one language. `OfferedCropsResolveTests` fails the build if that
ever drifts again.

**Register a new farm** is four steps: farmer (picker), details with the farm
placed on a map, zones, review. The map matters — `farm.latitude/longitude` is
what the weather lookup and the FAO-56 engine read, and typed by hand a
dropped minus sign puts a Western Cape farm in Kazakhstan without anything
downstream complaining. The farmer just gets somebody else's weather. A farm
saved without a pin stores `NULL`, not `0`, because zero is a real place in
the Gulf of Guinea.

**Register a kit** replaces a button that wrote nothing — it toasted
"registered (demo)" and no kit ever existed. Five steps, each picker narrowing
the next. Farms are filtered by **owner id, not owner name**, because two
farmers can share a name.

The kit step offers one type, deliberately. Enrolling writes a `hardware` row
that a board claims with the code, and only the ESP32 node's firmware does
that. A "Weather Station" option would create rows nothing can ever claim —
showing as enrolled forever, looking like a failed installation. When a second
board ships it goes in `KIT_TYPES` and the wizard picks it up unchanged.

Also: both "Farm ID" free-text fields became farm pickers (a bigint nobody
knows by heart; a digit out attaches a new account to a stranger's farm);
technician names are chosen, not typed, so one person stops appearing as three
entries in the Assigned-to filter; the zone repeater keeps what was typed when
the count changes; and two maintenance dates hardcoded during development —
now in the past, making every booking read as overdue — default to today in
SAST.

Leaflet loads from a CDN on first use rather than from `package.json`: the
brief allows one new npm dependency and `exceljs` has it. That also keeps it
out of the bundle on every page with no map, and the two coordinate fields
keep working if the CDN is unreachable.

### Item 7 — exports

`Object.entries(kpis)` into a two-column CSV. So the labels were property
names — `farmersNotReceivingAlerts` — and the file opened in Excel with both
columns crammed into column A, because **Excel takes its list separator from
the machine's locale and South Africa's is a semicolon**, not a comma.

Now a real workbook (Summary / Farms / Open alerts / Requests), with sentences
for labels and numbers stored as numbers, so figures can be charted or
averaged rather than re-typed.

`Export PDF` is new and built by the API, not the browser: a PDF gets printed,
filed and emailed, so it carries its own figures, its own SAST timestamp and
the name of whoever produced it. Admin-only — a farmer holds a valid token
too, and it lists every farm with its owner's name.

Every other CSV goes out with a `sep=,` first line and a UTF-8 BOM. The first
stops Excel guessing; the second stops a farm name with a non-ASCII character
arriving mangled. Both are ignored by every other tool that reads CSV.

### Item 8 — four pages reporting things the database does not say

**Irrigation Data named no farm.** Every row read "Unassigned", which looks
like a farm name and is not one. The farm was resolved by looking an event's
zone up in one map and that zone's farm in another, each built by its own
unfiltered select — and supabase-js caps a select at 1000 rows by default, so
past that the chain broke and every row fell through to the fallback. One
embedded query now; the label for a genuinely unattached row says so.

**Litres came from `estimated_litres`**, which is whatever was written when the
row was made and has drifted against `zone.flow_rate_lpm`. The canonical
formula, documented in migration `0018`, is
`runtime_seconds / 60 * flow_rate_lpm`. Computed in one place, used in the
table, charts, KPIs, both CSV exports and the period comparison.

A zone with **no** flow rate yields `null`, not `0`. `0018` is explicit that
such a zone must read "no estimate available", and a zero renders as a pump
that ran and delivered nothing. Null rows are excluded from every total, and
the page says how many and why — silently counting them as zero drags a
month's figure down and draws a dip in the chart that never happened.

**The "Schedule Compliance" tile always read 100%** — a percentage computed
from a field hardcoded `true`. Nothing in the schema records schedule
adherence. Replaced with how much of the range can be estimated at all, which
is a real measurement.

**Alerts** had the same broken farm lookup, a Farmer column hardcoded `null`
(a page of dashes) and a Raised column rendering the raw timestamp
(`2026-10-03T14:05:12.345Z`).

**Farmers listed people twice.** `/api/users` left-joined `farm_member`, so a
farmer on three farms came back three times, with the same email and three
different farm names — and the count at the top of the page was wrong by the
same margin.

That query also filtered to `role = 'farm_user'`, which meant it could **never
return an administrator** — so the Assign pickers added in item 5 would have
had nothing to offer. Found by reading the query while fixing the duplicate,
not by testing. `role` now travels on the row; `getFarmerAccounts` and
`getAdministrators` read the halves.

And `fmtDate` no longer slices a UTC timestamp. Anything between midnight and
02:00 SAST was dated to the previous day, differently depending on which
column a page read.

`docs/irrigation-data-checks.sql` holds read-only queries that tell "the page
is wrong" apart from "the data is wrong", including the work list of zones
that still need a flow rate. **Run them one at a time** — the Supabase editor
returns only the last statement's result.

### Item B — ten toasts that lied

A toast reporting success is the only feedback an admin gets, so each
"(demo)" toast was a lie the console told about itself — and worse than a gap,
because somebody acting on it would have gone looking for a note, a report or
a backup that was never written. Each is now real or gone. Details in commit
`7619961`.

**The Backup tab was stating invented facts**: "Last cloud backup 2026-07-22
04:20", "Storage used 82% of 500 GB", and a meter drawn from that 82. None of
it came from anywhere. Somebody could have read that and concluded the data
was safe. It now says what is true — the data is Supabase Postgres, Supabase
backs it up, it is configured in the Supabase dashboard — plus the two things
AgroFlow genuinely never deletes (`0036`, `0037`).

---

## Migration 0037 — not applied

Per the ground rules I wrote it and did not run it. `supabase/migrations/0037_admin_audit_log.sql`
is idempotent, uses no `$$`, and is safe to re-run.

**Until it is applied:** the Activity page shows its error state with a Retry,
request timelines show "not recorded" where the who/when columns would be, and
every admin write still works — the audit row is dropped and logged at Error.
Nothing breaks; the record is just not being kept yet.

---

## Smoke test — about 25 minutes

Extended for the final pass: platform status, the rebuilt Settings page,
all-zones reports and the archive flow.

Admin first. Sign in as an administrator.

**Navigation and Home (3 min)**
1. All ten sidebar items load. None shows a skeleton that never resolves.
2. Home's action cards are clickable and land on the right page.
3. Home's KPI tiles are clickable.
4. The sidebar foot shows a platform status that is not green before it has
   data. Click it — the health panel opens.
5. Visit `#irrigation` directly. It redirects to Reports rather than 404ing.

**Requests (4 min)**
6. Click a farmer's name. The detail panel opens with what was asked for,
   where it has got to, and recorded changes.
7. Press Assign. It is a searchable list of administrators, not a text box.
   If it is empty, `/api/users` is not returning admins — see item 8.
8. Change a request's status. The timeline gains a step with a name and a
   SAST time.

**Register a kit (4 min)**
9. Kits → "+ Register a kit". Press Next with nothing chosen: it refuses and
   says which thing is missing.
10. Choose a farmer. The farm step lists only their farms.
11. Choose a farm with no zones. It says to add one first rather than showing
    an empty picker.
12. Finish. The code appears in a modal, not a toast — it is a credential
    somebody has to write down.

**Register a farm (4 min)**
13. Farms → add. Click a spot on the map; the latitude and longitude fill in.
    Drag the pin; they update.
14. Set zones to 3, fill them, change the count to 4. The first three keep
    what you typed.
15. The crop field is a dropdown. **Grapes is not in it** — that is the fix.
16. On Review, go back and clear the farm name, then press Register. It
    jumps you to the step that is wrong, not an error on the review screen.

**Exports (3 min)**
17. Home → Export to Excel. Open it: four sheets, labels that are sentences,
    numbers right-aligned as numbers.
18. Home → Export PDF. Figures, a farms table, open requests, a SAST
    timestamp and your name.
19. Any page's Export CSV. Open it in Excel: columns are separate, not all in
    column A.

**Platform status and settings (3 min) — added for the final pass**
20. Click the status in the sidebar foot. Eight checks, including
    **Deployment** (which commit and branch is running) and **Database
    schema** (every migration this build expects). Both should be green; a red
    schema check names the migration to apply.
21. Settings → **My account**. Change your name, Save, and watch the header
    greeting change. Then Telegram: Connect shows a code in a modal.
22. Settings → **Platform thresholds**. Real values, read-only, each saying
    which environment variable sets it. No Save button, because there is
    nothing here to save.
23. Settings → **Backup & Recovery**. No invented backup dates, no 82% meter,
    no buttons that do nothing.
24. A kit's detail drawer: uptime reads "Not measured", never "0.0%".
25. Irrigation Data: no row says "Unassigned". If any zone lacks a flow rate,
    a note says how many events are excluded and why. The **Watering
    schedules** panel explains where schedules live rather than showing an
    empty table of a dropped concept.

**Reports and archiving (4 min) — added for the final pass**
26. Reports → live reports → pick a farm and dates, leave the zone on **all**,
    press **PDF**. You get the farm-wide designed report: a summary page with
    a line per zone, then each zone, then the weather once.
27. Same again with **one zone** chosen. You get that zone's own report, and
    its figures match its row in the farm summary.
28. Press **Excel** instead. Open it: Summary, one Daily sheet per zone, and
    Weather. Change a flow rate on Summary and the Litres column recalculates —
    it is a formula, not a value.
29. If any zone has no flow rate, the farm report names it and leaves it out
    of the total rather than counting it as zero.
30. **Archive a test farm** (Farms & zones → a farm → Archive). It leaves
    every list, report and total. Press **Restore** and it comes back
    unchanged — nothing was deleted.
31. **Activity** shows the archive and the restore, with your name on each.

Then mobile, on a device or emulator:

32. Reports → "Make me this report". It either produces one or says
    "This report couldn't be made. Try again later." — never a bare 500.
33. Reports → Water usage → pick **one zone**, submit. Three pages with
    charts. Pick **All zones** and you get the farm-wide version — both are
    the designed template now.
34. The app icon is the AgroFlow icon, with no watermark, and the adaptive
    icon is not an icon-inside-an-icon.

---

## What still needs real work

Not regressions, and not in this brief — recorded so they are not mistaken
for finished.

1. **The Settings page is a mock.** Every field is a hardcoded default and
   there is no settings table anywhere in the schema. Save now says the
   values are kept for the session and the platform's defaults are set in
   code, which is true, but the page cannot configure anything. This is the
   largest remaining gap in the console.
2. **Maintenance has no writer.** The job list, technician assignment and
   scheduling are a session working copy. There is no staff roster table
   either, so `TECHNICIANS` is a static list.
3. **Alert assignment, priority and notes are session-only.** The `alert`
   table has no assignee, priority or notes column; its status CHECK allows
   only `Open` and `Resolved`, while the console's workflow has seven states.
4. **Per-kit uptime is not measured.** No telemetry table exists for it.
5. **Hardware restart/remove/replace** are session-only — `0011` grants
   `select` on `hardware`, not `update`/`delete`.
6. **Irrigation schedules** are a pre-existing working copy:
   `irrigation_schedule` was dropped in `0010` and real schedules are columns
   on `zone` now, one per zone rather than a list. That redesign was
   deliberately scoped separately.
7. **`estimated_litres` is now dead** — nothing reads it. Worth dropping in a
   later migration, once you are satisfied nothing else does.

---

## Checks, all green

| Check | Result |
|---|---|
| `dotnet build` (API) | 0 warnings, 0 errors |
| `dotnet test` (Domain) | 631 passed, 0 failed (607 before this branch) |
| `tsc --noEmit` (admin) | clean |
| `npm run build` (admin) | clean |
| `tsc --noEmit` (mobile) | clean |
| `expo-doctor` | 21/21 |
| Contract audit | every `/api` path the apps call resolves to a mapped route |

The admin bundle warns that it is over 500 KB. It was before this pass too;
`exceljs` adds to it. Splitting it is a build-config change, not a bug fix, so
I left it alone.

---

## Ground rules

- `.github/workflows/` untouched. The Pages workflow stays at
  `docs/pages-workflow.yml`.
- No secret file read, printed or edited. Config names only.
- The live database was never written to. `0037` is written, not applied.
- One new npm dependency: `exceljs`, in the admin, for `.xlsx`. Leaflet comes
  from a CDN, not `package.json`.
- One commit per numbered item.
- No user-facing copy anywhere says "not yet implemented". The two remaining
  matches in the source are code comments explaining what the strings were
  replaced with.
