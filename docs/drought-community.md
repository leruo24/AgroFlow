# Drought mode, community alerts, staff locations and the full setup wizard

Branch `feat/drought-community`. Migrations 0053–0056. This document covers how each part
works, where every number comes from, and what staff and farmers see.

**Who sees what.** Farmers see their own farm in the app and, if they have linked Telegram,
get messages there. Staff get no Telegram messages. They see everything in the admin site:
Home's "Needs attention", the bell, and the **Drought & community** page.

---

## 1. Drought mode

### When it switches on by itself

All three of these must be true for the farm:

| Condition | Default | Setting |
|---|---|---|
| The tank estimate is below a share of its size. With no tank: every zone's soil reading is below that zone's watering threshold | 25% | `drought.tank_low_fraction` |
| Forecast rain over the next days adds up to less than | 5 mm over 7 days | `drought.rain_sum_mm`, `drought.forecast_days` |
| Forecast reference ET (crop water use) is above the farm's own usual | ratio 1.0 against the last 30 days | `drought.eto_ratio`, `drought.eto_lookback_days` |

"High for the area" is measured against the **farm's own** average reference ET over the last
30 days (Open-Meteo history). This avoids inventing a national figure.

A farmer or staff member can also switch drought mode **On** or **Off** by hand, or leave it
on **Automatic**. Each change is written to the audit log
(`farm.drought_mode_changed`). An hourly check (`DroughtMonitorService`) re-checks every farm.
Each time drought mode changes, it writes a `drought_event` row and sends the message.

### What the farmer sees (Home)

- **Water budget:** "You have about 1 000 L. At normal watering that lasts 5 days; in drought
  mode it lasts 8 days." Normal use is the farm's average over the last 14 days of watering.
- **Why it is on**, in plain words, for example: "Drought mode on: tank about 20% full (drought
  line 25%); 2 mm of rain forecast over 7 days (less than 5 mm counts as dry); crop water use
  6 mm a day forecast against 5 mm usual for this farm."
- **Each zone's priority for today:** water fully / water at 50% / skip today, with the reason
  and the litres.
- **Honesty line**, always shown: "Worked out from your farm's own tank estimate, soil readings
  and weather forecast. It is not a drought prediction or an official drought declaration."
- **Message** (in the app always; on Telegram for linked farmers who have not switched it
  off): "Drought mode on: water Zone 1 fully, Zone 2 at half, skip Zone 3 today."

### Zone priorities (a layer on top of the engine)

The FAO-56 engine and `PrimaryAction` are **unchanged**. Drought mode only scales the amount
the engine recommends, based on how badly the crop's yield suffers from a shortfall at its
current stage. That measure is the yield response factor, Ky.

| Ky at the zone's stage | Priority | Setting |
|---|---|---|
| ≥ 1.0 | Water fully | `drought.ky_full_at` |
| between | Water at a share (50%) | `drought.reduced_fraction` |
| < 0.25 | Skip today | `drought.ky_skip_below` |
| crop not planted / season over | Skip today | – |
| crop with no published Ky (leafy vegetables, citrus) | Water fully (not cut) | – |

**Source (cited in `DroughtManager.cs`):** Steduto, Hsiao, Fereres & Raes (2012), *Crop yield
response to water*, FAO Irrigation and Drainage Paper 66, chapter 2.
- Table 1 gives the seasonal Ky values, taken from FAO Paper 33 (Doorenbos & Kassam 1979).
- Table 2 gives the stage values, using FAO columns Tr-0111 / 1011 / 1101 / 1110 for the
  initial / development / mid / late stages:
  - beans 0.20 / 1.10 / 0.75 / 0.20
  - maize 0.40 / 1.50 / 0.50 / 0.20
  - potato 0.60 / – / 0.70 / 0.20
- A stage with no published value uses the crop's seasonal Ky.
- The same values appear in FAO Water Reports 22 (2002), Moutonnet, Table 1.

### Irrigation type (application efficiency)

The engine works out the **net** water need. The amount to apply is net ÷ field application
efficiency. Like the drought priorities, this is a separate layer, and the zone's "Why"
explains it.

| Type | Efficiency |
|---|---|
| Drip | 90% |
| Sprinkler, centre pivot, micro-sprinkler | 75% (sprinkler value) |
| Furrow / flood (surface) | 60% |
| By hand | none published; the net amount is shown |

**Source:** Brouwer, Prins & Heibloem (1989), FAO Training manual no. 4 *Irrigation
Scheduling*, Annex I Table 8. Centre pivots are sprinkler systems. Micro-sprinklers are not
in the table, so they take the sprinkler value, which gives the larger, cautious amount.

---

## 2. Community alerts

Farmers warn each other about **pests** (locusts, fall armyworm, aphids, unusual insects),
**crop disease** (suspected), **fire** (veld fire, smoke nearby), **water problems** (canal not
flowing, borehole dry, low water, burst pipe, water may be unsafe) and **bad weather** (hail,
flooding, frost, very strong wind, very heavy rain).

Each report has a severity (low / moderate / high) and an optional note of up to 280
characters. Photos are not allowed.

### Location and privacy

- A report's place is the **reporting farm's saved location**, which staff set. The farmer
  has no location picker, and the app never reads the phone's location.
- The point is rounded to 2 decimal places, about 1 km.
- The reporter is never shown to farmers. Messages give the distance only: "about 18 km from
  your farm". Every message ends with "This is a community report and has not been
  independently verified."

### Limits

- Each farmer can make **2 reports per rolling 36 hours** (`community.report_limit`,
  `community.report_window_hours`).
- The API enforces the limit (429). The app shows it before the farmer starts, for example
  "You can add another after Wednesday 21 October, 12:00."
- "I'm seeing this too" and fire updates do not count towards the limit. Each farmer can
  confirm a report once.

### Who is told

| Category | Radius (setting `community.radius_km.*`) | Expires (`community.expiry_hours.*`) |
|---|---|---|
| Pest | 50 km | 7 days |
| Disease | 25 km | 7 days |
| Fire | 50 km | when "out", or after 48 h |
| Water | 20 km | 3 days |
| Weather | 30 km | 24 h |

- Messages go to farms within the radius that have not opted out of community alerts. They
  appear in the app always, and on Telegram for linked farmers who have that switched on.
- Quiet hours (SAST) hold Telegram messages back, except a fire heading for the farm.
- **Grouping:** reports with the same category, within the radius and within 48 h, are
  treated as one ("3 nearby farms have reported similar activity").
- Before a farmer files a new report, the app offers "I'm seeing this too" on a matching
  report.

### Fire

- **Downwind first.** The API reads the current wind from Open-Meteo (speed and the direction
  it comes **from**; fire spreads towards from + 180°). Farms within 1.5 × the radius
  (`fire.downwind_factor`) and inside a ±45° cone (`fire.cone_degrees`) are told first, at
  higher priority.
- The wording always says it is an estimate from the wind, not a prediction.
- **Updates.** The reporter, or anyone who confirmed the report, can post: still burning /
  spreading towards [N … NW] / under control / out. Each update re-checks the wind. "Out"
  closes the report.
- **Escalation.** At 3 confirmations (`fire.escalate_confirmations`), the radius widens by
  1.5 × (`fire.escalate_factor`).
- Every fire message says "If you're in danger, leave and call [`fire.emergency_text`]". The
  default is "your local emergency number (112 from a mobile phone)", and staff can change it.

### Moderation (admin)

The **Drought & community** page shows:
- every report, in a list and on a map, with each alert radius drawn;
- the reporter's name and email (staff only);
- how many of that farmer's reports were hidden, flagged in red at 2 or more.

**Hide** asks for a reason, which is recorded in Activity (`community.report_hidden`). A
hidden report stops notifying and disappears from farmers' lists.

---

## 3. Farm locations (staff only)

The picker is in three places: the register-farm wizard, the onboarding page, and the farm's
**Location** drawer. The drawer opens pre-filled.

1. **Province:** a dropdown of the nine provinces.
2. **Nearest town:** the search runs as you type (after a 350 ms pause), limited to the chosen
   province. It uses Open-Meteo geocoding, South Africa only, and copes with misspellings:
   "Mafeking" finds Mahikeng. Results show as "Town, District/Municipality, Province".
3. **Pin:** drag it to the farm itself.
4. **Coordinates:** latitude and longitude, checked against South Africa's bounds (latitude
   -35 to -22, longitude 16 to 33). The box only catches typing mistakes such as a missing
   minus sign or swapped values, because a few nearby places outside SA also fall inside it.
5. **Use my current location:** reads the browser's GPS once, only when pressed.

The province and town are saved with `PUT /api/admin/farms/{id}/location`, which is audited
(`farm.location_changed`). Reverse look-ups go through the API, which follows the Nominatim
usage policy: one request a second, a User-Agent, and cached answers.

**Farmers never edit the location.** The app's setup wizard shows "Is this your farm?" on a
small read-only map with two buttons:
- **Looks right**;
- **Something's wrong — tell my field officer**, which creates a staff notice. The notice
  appears on Home's "Needs attention", in the bell, and on the Drought & community page, with
  a **Fix the location** button.

---

## 4. The farmer's setup wizard (17 steps)

The steps come in four sections, each with its own progress, and one question per screen.
Anything the installer entered is shown pre-filled with **Looks right**, and every step except
the language, a forced password change and the summary has **Do this later**.

| Section | Steps |
|---|---|
| You | 1 language · 2 password · 3 Telegram (optional) |
| Your farm | 4 is this your farm? (read-only) · 5 water source · 6 tank size + how full now + water pH (skipped with no tank) |
| Each zone | 7 crop + planting date · 8 irrigation type · 9 soil type · 10 zone size (m² or ha) · 11 flow stopwatch · 12 teach the soil · 13 longest watering (read-only: "Ask your field officer to change this") |
| Alerts & help | 14 which alerts also go to Telegram, quiet hours · 15 community alerts (on by default, the 2-in-36-hours rule) · 16 Drip and "?" help · 17 All set summary |

- Steps 7–12 show one zone per screen. Zone 2 onwards gets **Same as Zone 1**.
- Home shows "Setup X/17 done — Continue".
- **Tap count:** a pre-filled 2-zone farm going through every step with Redo setup takes
  **19 taps** (the target was under 30). The `setupWizard.test.tsx` "tap count" test measures
  it.

---

## 5. Demo data (0056)

- **Mahikeng (Simulated)** at -25.86522, 25.64421 (Open-Meteo's Mahikeng, North West):
  - a 5 000 L tank with a 1 000 L refill, so 20% full, below the 25% line;
  - three zones: maize at 55 days (drip), beans at 20 days (sprinkler), potato at 110 days
    (furrow);
  - `sim_scenario = 'drought'`. With `Simulation:Enabled` the API uses a dry, high-ET demo
    forecast for this farm, labelled as demo values.
- **Ottoshoop (Simulated)** at -25.74916, 25.96766, about 35 km from Mahikeng at a bearing of
  about 68°. It has a borehole and a tomato zone, and serves as the neighbour for community
  and fire alerts.

---

## 6. Settings (all in `app_setting`, edited on the Drought & community page)

Every key above, plus its description and where its number comes from. Each setting is
checked against bounds in the API (`AppSettingsStore.Validate`), and each change is audited
(`settings.changed`). The defaults are AgroFlow's own operating choices, not agronomic
figures, except where a source is given above.
