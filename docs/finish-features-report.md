# Finish-features report

Branch `feature/finish-features`, eleven commits off `dev`. 70 files, +7028 / −106.

**No migration has been applied.** Four are written and committed; apply order is in §2.

---

## 1. What changed

### Step 1 — Firmware v1.4.0, broker address from the server

The sketch was replaced byte-for-byte (`diff`-verified after copying) and
`Firmware:LatestVersion` bumped to 1.4.0.

`GET /api/devices/mqtt-credentials` now also returns `mqttHost` and `mqttPort`, read from
the **existing** `Mqtt:Host` / `Mqtt:Port` keys that `MqttConnectionService` already
connects with — deliberately not a new pair, because two sources for the broker address is
how the API and the boards end up pointing at different brokers.

Both are optional in both directions: unset on the server means omitted, absent from the
response means the board keeps its compiled-in `MQTT_HOST`/`MQTT_PORT`.

**This is the thing that makes the HiveMQ migration a config change.** HiveMQ Cloud
Serverless is **retired on 31 December 2026**. Until v1.4.0 the broker hostname was
compiled into the firmware, so moving brokers meant reflashing every board in the field by
hand over USB — a site visit per kit. Now: point `Mqtt__Host` / `Mqtt__Port` /
`Mqtt__Username` / `Mqtt__Password` at the new broker, re-paste the per-kit logins into the
admin MQTT logins page, restart the boards. No reflash, no site visit.

`MqttBrokerAddress` encodes the one rule that is not obvious: a board given **no** address
falls back to its compiled-in host and keeps working, but a board given a **bad** one
(empty host, port 0) tries, fails and retries forever. So an unusable value comes back as
"not configured" — a typo in `Mqtt__Host` on migration day leaves the fleet on the old
address rather than stranding it between two.

### Step 2 — 7-day forecast

`GET /api/farmer/forecast` returns at most 7 forecast days, and — when a zone is named — one
plain sentence per day.

- Ownership is resolved **from the zone** when one is given, so a farmer cannot pair their
  own `farmId` with someone else's `zoneId` and read that zone's advice.
- Both `is_forecast = true` **and** `date >= today` are applied. A row can still be flagged
  forecast for a day that has just passed, and a "forecast" for yesterday is not one.
- Advice comes from `IrrigationAdvisor` — the same engine the schedule report drives — not a
  second set of rules. Day 0 gets the zone's real soil reading (only if fresher than 24 h)
  and the full water balance; later days get neither, and fall back to the rainfall-only
  outlook the schedule report already uses past day 0.
- **A day the engine cannot speak to gets no sentence at all.** Advice the app invented is
  worse than no advice, because the farmer cannot tell the two apart.
- No forecast rows returns an explicit message, not an empty list.

Mobile `/forecast`, linked from Home ("The week ahead") and from each zone with that zone's
id. One row per day rather than a 7-wide grid — a grid needs horizontal scrolling on a small
phone, which hides the furthest-out days, which are the ones worth planning around.

### Step 2b — Alert and advice history

The mobile app has always had a "read" flag and always cleared it on tap — but it lived
**only in that phone's AsyncStorage**. Reinstalling marked everything unread again, and
nobody on the AgroFlow side could tell whether a farmer had ever seen the frost warning that
mattered. For a deployment whose alert channel rests on somebody acting on it, that was the
missing piece. `alert.read_at` (0033) fixes it.

`read_at` is deliberately **not** `alert.status`. Resolved means the problem went away — the
monitor services write it on their own, without anyone opening the app. `read_at` means a
human looked.

History gains an "Alerts & advice" section beside the watering log, with filters for zone,
type and period. `alert` and `ai_recommendation` rows are merged into one list, because a
farmer has no mental category for "alert" versus "insight", only "things AgroFlow told me".
Status is **New / Seen {time} / Dismissed {time}**; advice has only two states, because an
insight is dismissed or expires with the day, so claiming "Seen" for an undismissed one
would be inventing a fact.

The admin farm drawer shows the same list, **read-only** — an admin marking a farmer's alert
as read would destroy the only evidence of whether the farmer saw it.

### Step 3 — Farmers can request reports

`report_request` (0034) is a queue. Olwethu's endpoints already return a PDF synchronously,
which works for an admin at a desk; it does not work for a farmer, because the FAO-56 render
over a date range is long enough to time out a phone on rural data, the farmer wants the
report to **arrive** on Telegram rather than to stand holding a phone, and the automatic
reports have no HTTP request to run inside at all.

**Reuse, not duplication:** the generator calls Olwethu's three PDF builders directly —
bodies untouched, only `private` → `internal` — so the PDF a farmer downloads and the PDF
the scheduler sends can never drift apart. It hands each one a `ClaimsPrincipal` built from
the **requesting farmer's own profile id**, so her farm-ownership check still runs for real:
a queued request cannot reach a farm its requester could not.

### Step 4 — Automatic reports

`report_schedule` (0035), **off by default**, with no row until an admin creates one.
Nothing starts sending weekly PDFs because a migration ran — a farmer who did not ask for a
document every Monday and gets one anyway learns to mute the bot, and the bot also carries
the frost warnings.

`AutoReportSchedulerService` generates nothing itself; it fills the same queue the app's
Request button fills. **Hourly, not a daily cron**: Railway restarts on every deploy, and a
deploy at 06:58 would silently skip that week with nobody noticing until a farmer asked
where their report was. Keying the duplicate check on the **period** rather than a timestamp
makes the run idempotent.

The farmer's off switch (`POST /api/farmer/auto-reports/stop`) accepts no farm id at all, so
it can only ever stop their own. There is deliberately no matching "on": an admin sets up
what a farmer receives, and a farmer can always stop it.

### Step 5 — Loading animation, landing page

See §4 for the two measured facts about the video that differ from the brief's assumptions.

Admin: inline in `index.html` so it is on screen **before** the ~400 KB bundle loads, which
is the gap it exists to cover. Mobile: `expo-video`, handing over from the native splash.

The landing page (5c) replaces an admin-only welcome card that said "Welcome to AgroFlow
Admin". A `welcome` state already existed and already was the default for a visitor with no
session — sign-out already returned to it — so the lecturer's problem was not routing, it
was that the page told a non-administrator nothing. It now carries the hero, three steps,
features, "Get the app", credits and one Admin login button.

Login moves to `#/login`, backed by the URL hash: it can be linked and bookmarked, the back
button works, and reloading the bare root lands on the landing page again. Deliberately not
`localStorage` — persisting "I once pressed Log in" would reintroduce exactly the behaviour
being fixed.

### Step 6 — Archive, 6b Supabase lock, 6b-2 Telegram wording

Archiving (0036) hides a farm and its zones from lists, the forecast, report requests and
auto reports, and **deletes nothing**. Deleting would cascade to every zone, sensor reading,
irrigation event and alert — the history that is the evidence the system worked.

`archive_farm()` moves the farm **and** its zones together: a farm archived while its zones
stayed active would still feed the auto-report scheduler's zone lookup.

**Nothing was archived.** Which farms are test data is a judgement about real customers; the
SQL is in §5.

`lock: processLock` removed from the mobile Supabase client (deprecated in supabase-js 2.116,
gone in v3; the client coordinates refreshes itself now). Every other auth option is
untouched. **The admin client never passed `lock`**, so there was nothing to change there.

The Telegram "not linked" reply now points at Settings → Connect Telegram first. Changed in
**all three** places that said it — `/start`, `/status`, `/alerts` — not just the one the
brief quoted; a bot that gives two different answers to "how do I link this?" is worse than
one that repeats itself.

### Step 6c — Engine and soil

Everything the brief asked to confirm already existed and was correct. See §7.

New: **"Run advice now"** on each zone in the admin farm drawer. It calls the same
`RunZoneAndWriteInsights` the nightly pass calls, so what an admin sees is what the farmer
will get. Advisory only — it writes the normal rows and never touches a pump.

The half that makes it useful on a setup visit is `setup_missing`: it **names** the missing
field (no planting date, no flow rate, no area) instead of leaving a blank panel, so an
installer can fix it before leaving the farm rather than finding out a week later.

### Step 6d — Builds

See §8 (APK) and §9 (web app / iPhone).

---

## 2. Migrations — **not applied**, in this order

| # | File | What it does |
|---|---|---|
| 1 | `0033_alert_read_at.sql` | `alert.read_at`; narrows 0011's table-wide UPDATE grant to `(status, read_at)` |
| 2 | `0034_report_request.sql` | the report queue, with RLS |
| 3 | `0035_report_schedule.sql` | automatic reports per farm, off by default |
| 4 | `0036_archive_farm.sql` | `zone.status`, `archive_farm()` / `restore_farm()` |

All four are **safe to re-run** (`add column if not exists`, `create table if not exists`,
`drop policy if exists` before create) and contain **no `$$`** — the function bodies in 0036
use single-quoted strings instead, because these get pasted into the Supabase SQL editor and
dollar quoting is what most often breaks that paste.

### One thing to know before applying 0033

It **revokes a grant**. 0011 gave `authenticated` a whole-table `UPDATE` on `alert`, with
`alert_update_member` scoping which *rows*. A policy has never scoped which *columns*, so a
farmer could rewrite the message or severity of an alert on their own farm — the record of
what AgroFlow told them, which is exactly what an audit of "did they act on it" rests on.
0033 replaces it with `update (status, read_at)`.

Nothing used the other columns: the admin dashboard only `SELECT`s alerts, and the mobile app
reaches them through `/api/farmer/dashboard`. Same treatment 0027 chose for
`ai_recommendation.dismissed_at` and 0028 for `hardware`.

Both the mobile service and the admin query **fall back to the pre-0033 column list** when
`read_at` is absent, so neither breaks in the window before you apply it.

---

## 3. New config keys

Railway spelling: `:` becomes `__`.

### API (Railway)

The API gained **no new keys** in this change. `Mqtt:Host` and `Mqtt:Port` are now also
served to devices, but they already existed and are already set.

### Admin console (build-time, GitHub repository variables)

| Brief's name | Actual variable | Notes |
|---|---|---|
| `Downloads:AndroidApkUrl` | `VITE_DOWNLOADS_ANDROID_APK_URL` | direct link to the `.apk` |
| `Downloads:WebAppUrl` | `VITE_DOWNLOADS_WEB_APP_URL` | the mobile web app's URL |

**Why not Railway variables.** The brief asks for these with Railway spellings
(`Downloads__AndroidApkUrl`, `Downloads__WebAppUrl`). The landing page is a **static site on
GitHub Pages** and makes no API call before it renders — a Railway variable physically
cannot reach it. They are therefore Vite build-time variables, set as GitHub repository
variables and inlined by the Pages workflow.

If the API ever serves this page instead, `Downloads__AndroidApkUrl` /
`Downloads__WebAppUrl` are the names to use.

Both links are **hidden entirely when unset**, so the page is correct before the APK exists —
a Download button that 404s is worse than no button, especially on the page a lecturer is
looking at.

### Mobile (EAS secrets — set before the first build)

```bash
npx eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value <url>
npx eas secret:create --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <key>
```

`lib/supabase.ts` **throws at startup** without them, so an APK built without them installs
and then immediately fails. Worth preventing in writing rather than discovering on a phone.

### GitHub repository variables used by the Pages workflow

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AGROFLOW_API_BASE`,
`VITE_DOWNLOADS_ANDROID_APK_URL`, `VITE_DOWNLOADS_WEB_APP_URL`,
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`EXPO_PUBLIC_AGROFLOW_API_BASE`.

Variables, not secrets, on purpose: none of them is one. The anon/publishable key is public
by design — RLS is what protects the data — and variables can be read back and corrected
without being re-entered blind.

---

## 4. The video

| | |
|---|---|
| **Size** | 269,767 bytes (263.4 KB) |
| **Re-encoded?** | **No.** Copied byte-for-byte to both apps. |
| **Dimensions** | 1080 × 1920 (portrait), H.264 (`avc1`), no audio track |
| **Duration** | **9.00 seconds** |
| **Transparency** | **It had some, and MP4 lost it — see below** |

### It is white, not green

MP4 cannot carry an alpha channel, so the transparency the animation was authored with was
flattened on export. Sampled at 0.5 s / 2 s / 4 s / 6 s / 8.5 s: **every corner and the
dominant colour are `#FFFFFF`** throughout.

So both overlays use `#FFFFFF`, not `#184D35`. Using green would put a white letterbox
around the video.

**Resolved (follow-up):** the mobile native splash background in `app.json` is now `#FFFFFF`
too, so the OS splash → overlay handover has no colour change. `splash-icon.png` is a
mid-blue water droplet and reads fine on white; see §14 for the one caveat and for something
else that turned up while checking it.

### The video is 9 s — the cap is 10 s

The brief's hard ceiling was 8 seconds and the supplied video is 9.00 seconds, so the cap
fired first and cut the last second of the animation.

**Raised to 10 s (follow-up)**, in both places:

- `apps/web/admin/index.html` → `MAX_MS`
- `apps/mobile/src/components/LoadingAnimation.tsx` → `MAX_VISIBLE_MS`

Ten rather than nine leaves a second of headroom past the end of the video, which is what
keeps this a **safety** limit rather than the thing that normally ends the splash: in the
ordinary case the video's own `ended` / `playToEnd` has already fired and this timer never
runs. It only matters when something has gone wrong.

The two constants must stay in step; each one's comment says so and names the other.

### Poster

Generated with ffmpeg from **4 s, not frame 0** — frame 0 is blank white (the logo fades in),
and a blank poster defeats the purpose of a fallback. `ffmpeg` is not on `PATH`; the copy
bundled with CapCut was used.

---

## 5. The SQL for step 6 — **run these, then choose**

Single statements, read-only. Nothing was archived.

**Current farms, with their zone and reading counts:**

```sql
select f.farm_id, f.name, f.status, f.location, coalesce(p.name, '(no owner)') as owner,
       count(distinct z.id) as zones, count(r.id) as readings, max(r.recorded_at) as last_reading
  from farm f
  left join profile p on p.id = f.owner_id
  left join zone z on z.farm_id = f.farm_id
  left join sensor_reading r on r.zone_id = z.id
 group by f.farm_id, f.name, f.status, f.location, p.name
 order by last_reading desc nulls last, f.farm_id;
```

**Current zones:**

```sql
select z.id, z.name, z.status, f.farm_id, f.name as farm, z.crop_type, z.planting_date,
       count(r.id) as readings, max(r.recorded_at) as last_reading
  from zone z
  join farm f on f.farm_id = z.farm_id
  left join sensor_reading r on r.zone_id = z.id
 group by z.id, z.name, z.status, f.farm_id, f.name, z.crop_type, z.planting_date
 order by f.farm_id, z.id;
```

`last_reading` is the column to sort on: a farm that has never had a reading, or whose last
one is months old, is almost certainly test data.

**To archive one** (after 0036 is applied), use the admin **Archive** button, or:

```sql
select archive_farm(123);
```

### The status casing mismatch — reported, not rewritten

`farm.status` defaults to `'Active'` with a capital A and has **no CHECK constraint**, so
nothing has ever stopped a lowercase `'active'` being written. Both spellings may exist.

**Deliberately not normalised.** A blanket `update farm set status = initcap(status)` would
touch every row in a live table to fix something that costs nothing once the readers are
case-insensitive, and would silently rewrite any status value nobody anticipated.

Instead every new filter compares with `lower()` — in the SQL (`lower(coalesce(f.status,
'active')) <> 'inactive'`) and in the admin's TypeScript (`isArchived()`). Both spellings keep
working, permanently, with no data migration. `zone.status` mirrors `farm.status` exactly
rather than inventing a second vocabulary.

---

## 6. Is a new APK needed?

**Yes — and this one is unavoidable.**

`expo-video` is a **native module**. It cannot be delivered by an OTA JavaScript update, and
**Expo Go can no longer load this app at all** — day-to-day development now needs a
development build (`npx eas build -p android --profile development`).

Everything else added here is JavaScript and would have shipped over the air. The loading
animation is what forces the rebuild.

Version installed: `expo-video@~57.0.4`, the version pinned by this SDK's
`bundledNativeModules.json`. `npx expo install` could not run — the stored Expo token is
stale (`ApiV2Error: The bearer token is invalid`) — so the version was read from the SDK
rather than guessed. `expo-doctor` passes 21/21.

---

## 7. Is the engine working? — the checklist

### The soil values are confirmed correct

| Soil | FAO-56 class | θFC | θWP | p factor |
|---|---|---|---|---|
| Sandy | **Sand** | 0.12 | 0.045 | ×1.05 |
| Loam | Loam | 0.25 | 0.12 | ×1.00 |
| Clay | Clay | 0.36 | 0.22 | ×0.95 |

All exactly as specified (Table 19 midpoints, each cited in the code). The soil type screen,
the three soil icons, `PUT /api/farmer/zones/{id}/soil` and recalculation on save all exist
and work. **Nothing was broken, so nothing was fixed.**

What *was* missing is a guard. Those six numbers decide how much water every zone is told it
needs, and a wrong one is not a visible bug — the engine keeps running and keeps producing
confident advice, it just quietly waters the wrong amount for a whole season on every farm
with that soil. `SoilClassVerificationTests` now pins them, plus the two relationships that
must hold: available water rises sand → loam → clay, and p rises for sand and falls for clay.

### What a zone needs before the engine can advise fully

| # | Thing | Where | Without it |
|---|---|---|---|
| 1 | Farm **latitude** (and longitude) | farm | no ET0 at all — nothing works |
| 2 | **Crop type** | zone | no Kc, no stage, no season |
| 3 | **Planting date** | zone | no growth stage, no day-of-season, no growth bar |
| 4 | **Soil type** | zone | silently defaults to loam |
| 5 | **Area** (m²) | zone | no litres figure, only mm |
| 6 | **Flow rate** (L/min) | zone | no run-time suggestion; "Estimated volume" stays blank |
| 7 | **Root depth limit** (optional) | zone | the crop's full depth is assumed |
| 8 | **Wet/dry calibration** | zone | readings stay raw; no moisture % |
| 9 | **Weather rows** | `weather_daily` | no ET0 today, no forecast, no days-to-next-watering |

### How to check it, live

Admin → **Farms** → open the farm → **Zones** → **Run advice now**.

**You should see:** a stage (Establishing / Growing / Peak growth / Nearing harvest), a day of
season, ETc in mm, a depletion figure, a suggested volume in litres and a run time in
minutes, days until the next watering, and one or more insights written for the farmer.

**If something is missing**, the panel lists it by name under *"Still needed before the engine
can advise fully"* — that is the list to work through, and it is why this action exists: it
turns "the engine isn't working" into "this zone has no planting date".

**Weather is the one you cannot fix on the spot.** `WeatherCollectionService` fills
`weather_daily` every 6 hours for every farm **that has coordinates**. A brand-new farm has no
rows until the next collection, so run this the day after setting a farm up, not five minutes
after.

---

## 8. The APK build

```bash
npx eas build -p android --profile preview
```

**Not run** — it needs your Expo login. `eas.json` is created (there was none).

`preview` builds an installable **APK**; `production` keeps the `.aab`. EAS defaults Android
to an `.aab`, which is what Google Play requires and what **nothing else can install** — a
farmer cannot sideload one and neither can a lecturer marking this.

Set the two EAS secrets in §3 first.

---

## 9. The web app (iPhone), and which screens work

### Status

`npx expo export --platform web` **succeeds**. All 23 routes export, including the new
`/forecast` and `/reports`. Verified present in `dist-web`: `manifest.json`, all four icons,
the `apple-*` meta tags, and the loading video and poster.

### URL — not live yet, and what is blocking it

**There was no GitHub Pages deploy in this repo at all**: no workflow, no Vite `base`,
nothing. The brief asked to add the web app "following the admin's existing deploy setup" —
there wasn't one, so `.github/workflows/pages.yml` creates both.

Once it runs, the URLs will be:

- Admin + landing page: `https://leruo24.github.io/AgroFlow/`
- Mobile web app: `https://leruo24.github.io/AgroFlow/app/`

**Three things must happen before those work**, none of which can be done from here:

1. **Enable Pages** — repo Settings → Pages → Source: **GitHub Actions**.
2. **Set the eight repository variables** in §3 (Settings → Secrets and variables → Actions →
   Variables).
3. **Run the workflow** — it fires on push to `main`, or manually via *Run workflow* on the
   branch. This branch merges to `dev`, not `main`, so it will need the manual run (or a
   `dev` → `main` merge) to publish.

`base` is `"./"` rather than a hardcoded `/AgroFlow/`, so the same build works from Pages,
`vite preview` and Railway. `404.html` mirrors `index.html` so deep links survive a hard
refresh.

### Which screens work on web

The app was already in better shape for web than expected — the map, the confirm dialogs and
the Supabase client each already had a web path.

| Screen | Web | Notes |
|---|---|---|
| Login, Forgot password, Update password | ✅ | |
| Home | ✅ | map uses the web tile variant |
| Irrigation, Zone detail | ✅ | |
| **Forecast** | ✅ | new |
| Alerts, History (incl. Alerts & advice) | ✅ | |
| **Reports** | ✅ | the PDF opens in a new tab rather than the system browser |
| **Kit (zone-hardware)** | ⚠️ **works, with a note** | see below |
| Soil type, Settings, Profile, Farm requests | ✅ | |
| Push notifications | ❌ | `expo-notifications` is native-only — and is not wired to any screen, so nothing is lost |

**The Kit screen** is the one real gap. Everything on it works on web — status, sensors, even
sending the change-WiFi command — but step 1 of the handover is *joining the kit's own WiFi
network*, which a desktop browser realistically cannot do. It does not crash, so it gets a
**note shown only on web** rather than a disabled button: telling someone up front is kinder
than letting them send the command and then find they cannot finish it.

### Installing it on an iPhone

Open the web app URL in **Safari** → **Share** → **Add to Home Screen**. The
`apple-mobile-web-app-capable` meta tag is what makes it open full screen with the AgroFlow
icon instead of in Safari with its address bar.

An APK cannot install on iOS and a real iOS build needs a paid Apple Developer account, so
this is the iPhone answer.

---

## 10. Checks

| Check | Result |
|---|---|
| `dotnet build` — Domain, Api, Tests | **clean**, 0 warnings, 0 errors |
| `dotnet test` | **607 passed**, 0 failed, 0 skipped (528 before this branch) |
| mobile `npx tsc --noEmit` | **clean** |
| mobile `npx expo-doctor` | **21/21** |
| mobile `npx expo export --platform web` | **succeeds**, 23 routes |
| admin `npx tsc --noEmit` | **clean** |
| admin `npm run build` | **clean** |
| conflict markers | **none** |

### Step 7, item by item — what is actually executed

The test project is a **unit** project with no database, and the live database is read-only
on this branch, so the relational and RLS items cannot be *executed* here. Honest accounting:

| Asked for | Status |
|---|---|
| Forecast returns at most 7 days | ✅ `ForecastOutlookTests` pins the window and that it is below the engine's 8 |
| Schedule fires once per period; disabled never fire | ✅ `ReportSchedulePolicyTests` — incl. the SAST-date comparison that stops a 23:30 UTC run resending |
| mqtt-credentials includes host/port when configured | ✅ `MqttBrokerAddressTests` — incl. port 0, the value that would otherwise reach a device |
| A failed generation is marked Failed | ✅ (logic) the plain farmer-facing message is pinned; the write itself is one `UPDATE` |
| "Run advice now" returns stage and setup_missing | ✅ (inputs) soil values and stage mapping pinned; the endpoint itself needs a seeded zone |
| Forecast only for the farmer's own farm | ❌ **not executed** — RLS + the ownership SQL. Verify: ask for another farmer's `zoneId`, expect 404 |
| A report request creates a row; another farmer can't read it | ❌ **not executed** — `report_request_select_own` (0034) |
| A farmer can switch off only their own schedule | ❌ **not executed** — the farm-access clause in the `UPDATE`; no farm id is accepted at all |
| Archive hides a farm from auto reports | ❌ **not executed** — the `lower(...) <> 'inactive'` join in the scheduler |
| Alert history shows the correct status | ❌ **not executed** — the derivation is TypeScript; see below |
| Mobile `LoadingAnimation` hides after 8 s | ❌ **not executed** — see below |

**Why the two TypeScript ones are not tested: the mobile app has no test runner.** No jest, no
vitest, no test script, no test files. The brief's own condition — *"unit test with mocked
timers if the test setup allows"* — does not hold. Adding `jest-expo` on deploy night was not
a risk worth taking for one test.

To add it later: `npx expo install jest-expo jest @types/jest --dev`, then a `test` script and
`"preset": "jest-expo"`. `LoadingAnimation`'s timing is deliberately driven by two named
constants and two booleans, so it is straightforward to test once there is somewhere to put
the test.

The unexecuted database items are all single statements resting on constraints and policies
rather than branching logic. They are the right things to check by hand after applying the
migrations.

---

## 14. The splash icon — checked on white, and a licensing problem

### It is visible on white

`apps/mobile/assets/images/splash-icon.png` is a **mid-blue water droplet with a splash**.
It reads clearly on white, so the splash background change went ahead.

One caveat, measured: of the icon's visible pixels, **17.5% are brighter than luminance 235**
and 37.5% brighter than 200. That is the specular highlight on the droplet and the finest
outer spray. On white those edges soften and some of the outermost droplets effectively
disappear. The icon itself is unaffected — median luminance is 176 and about a quarter of it
is below 128 — and at the rendered size (`imageWidth: 76`) that fine spray was never
resolvable anyway.

### ⚠️ It is a watermarked stock image

While compositing it against both backgrounds to check contrast, a **tiled "pngtree"
watermark** became visible across the whole 2500 × 2500 canvas — the logo and the wordmark,
repeated diagonally.

It is white at roughly 15% alpha (`rgba(255,255,255,38)`), which is why nobody has noticed:
**invisible on white, visible on anything darker.** On the `#184D35` splash this change just
replaced, it was being drawn on every app launch.

Two things follow:

1. **The white splash hides it.** That is luck, not a fix — the watermark is still in the
   committed asset and will reappear on any dark background, including dark mode anywhere the
   image is reused.
2. **It is a licensing matter, not a rendering one.** A watermarked Pngtree asset is
   unlicensed by definition, and this is going into a deployed app and a marked submission.

**Not changed here** — replacing the app's splash artwork is a branding and licensing
decision, not a tidy-up to fold into a follow-up commit. The options are to buy the Pngtree
licence and drop in the clean file, to redraw the droplet (the Drip mascot SVGs in
`assets/mascot/` are already original work and already on-brand), or to use the AgroFlow logo
from the loading video, which is clean.

---

## 11. Anything skipped, and judgement calls

1. **Supabase Storage for report PDFs — not used.** The brief's first choice; this project has
   no storage integration at all, and Railway's filesystem is ephemeral, so a saved PDF would
   vanish on the next deploy. Implemented the brief's second option: `file_path` holds the API
   path that **regenerates** the report. The reports are pure functions of data the database
   already holds, so the parameters *are* the stored report. Upgrading later changes only what
   goes in that column. The one thing it does not give is a frozen snapshot — for a water-usage
   summary over a closed date range, very nearly never an issue.
2. **The mobile `LoadingAnimation` test** — no test runner (above).
3. **Nothing was archived** — §5. The brief explicitly asked not to.
4. **No migration was applied** — ground rule.
5. **The APK was not built** — needs your Expo login (§8).
6. **Olwethu's direct report endpoints still serve archived farms**, deliberately. Pulling the
   history of an archived farm for the record is something an admin should still be able to do;
   the *pipeline* (requests, auto reports) excludes them.
7. **The `farm.status` casing was not normalised** — §5.
8. **The mobile splash is still green while the overlay is white** — §4. A branding decision.
9. ~~The 8 s cap cuts ~1 s off a 9 s video~~ — **resolved in the follow-up**: raised to 10 s
   in both apps, and the mobile splash background set to `#FFFFFF` to match the video. See §4.
10. **`splash-icon.png` carries a Pngtree watermark** — found while checking it against white,
    and **not changed**: it is a licensing and branding decision. See §14.

---

## 12. Suggested order on the night

1. Set `Mqtt__PoolEncryptionKey` (from the previous pass) if it is still unset.
2. Apply migrations **0028–0032** (previous pass), then **0033 → 0036**, reading §2 first.
3. Deploy the API.
4. Run the two queries in §5, decide which farms are test data, archive them from the admin.
5. Set the EAS secrets (§3) and run the APK build (§8). It takes ~15 minutes.
6. Enable GitHub Pages, set the repository variables, run the workflow (§9).
7. Put the APK URL and the web app URL into `VITE_DOWNLOADS_*` and re-run the workflow, so the
   landing page's "Get the app" section appears.
8. Flash both boards with v1.4.0, re-enrol each with a fresh enrollment code.
9. Open a farm in the admin and press **Run advice now** on each zone (§7) — that is the live
   proof the engine works, and the fastest way to find a zone missing a planting date before
   the presentation rather than during it.

---

## 13. Commits

```
1e750c5  feat(firmware): v1.4.0, broker address served from config
651e759  feat(forecast): 7-day forecast screen with the engine's per-day advice
4583854  feat(alerts): alert and advice history for farmers and admins
2436788  feat(reports): farmers can request PDF reports, delivered in-app and on Telegram
295ba4f  feat(reports): automatic weekly/monthly reports per farm, with a farmer off switch
3814b70  feat(admin): loading animation, public landing page, GitHub Pages deploy
2a936a0  feat(mobile): loading animation over the native splash, with Drip waiting for it
f069193  feat: archive farms, drop the deprecated Supabase lock, reword the Telegram reply
b27afe1  feat(engine): "Run advice now" per zone, and pin the soil values
90f9fe5  feat(mobile): EAS APK profile, and the web build installable on an iPhone
ee98854  test: broker address rule, extracted so it can be tested
```
