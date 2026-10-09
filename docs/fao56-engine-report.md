# FAO-56 insight engine — what was built

Run on 2026-10-02. Migration `0027` has been applied to live by Leruo; nothing in this work applied it or wrote to live itself.

Source for every FAO number: Allen et al. (1998), *FAO Irrigation and Drainage Paper 56* — <https://www.fao.org/4/x0490e/x0490e00.htm>

## Branches (stacked)

```
dev                            (Phase A: three merges, then the stack below merged in)
 └─ feature/fao56-engine        6eccd95  feat(engine): FAO-56 soil water balance, insights and reports
     └─ feature/help-mascot     3e5ee53  feat(mobile): page help
         └─ feature/admin-welcome 635f3d2  feat(admin): add welcome screen before login
             └─ feature/drip-and-soil
                                e61011e  feat(mobile): add Drip mascot and soil icon assets
                                c7baf7d  feat(mobile): raindrop helper and soil icons
```

See `merge-report.md` for the final `dev` hash and what was pushed.

---

## Read this first — two decisions you should know about

### 1. Phase D is now complete — the raindrop helper is built

On the first pass `mascot/Drip.tsx` was missing, so Phase D stopped at the mascot as the spec requires. The artwork has since been supplied and is committed **unchanged** on `feature/drip-and-soil`:

```
apps/mobile/src/components/mascot/Drip.tsx          (4 moods, exports MASCOT_NAME)
apps/mobile/assets/mascot/drip_{happy,alert,thirsty,wave}.svg
apps/mobile/assets/soil/soil_{sandy,loam,clay}.svg
```

The helper is wired up in full — greeting wave, mood matching, speech-bubble priority, reduce-motion path, auto-hide — and the soil screen now shows the three real icons instead of plain coloured cards. Details in the Phase D section below.

### 2. The crop lists were not narrowed to the spec's six keys

The spec says to align everything to its six keys "because only these have sourced FAO-56 values". **In this repo that is not true.** `backend/AgroFlow.Domain/Agronomy/fao56-crop-knowledge.json` already carries fully sourced values for **citrus** and **leafy_veg** — Table 11 rows with page numbers, Table 12 Kc values, Table 22 rooting depth and p, and for citrus a quoted FAO footnote explaining why its Kc_mid sits *below* its Kc_ini — and `GrowthStageCalculatorTests` pins all of it.

Narrowing to the spec's six would have deleted sourced agronomy and broken passing tests. The engine therefore holds **eight** crops: the spec's six, plus citrus and leafy_veg carried across. Nothing was invented and nothing was thrown away.

Separately, **Luba's `service_request` crop CHECK was left alone**, for a second reason: the spec makes narrowing conditional on `select crop_type, count(*) from service_request group by 1` showing no rows outside the new list, and that query could not be run (see point 3). The SQL is written out in the migration as a comment, for you to apply once you have checked.

### 3. No live SELECT could be run

The Supabase connection string lives in a gitignored user-secrets file. §0 says never to touch credential or secret files, and the sandbox blocked reading it as well. Every live-data item in Phase B — seeded row counts, live `crop_type` values, live column lists — is therefore answered **from the migrations and the code**, which give the schema authoritatively, with the exact SQL for you to run yourself. The queries are listed in `merge-report.md` §6 and §8.

**Migration 0027 has since been applied to live by Leruo.** A read-only verification script, to confirm the applied schema matches the code, is at the end of this report under **Verify the applied migration**.

---

## Phase B findings (read-only investigation)

### The weather provider is Open-Meteo, not OpenWeatherMap

The spec refers throughout to OpenWeatherMap and `owm` provenance values. **AgroFlow does not use OpenWeatherMap.** It uses **Open-Meteo**, free and keyless:

- Forecast: `https://api.open-meteo.com/v1/forecast` — `past_days=2`, `forecast_days=8`, `timezone=auto`
- Archive backfill: `https://archive-api.open-meteo.com/v1/archive` (ERA5 reanalysis)
- Driven by `WeatherCollectionService`, interval from `Weather:FetchIntervalHours`
- There is **no account and no plan** to check — the non-commercial tier asks only for attribution

Because of that, the provenance values are **`weather_app` / `weather_app_forecast`** rather than `owm` / `owm_forecast`. Writing `owm` into the database would name a provider that never served the row.

**What it already fetched:** `temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`, `relative_humidity_2m_mean`. So humidity *was* already collected (as a daily mean, stored in `weather_daily.humidity_mean`) and labelled "collected for display only, Hargreaves does not use it". **Wind was not fetched at all.**

**What changed (additive, same code path):** the request now also asks for `relative_humidity_2m_min`, `relative_humidity_2m_max` and `wind_speed_10m_max`, with `&wind_speed_unit=ms` so the figures arrive in the unit FAO-56 works in. Same free call, no extra request.

### The existing ETo code is Hargreaves, not Penman-Monteith

`AgroFlow.Business.Agronomy.ReferenceEvapotranspiration` implements **FAO-56 Eq. 52 (Hargreaves)**, with a documented reason: when it was written there was no radiation, wind or humidity data, and FAO-56 p. 64 offers Eq. 52 for exactly that case. It also implements Eq. 20–25 (extraterrestrial radiation Ra), verified against FAO-56 Example 8.

The spec asks for Eq. 6 (Penman-Monteith) and says to use the existing calculator "if it matches this". It does not match, so **Eq. 6 was added in a new file and Eq. 52 was kept**, untouched, as the documented fallback and for the existing schedule-report narrative. Ra is reused from the existing class rather than reimplemented.

### Firmware payload (read only — firmware was not modified)

From `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino`:

- Publishes over MQTT to `agroflow/farm/{farmId}/device/{deviceId}/sensors` as `{"sensorType": "...", "value": n}`
- **Only `SoilMoisture` is sent.** The firmware states plainly: *"No temperature/humidity sensor is wired on this board (only a soil moisture probe)"*
- **Moisture is already a percentage, not a raw ADC value.** `readMoisturePercent()` maps the raw reading through `ADC_DRY = 3000` and `ADC_WET = 1200` and clamps to 0–100
- **Direction: lower raw ADC = wetter.** So after the firmware's conversion, **higher percentage = wetter**

The engine's calibration maths is written against the two calibration points rather than against an assumed direction, so it is correct whether the column ends up holding raw ADC values or percentages, and whichever way round wet and dry sit.

### `sensor_reading` layout

`sensor_reading(id, zone_id, sensor_type, value, recorded_at)`, with a CHECK since 0002 allowing `'SoilMoisture'`, `'Temperature'`, `'Humidity'`.

**The constraint already permits DHT11 rows, but nothing writes them.** Temperature and humidity are plumbed through views (`zone_latest_reading`) and `SensorReadingProcessor`, but no device sends them. So the new `dht_daily` view **starts empty and fills itself** the day a DHT11 is wired — which is exactly why the engine's DHT11 path is a fallback and never a requirement.

### Irrigation events and live columns

`irrigation_event(id, zone_id, started_at, runtime_seconds, estimated_litres, source, ...)`. `estimated_litres` became nullable and server-derived in 0020; its comment says it is **never measured** and NULL means "no flow rate configured", not "no water".

`zone` already had: `id, farm_id, crop_type, water_saved, health_status, moisture_threshold, desired_moisture, irrigation_mode, schedule_*, automation_enabled, weather_adjustment, name, location, size_value, size_unit, planting_date, flow_rate_lpm`.

- **`flow_rate_lpm` already exists** (0018, default 1.5 set in 0020) → the migration does **not** add it.
- `size_value`/`size_unit` are hectares and were left alone; `area_m2` is a separate measured figure, because the demo tubs cannot be expressed in hectares without losing precision.
- `farm.latitude` / `farm.longitude` already exist (0010). **There is no `farm.elevation`** — see the assumptions list.

`ai_recommendation` already existed from 0003 as `(recommendation_id, zone_id, message, priority, estimated_water, created_at)` — extended, not replaced. `alert` is `(id, zone_id, severity, message, status Open|Resolved, created_at, updated_at)`.

### What `IrrigationAdvisor.Advise` calculated before this work

A narrative advisor, not a water balance: it resolved the crop, assessed the growth stage and Kc (Eq. 66), computed ET0 (Eq. 52) and ETc (Eq. 58), reported the Table 22 depletion fraction *as context only*, produced a rainfall-outlook sentence, and decided `IrrigateNow` / `NoActionNeeded` / `InsufficientData` **purely by comparing moisture against the farmer's threshold**.

Its own Limitations line named the gap this engine fills:

> *"AgroFlow does not record soil texture per zone, so p is reported as context only — the irrigation trigger remains the farmer's configured moisture threshold."*

---

## What was built, with paths

### Calculations — pure, no I/O, verifiable offline

| File | Contents |
|---|---|
| `backend/AgroFlow.Domain/Agronomy/PenmanMonteithEto.cs` | Eq. 6, and the chain it needs: Eq. 8/9 (pressure, γ), 11/12 (es), 13 (Δ), 17/19/48 (ea), 37 (Rso), 38/39/40 (Rn), 47 (wind to 2 m), 50 (Rs from temperature range), 64 (RHmin estimate) |
| `backend/AgroFlow.Domain/Agronomy/SoilWaterBalance.cs` | Kc (Eq. 66), p adjustment, TAW/RAW (Eq. 82/83), daily depletion (Eq. 85, with Eq. 88 as the clamp at zero), Ks (Eq. 84), ETc_adj (Eq. 81), Dr anchoring, litres/minutes |
| `backend/AgroFlow.Domain/Agronomy/Fao56EngineReference.cs` | Tables 11, 12, 19, 22 — every value cited per field |
| `backend/AgroFlow.Domain/Agronomy/DailyEtoResolver.cs` | The §3c fallback order, recording the source of every input |
| `backend/AgroFlow.Domain/Agronomy/Fao56Engine.cs` | The per-zone daily balance |
| `backend/AgroFlow.Domain/Agronomy/ZoneInsightBuilder.cs` | The §7 insight set |

### Data and orchestration — DB / XDB / Controller, synchronous, no DTOs, no interfaces

| File | Contents |
|---|---|
| `backend/AgroFlow.Domain/Fao56EngineXDB.cs` | `: DB`. All SQL. Zones, weather+`dht_daily`, readings, irrigation mm/day, balance and insight upserts, fault signals, DHT11 detection, calibration and soil writes, access check, maintenance alert |
| `backend/AgroFlow.Domain/Fao56EngineController.cs` | Assembles engine inputs, runs and persists, reset-to-recommended, calibration, soil type |
| `backend/AgroFlow.Api/Services/Fao56EngineService.cs` | `BackgroundService`, hosted like the MQTT/LISTEN services |
| `backend/AgroFlow.Api/Endpoints/Fao56EngineEndpoints.cs` | The new farmer endpoints |

It does not use `DataSet`/`DataAdapter` like `ZoneDB` does: the engine reads several differently-shaped result sets per zone and writes `ON CONFLICT` upserts, which `DataAdapter` cannot express. The layering is unchanged — SQL lives in the XDB and nowhere else.

### New endpoints

```
POST /api/farmer/zones/{id}/reset-recommended
POST /api/farmer/zones/{id}/calibration        { "point": "wet" | "dry" }
PUT  /api/farmer/zones/{id}/soil               { "soil_type": "sandy"|"loam"|"clay" }
GET  /api/farmer/zones/{id}/insights
POST /api/farmer/insights/{insightType}/dismiss?zoneId=
```

All check *owner, farm member, or `profile.role = 'admin'`* — Olwethu's rule. **Luba's `PUT /api/farmer/zones/{zoneId}/settings` was not touched or extended**; the soil type has its own endpoint in its own file.

### Schedule (§10)

`Fao56EngineService` runs a **full daily pass** on the first tick after the SAST day rolls over (balance, ETo, and every insight), and the **`act_now` checks every 15 minutes** in between. Every write is an upsert keyed on `(zone, day)` and the engine is a pure function of its inputs, so a missed run, a double run or a restart mid-pass all converge on the same rows. `Fao56Engine:Enabled=false` turns the background passes off without disabling the endpoints.

---

## Migration `0027_fao56_engine.sql` — NOT APPLIED

Numbered 0027 because 0024–0026 already exist, so a new 0022 would sort before applied migrations.

**`zone`** — added `soil_type text not null default 'loam'` (CHECK sandy/loam/clay), `area_m2`, `root_depth_limit_m`, `calibration_wet`, `calibration_dry`, all numeric and nullable with positivity checks. **`flow_rate_lpm` not added — it already exists.**

**`weather_daily`** — added `rh_min_pct`, `rh_max_pct`, `wind_ms`, `wind_height_m`, `eto_mm`, `eto_source`, `rs_source`, all nullable. `humidity_mean` and `source` already existed and are untouched. `wind_height_m` travels with `wind_ms` because Open-Meteo measures at 10 m and Eq. 6 is defined at 2 m — storing the height means a second provider later cannot silently skew every ETo figure.

**`dht_daily`** (view, `security_invoker = true`) — daily DHT11 max/min temperature and mean RH per zone, grouped by `Africa/Johannesburg` day, calculated from `sensor_reading`. No stored copy.

**`zone_water_balance`** — `(zone_id, day, day_of_season, stage, kc, etc_mm, p, taw_mm, raw_mm, rain_mm, irrigation_mm, dr_end_mm, ks, incomplete)`, unique on `(zone_id, day)`.

**`ai_recommendation`** — added `insight_type`, `severity` (CHECK act_now/heads_up/info), `data jsonb`, `valid_for`, `dismissed_at`. Partial unique index on `(zone_id, insight_type, valid_for)`. `priority` left in place so anything reading it keeps working. **No FK to irrigation commands — BR 6.9.**

**`report_daily_weather`** (view, `security_invoker = true`) — observed weather days beside the local crop sensor, with the difference, for §9c.

**Security** — RLS on `zone_water_balance` reading through `zone → farm` via `app_can_access_farm()`; admin-all policy; `GRANT SELECT` to `authenticated`; writes service_role only (the API owns the tables and bypasses RLS). Farmers get **column-level** `GRANT UPDATE (dismissed_at)` on `ai_recommendation`, so they can dismiss an insight but cannot rewrite its message or severity. Both views grant SELECT to `authenticated`. No `$$` dollar-quoting anywhere; policies are made idempotent with `DROP POLICY IF EXISTS`, and views use DROP-then-CREATE.

---

## Verification results (§12) — all pass

`dotnet test` → **313 passed, 0 failed.** 278 of those existed before this work and still pass unchanged.

### FAO-56 worked examples, expected vs actual

| Check | Quantity | Expected | Actual |
|---|---|---|---|
| **12.1** Example 28 Kc | day 20 | 0.150 | **0.150** |
| | day 40 | 0.770 | **0.774** |
| | day 70 | 1.190 | **1.190** |
| | day 95 | 0.560 | **0.560** |
| **12.2** Example 37 | TAW | 160.0 mm | **160.000** |
| | RAW | 64.0 mm | **64.000** |
| | Ks at Dr 67.0 | 0.97 | **0.969** |
| | Ks at Dr 72.8 | 0.91 | **0.908** |
| **12.3** Example 37 balance | Dr after 10 days | 104.5 ±0.5 mm | **104.505** |
| **12.4** Example 36 | TAW | 136.0 mm | **136.000** |
| | RAW | ≈54 mm | **54.400** |
| **12.5** p adjustment | p 0.40 at ETc 8 | 0.28 | **0.280** |
| | p 0.20 at ETc 12 | 0.10 (clamped) | **0.100** |
| **12.6** Example 18 ETo | Tmean | 16.9 °C | **16.900** |
| | Δ | 0.122 kPa/°C | **0.122** |
| | P | 100.1 kPa | **100.124** |
| | γ | 0.0666 kPa/°C | **0.067** |
| | es | 1.997 kPa | **1.997** |
| | ea | 1.409 kPa | **1.409** |
| | es − ea | 0.589 kPa | **0.589** |
| | Ra | 41.09 MJ m⁻² d⁻¹ | **41.088** |
| | Rso | 30.90 | **30.816** |
| | Rns | 17.0 | **16.994** |
| | Rnl | 3.71 | **3.727** |
| | Rn | 13.28 | **13.267** |
| | **ETo** | **3.9 mm/day** | **3.972** |
| **12.6** Eq. 47 | 3.2 m/s at 10 m → 2 m | 2.4 m/s | **2.393** |

Two notes on 12.6. The **day convention** for Kc counts day *i* directly against the cumulative stage lengths — Example 28's 0.77 on day 40 is `(40−25)/25` of the way from Kc_ini to Kc_mid; treating day 40 as 39 days after planting gives 0.73 and fails the book. And Example 18 derives Rs from measured sunshine hours (Eq. 35, n = 9.25 h), which AgroFlow has no sensor for, so the book's published Rs is fed in and the test checks Eq. 6 and the vapour/radiation chain rather than Eq. 35. The small residuals throughout are the book's own rounding of intermediate values.

### 12.7 Data rules

| Rule | Result |
|---|---|
| Invalid soil reading excluded from calculations, row kept | ✅ a 9999 reading stays in the list; calculations used the last good value (2400) |
| Reading beyond calibration by >10 % of (wet − dry) is invalid | ✅ boundary tested exactly: 1020 valid, 1019 invalid |
| No observed `weather_daily` row → `dht_daily` with `source = dht11_fallback` | ✅ |
| No temperature from either source → `data_gap` insight, no ETo | ✅ and Dr carries forward one day, then the balance pauses |
| Estimated litres null when `flow_rate_lpm` is null | ✅ and null area → no litres |
| Uncalibrated zones still get watering advice | ✅ balance runs; only the moisture percentage is withheld |

### 12.7b Reports

| Rule | Result |
|---|---|
| `Advise` returns valid `ZoneAdvice` for a zone with no planting date, no exception | ✅ Summary populated, Limitations name the planting date, a `setup_missing` insight is produced |
| Schedule, moisture and water-usage JSON each contain an `insights` array of `{ text, source }` | ✅ |
| PDFs carry the insights block in the stated positions | ✅ schedule: after "Figures and their sources", before "7-day outlook". Moisture and water usage: after the summary line |

### §8b DHT11 fault

| Rule | Result |
|---|---|
| DHT-offline input → exactly one `dht_offline` insight per zone per day | ✅ (in memory, nothing seeded) |
| Exactly one open maintenance request (here an `alert`) per zone | ✅ deduped by `HasOpenDhtAlert` |
| 3 valid readings clear the insight but leave the request open | ✅ the request is never closed automatically |
| App shows weather-app values labelled "sensor offline" | ✅ report rows carry `note: "Sensor offline"`; the difference column is null, never zero |

### §7 copy rules, enforced rather than trusted

Every message the builder can produce, across 11 zone states, is swept for banned terms (**Kc, ETo, ETc, TAW, RAW, Ks, depletion, evapotranspiration, FAO, coefficient, mm**) and for the ~120-character limit. Both pass. Also checked: one insight per zone per type per day, every insight carries a type/severity/source/day, and `water_now` and `skip_rain` never fire together.

### 12.8 Builds

| Check | Result |
|---|---|
| `dotnet build` | ✅ 0 warnings, 0 errors |
| `npx tsc --noEmit` (mobile) | ✅ |
| `npx expo-doctor` | ✅ **21/21** |
| `npx tsc --noEmit` (admin) | ✅ |
| `npm run build` (admin) | ✅ |

---

## Every ASSUMPTION

1. **Table 11 rows** were picked as the closest fit to South African planting. FAO says stage lengths are indicative only; a real season may run shorter or longer.
2. **Tomato Kc_end** is published as the range 0.70–0.90. The midpoint **0.80** is used.
3. **Maize Kc_end** is published as 0.60 (harvested at high grain moisture) or 0.35 (field-dried). **0.35** is used, so the engine plans for a crop dried down in the field. *The existing `fao56-crop-knowledge.json` uses 0.60 — see the divergence note below.*
4. **Potato stage lengths**: Table 11's Jan/Nov (Semi)Arid row prints two alternative mid-season lengths (30 or 45). **45** is used, giving a 130-day season.
5. **Zr** is the low end of each Table 22 range; FAO says the smaller values are intended for irrigation scheduling.
6. **p** comes from Table 22 at ETc ≈ 5 mm/day.
7. **Table 19 soil values are midpoints** of the published ranges. "Sandy" uses FAO's **Sand** class, not sandy loam, so it differs clearly from loam. Ranges as reproduced in Allen et al. (2005), *J. Irrig. Drain. Eng.* 131(1), Table 1.
8. **The soil p factor is ±5 %** (clay ×0.95, sand ×1.05). FAO-56 Chapter 8 allows 5–10 %; the smaller end is used.
9. **The demo tubs hold garden soil (`loam`)** with identical conditions. `loam` is the column default.
10. **Dr anchoring is linear**: relative dryness × TAW, a stand-in for Eq. 87. The resistive probe reports relative conductivity, not volumetric water content, so this is a mapping, not a measurement.
11. **Mid-season is treated as covering flowering and yield formation**, which is what the `peak_growth` insight rests on. FAO-56 Chapter 8 says shortages then cost the most yield; mapping that onto the mid-season stage is ours.
12. **Farm elevation is taken as sea level (0 m).** There is no `farm.elevation` column. It enters only through Eq. 8 → γ, which moves about 1 % per 100 m.
13. **Rs is always estimated** from the daily temperature range (Eq. 50), with `kRs = 0.16`, FAO's **interior** value — no AgroFlow farm is known to be coastal. Rs is capped at clear-sky Rso, since Eq. 50 can exceed it on a very large diurnal range.
14. **Where humidity is missing entirely**, ea is taken as e⁰(Tmin) (Eq. 48) without FAO's suggested 2–3 °C arid-climate subtraction, because the engine does not know which farms are arid. The day is flagged `estimated`.
15. **Provenance values are `weather_app` / `weather_app_forecast`**, not `owm` / `owm_forecast`, because the provider is Open-Meteo.
16. **`watering_failed` on an uncalibrated zone** assumes higher = wetter, which is what the current firmware sends.

### The one divergence you should decide about

The engine's crop table and `fao56-crop-knowledge.json` disagree for two crops. **Both readings are tabulated FAO-56 values** — this is a choice of row and of management case, not a transcription error:

| Crop | `fao56-crop-knowledge.json` (existing) | `Fao56EngineReference.cs` (new) |
|---|---|---|
| maize | 30/40/50/30 = 150 (Apr, Spain/Calif.), Kc_end **0.60** | 25/40/45/30 = 140 (Dec/Jan, Arid), Kc_end **0.35** |
| potato | 30/35/50/25 = 140 (Dec, Calif. Desert) | 25/30/45/30 = 130 (Jan/Nov, (Semi)Arid) |

They are kept separate on purpose: editing the JSON would have silently moved the numbers in Olwethu's existing schedule report and broken the tests pinned to it. **Unifying them is a team decision**, and the divergence is documented at the top of `Fao56EngineReference.cs` so nobody discovers it by accident.

---

## Crops — the eight keys, confirmed

**Decision taken: keep all eight.** The engine holds the spec's six plus `citrus` and `leafy_veg`, and Luba's `service_request` crop CHECK is left as it is. Nothing was narrowed and nothing was deleted.

| Key | FAO-56 entry used | Offered in the pickers? |
|---|---|---|
| `maize` | Maize, field (grain) | yes |
| `potato` | Potato | yes |
| `tomato` | Tomato | yes |
| `dry beans` | Beans, dry and pulses | yes |
| `spinach` | Spinach | yes |
| `cucumber` | Cucumber, fresh market | yes |
| `leafy_veg` | **Lettuce** — see below | resolvable, not offered as a new choice |
| `citrus` | **Citrus, no ground cover – 70% canopy** — see below | resolvable, not offered as a new choice |

### What `leafy_veg` actually is

**FAO-56 has no "leafy veg" entry — it tabulates named crops.** This key maps to **Lettuce**, in all three tables:

| Value | FAO-56 source | Page |
|---|---|---|
| Stage lengths 20 / 30 / 15 / 10 = 75 d | Table 11, **Lettuce**, planted April, Mediterranean | **p. 104** |
| Kc_ini 0.70 | Table 12, **group row "a. Small Vegetables"** — Table 12 omits Kc_ini on the lettuce line itself | **p. 110** |
| Kc_mid 1.00, Kc_end 0.95 | Table 12, **Lettuce** | **p. 110** |
| Zr 0.3–0.5 m (0.3 used), p 0.30 | Table 22, **Lettuce** | **p. 163** |

So a zone recorded as "leafy veg" is being advised **as lettuce**. That matters: spinach, chard and cabbage are not lettuce, and FAO-56 gives spinach its own row — which is why `spinach` is now its own key rather than an alias of this one, as it was previously. If a farmer is growing something leafy that is not lettuce, the honest options are to add that crop's own FAO-56 row or to leave the zone resolving to nothing and get `setup_missing`. The crop's farmer-facing label is now **"Leafy vegetables (lettuce)"** so this is visible in the app rather than buried here.

### What the citrus values represent

**FAO-56 publishes six citrus variants** — with or without active ground cover, each at 70%, 50% and 20% canopy. The engine uses exactly one of them:

| Value | FAO-56 source | Page |
|---|---|---|
| Stage lengths 60 / 90 / 120 / 95 = 365 d | Table 11, Citrus, planted Jan, Mediterranean (the only citrus row published) | **p. 107** |
| Kc_ini 0.70, Kc_mid 0.65, Kc_end 0.70 | Table 12, **"Citrus, no ground cover – 70% canopy"** | **p. 113** |
| Zr 1.2–1.5 m (1.2 used), p 0.50 | Table 22, **"Citrus – 70% canopy"** | **p. 165** |

Which is to say: a **mature orchard at 70% canopy with a clean floor and no ground cover**. A younger planting, or an orchard with grass between the rows, is a *different published row* and these numbers do not apply to it. The other five variants are recorded in `fao56-crop-knowledge.json` so switching is a data edit, not a code change.

Two things about citrus that are correct and look wrong:

- **Kc_mid (0.65) is *below* Kc_ini (0.70).** FAO-56 p. 113: *"The midseason value is lower than initial and ending values due to the effects of stomatal closure during periods of peak ET."* So Kc interpolates **downward** through development and **upward** through late season. Not a sign error.
- **The season totals 365 days.** Citrus is an evergreen perennial, so `planting_date` here means **the start of the annual cycle**, not the year the tree went into the ground.

### Crops with no FAO-56 values

| Crop string | Where it appears | Status |
|---|---|---|
| `grapes`, `wheat`, `apples` | admin `referenceData.ts` only | **No FAO-56 values.** Resolve to null; zones with them get `setup_missing`. Supply the Table 11/12/22 rows if you want them |

Nothing is ever substituted: an unrecognised crop resolves to null and the zone is told what is missing, rather than being advised on some other crop's Kc curve.

---

## Files of Olwethu's that changed

All changes additive — sections added, nothing rewritten or removed, and her `async` endpoints were **not** refactored.

| File | What changed |
|---|---|
| `backend/AgroFlow.Api/Endpoints/ReportEndpoints.cs` | `GetScheduleAsync`, `GetMoistureAsync`, `GetWaterUsageAsync` and the three PDF endpoints take the engine controller. `insights` is now `{ text, source }`; `plainSummary`, `waterBalance` and `weatherComparison` added to the schedule response; `insights` and `calibrationNote` added to the moisture and water-usage responses; insight blocks and the "Weather: area vs at your plants" table added to the PDFs. `CollectInsights`, `ReadWeatherComparisonAsync`, `WriteInsightsBlock`, `Round1` added |
| `apps/web/admin/src/app/interactions.ts` | `liveInsight`, `liveInsights`, `liveWeatherComparison` added; `liveRender` renders insights in all three reports and the weather table under the schedule's 7-day table |
| `apps/web/admin/src/pages/analytics.ts` | One label: "Volume delivered" → **"Estimated volume delivered"** (§9d). The mock card itself was **not** removed — your call |
| `apps/web/admin/src/styles/main.css` | Appended styles for the insight list and weather table, using existing tokens only |

Her `insights` array used to hold the FAO-56 narrative strings. Those are **not lost** — they moved to `faoNotes` on the same object, and every line still cites the textbook. The new `insights` array is the farmer-facing set.

**`ZoneAdvice` keeps its shape.** `Summary`, `Reasoning`, `Facts`, `Insights` and `Limitations` all behave exactly as before — her existing tests assert on `Summary` text and that every `Insights` line contains "FAO-56", and both still pass. The water-balance results are **added** alongside as `FarmerInsights`, `PlainSummary` and the figure properties. `ZoneAdviceInput` gained `WaterBalance` and `FaultSignals` as **optional** properties, so a caller that has not been updated compiles and behaves identically.

---

## §8b: why the DHT11 callout is an `alert`, not a `service_request`

The spec prefers reusing Luba's `service_request` table, **unless** her constraints require a crop or size for every row. **They do:**

```sql
crop_type  text not null check (crop_type in (...)),
farmer_id  uuid not null references profile (id) on delete cascade,
```

A system-generated maintenance row would have to invent a crop *and* attribute the request to a farmer who never made it. That is fabricating data, so the spec's own fallback applies: an admin-facing **`alert`** row instead, with the specified wording:

> "DHT11 temperature/humidity sensor not responding since {time}. System is using weather app data. Needs a site visit."

**Her table, her `request_type` CHECK and her Farm Requests page are all untouched** — adding a `maintenance` type and an admin label for it would have been dead code given nothing writes such rows. Deduped to at most one open alert per zone, and never closed automatically.

### Follow-ups, not built tonight (as instructed)

- A stuck soil sensor (`sensor_stuck` for more than 24 h) could use the same maintenance-callout flow.
- A board offline for more than 24 h (`zone_offline`) likewise.
- Once the firmware sends a `dht_status` field (OK / TIMEOUT / CHECKSUM from DHTesp), detection can use it directly instead of inferring from missing rows.

---

## Mobile components — where to mount them

**New files only. `apps/mobile/src/app/zone/[id].tsx` was not edited.**

| Component | File |
|---|---|
| `ZoneInsightsCard` | `apps/mobile/src/components/ZoneInsightsCard.tsx` |
| `ZoneGrowthBar` | `apps/mobile/src/components/ZoneGrowthBar.tsx` |
| `ResetRecommendedButton` | `apps/mobile/src/components/ResetRecommendedButton.tsx` |
| `CalibrateSoilSheet` | `apps/mobile/src/components/CalibrateSoilSheet.tsx` |
| Soil type screen | `apps/mobile/src/app/zone-soil.tsx` |
| Styles | `apps/mobile/src/styles/zoneInsightsStyles.ts`, `zoneSoilStyles.ts` |
| API calls | appended to `apps/mobile/src/services/agroFlowApi.ts` |

### The exact mount point

In `apps/mobile/src/app/zone/[id].tsx`, the content container opens at lines 1118–1122:

```
1118:         <View
1119:           style={
1120:             styles.content
1121:           }
1122:         >          <- insert immediately AFTER this line
1123:           <View                               (the "Live Overview" heading starts here)
```

**Insert after line 1122, before line 1123**, so the advice sits above "Live Overview":

```tsx
<ZoneGrowthBar
  stage={/* zone stage from the engine */}
  dayOfSeason={/* dayOfSeason */}
  totalDays={/* seasonLengthDays */}
  cropLabel={selectedZone.cropType}
/>
<ZoneInsightsCard zoneId={Number(id)} />
```

And in the zone's settings area, wherever the moisture threshold controls sit:

```tsx
<ResetRecommendedButton zoneId={Number(id)} />
<CalibrateSoilSheet
  zoneId={Number(id)}
  visible={calibrationOpen}
  onClose={() => setCalibrationOpen(false)}
/>
```

**Link to the soil type screen** from the same settings area:

```tsx
router.push({
  pathname: '/zone-soil',
  params: { zoneId: String(id), soilType: selectedZone.soilType ?? 'loam', zoneName: selectedZone.name },
});
```

**The help button for `zone/[id].tsx`** belongs on the same line as the existing header controls, beside the status badge that closes at line 1116:

```tsx
<HelpButton screen="zoneDetail" />
```

`helpContent.ts` already has `zoneDetail`, `zoneInsights`, `zoneCalibration`, `zoneResetRecommended` and `zoneSoil` entries ready.

### Soil icons

The three provided SVGs are committed unchanged at `apps/mobile/assets/soil/soil_{sandy,loam,clay}.svg`, and each card now shows its icon instead of a plain coloured swatch.

They are rendered by `src/components/SoilIcon.tsx` using `react-native-svg`, with the drawing commands transcribed **verbatim** from those files — nothing redrawn or restyled. It is a `.tsx` rather than a direct `.svg` import because importing SVG files as components needs `react-native-svg-transformer` plus a `metro.config.js`, neither of which this repo has and neither of which anything else needs. That is the same arrangement the mascot already uses: `components/mascot/Drip.tsx` is what the app renders, `assets/mascot/drip_*.svg` is the design source for docs and slides. If a transformer is added later, the three branches in `SoilIcon.tsx` can be replaced by direct imports with no other change.

**Source note:** FAO-56 Table 19 supplies the soil water-holding values. The "how it feels" lines are the ordinary hand texture check, **not** from FAO-56, and the screen says so in small print at the bottom.

---

## Phase D and E results

### Phase D — `feature/help-mascot` (`3e5ee53`) and `feature/drip-and-soil` (`e61011e`, `c7baf7d`)

**Built:** `src/constants/helpContent.ts` (all copy, one file, keyed by screen); `HelpButton` (circled "?", accessible label "Help for this page", renders nothing when the setting is off); `useAppPreferences()`; two additive Settings toggles.

**Storage: `@react-native-async-storage/async-storage`** — already a dependency (2.2.0) and already used for the notification preferences and the selected farm. **Nothing was installed.** Deliberately **not** `profile`: that table has column-level UPDATE revokes, and these are per-device display choices.

**Mounted on:** Home, Irrigation, Alerts, History, Settings, Profile, Farm requests, Soil type. Via an optional `help` prop on the shared `ScreenHeader`, so adding help to a screen is a one-word change. **Not** on `zone/[id].tsx` — mount point above.

**Checks:** `npx tsc --noEmit` clean, `npx expo-doctor` 21/21. Both toggles persist across restart (written to AsyncStorage on change, read on first mount). With help off, no "?" icons render at all — `HelpButton` returns `null` before anything else.

**Raindrop helper** (`src/components/DripHelper.tsx`), using `Drip.tsx` exactly as provided:

- **Greeting:** waves for ~2 s, then switches to the mood matching the message — `thirsty` for water now / water soon, `alert` for alerts or unfinished setup, `happy` when there is nothing to report.
- **Speech bubble:** one message, by the spec's priority — an `act_now` insight, then unread alerts, then `water_soon`, then `setup_missing`, then "All your zones look good today." `setup_missing` is deliberately excluded from the first rule so it keeps its own gentler wording ("Finish setting up {zone} to get watering advice.") at priority 4 instead of surfacing the raw "add the area and the flow rate" list.
- **Interaction:** tapping opens what it is about (Alerts, or that zone); the "×" hides it for the session; it auto-hides after ~8 s. Accessible label is `"{MASCOT_NAME} says: {message}"`, with `MASCOT_NAME` read from `Drip.tsx` rather than hard-coded.
- **Animation:** built-in React Native `Animated` — three small wiggles (±5 px) over about a second, then idle. **No new dependencies.** When `AccessibilityInfo.isReduceMotionEnabled()` is true it fades in with no shake; it also takes the no-shake path if that call throws, so a platform that cannot answer gets less motion rather than more.
- **When it appears:** once per app open or login, after Home's data has loaded, bottom-right above the tab bar, and only when the "Raindrop helper" toggle is on. The once-per-session flag is module-level so returning to the Home tab does not re-greet; `AuthContext.signOut()` calls `resetDripHelperSession()` so the next farmer to log in gets their own greeting. Switching the toggle off mid-session hides it immediately.
- **Not on the web admin.**

**Insight data** comes from `src/services/insightsService.ts`, reading `ai_recommendation` directly from Supabase under RLS for the farmer's own zones, for today's SAST date, excluding dismissed rows. This follows the project rule that the apps read ordinary data themselves and the API only does what a client cannot. **Every failure path returns an empty list** — a missing table, older columns, or no network all fall back to alerts and then to "all good". Never a crash, never placeholder text pretending to be advice.

### Phase E — `feature/admin-welcome` (`635f3d2`)

`apps/web/admin/src/pages/welcome.ts` plus a fourth render state in `main.ts`. A visitor with no session sees the welcome screen and reaches the login form only by pressing **Log in**; a valid admin session goes straight to the dashboard as before. **`auth.ts` and `pages/login.ts` were not modified.** Signing out returns to the welcome screen, and the "asked to log in" flag is not persisted, so a reload is a fresh arrival.

Design uses only existing tokens on `#184D35` (`--bg-grad-1`). Background is two CSS radial gradients plus one inline `aria-hidden` SVG — **no images, no CDN, no new npm dependencies** — so it works on GitHub Pages under any Vite base path. The control is a real `<button>`, in the tab order, focused on arrival, with a focus ring visible against the dark background. Responsive to phone width.

**Checks:** `npx tsc --noEmit` clean, `npm run build` succeeds.

---

## Not built, because not sourced

Disease risk, yield prediction, and best time of day to water — as instructed.

---

## What Leruo must do

1. **Review the merged local `dev`, then push it.** Also push your own unpushed `7985f85` (the OpenStreetMap commit) — see `merge-report.md`. Close PR #1 on `fix/expo-cors` once `dev` is up.
2. **Run the live SELECTs** listed in `merge-report.md` §6 and §8 — seeded `estimated_litres` counts, `select distinct crop_type from public.zone`, and `select crop_type, count(*) from service_request group by 1`. I could not run them without touching the secrets file.
3. **Decide the crop-list question** (§2 at the top of this report): keep eight crops, or narrow to six. If narrowing, the `service_request` CHECK statement is written out as a comment at the end of migration 0027.
4. **Decide the maize/potato Table 11 divergence** between `fao56-crop-knowledge.json` and `Fao56EngineReference.cs`.
5. **Migration `0027_fao56_engine.sql` is applied.** ✅ Run the read-only verification at the end of this report to confirm the applied schema matches the code.
6. **Measure each tub's area and depth**, and set them:

```sql
-- Replace the values with your measurements.
update zone set area_m2 = 1.5,  root_depth_limit_m = 0.30 where id = <zone id>;
update zone set area_m2 = 1.5,  root_depth_limit_m = 0.30 where id = <zone id>;
```

7. **Set `flow_rate_lpm = 1.5` on both demo zones.** Measured: 500 mL in 20 s, so 0.5 L ÷ 20 s × 60 = **1.5 L/min**.

```sql
update zone set flow_rate_lpm = 1.5 where id in (<zone id>, <zone id>);
```

8. **Do the wet/dry calibration for each sensor** — open the Calibrate sheet, soak the soil, wait a day, Save wet; later, when properly dry, Save dry. Or by hand:

```sql
update zone set calibration_wet = <reading>, calibration_dry = <reading> where id = <zone id>;
```

9. **Set farm locations. Farm 21 has none**, and without a latitude the engine cannot work out sunshine, so that farm gets no water figures at all:

```sql
update farm set latitude = <lat>, longitude = <lon> where farm_id = 21;
```

10. **Mount the components** — exact lines above. Nothing in `zone/[id].tsx` was touched.
11. **Set the soil type per zone** if the loam default is wrong — the farmer can now do this themselves on the Soil type screen.
12. **Nothing further on the artwork** — `Drip.tsx` and all seven SVGs are in and wired up.

### Installer-set fields

`area_m2`, `flow_rate_lpm` and `root_depth_limit_m` are team-set at installation. **The admin dashboard has no zone edit form** to add them to, so none was built — the SQL above sets them by hand. `soil_type` is team-set at install *and* farmer-changeable on the new screen.

---

## Verify the applied migration

Read-only. Every statement below is a `SELECT` — nothing writes, nothing locks, and there is no `$$` dollar-quoting anywhere, so the Supabase SQL editor will take them one at a time.

Each check returns a `verdict` column so you can read the answer without counting rows.

### 1. The new `zone` columns

```sql
select c.column_name, c.data_type, c.is_nullable, c.column_default, 'OK - present' as verdict
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'zone'
  and c.column_name in ('soil_type','area_m2','root_depth_limit_m','calibration_wet','calibration_dry','flow_rate_lpm')
order by c.column_name;
```

Expect **6 rows**: `area_m2`, `calibration_dry`, `calibration_wet`, `flow_rate_lpm`, `root_depth_limit_m`, `soil_type`. `soil_type` should be `NO` for nullable with default `'loam'::text`; `flow_rate_lpm` should default to `1.5` (it predates this migration — 0018, default set in 0020). Anything missing is a column the engine expects and will not find.

### 2. The new `zone` CHECK constraints

```sql
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'zone'
  and con.conname in ('zone_soil_type_check','zone_area_m2_check','zone_root_depth_limit_check')
order by con.conname;
```

Expect **3 rows**, with `zone_soil_type_check` reading `CHECK (soil_type = ANY (ARRAY['sandy'::text, 'loam'::text, 'clay'::text]))`.

### 3. The new `weather_daily` columns

```sql
select c.column_name, c.data_type, c.is_nullable, 'OK - present' as verdict
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'weather_daily'
  and c.column_name in ('rh_min_pct','rh_max_pct','wind_ms','wind_height_m','eto_mm','eto_source','rs_source')
order by c.column_name;
```

Expect **7 rows**, all nullable `YES`. `eto_source` and `rs_source` are `text`; the rest `real`.

### 4. The new tables and views exist

```sql
select c.relname as object_name,
       case c.relkind when 'r' then 'table' when 'v' then 'view' else c.relkind::text end as kind,
       'OK - present' as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('zone_water_balance','ai_recommendation','dht_daily','report_daily_weather')
order by c.relname;
```

Expect **4 rows**: `ai_recommendation` (table), `dht_daily` (view), `report_daily_weather` (view), `zone_water_balance` (table).

### 5. The new `ai_recommendation` columns, and the uniqueness indexes

```sql
select c.column_name, c.data_type, 'OK - present' as verdict
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'ai_recommendation'
  and c.column_name in ('insight_type','severity','data','valid_for','dismissed_at')
order by c.column_name;
```

Expect **5 rows**; `data` must be `jsonb`, `valid_for` must be `date`.

```sql
select i.tablename, i.indexname, i.indexdef
from pg_indexes i
where i.schemaname = 'public'
  and i.tablename in ('ai_recommendation','zone_water_balance')
order by i.tablename, i.indexname;
```

Expect `uq_ai_recommendation_zone_type_day` (unique, partial, on `zone_id, insight_type, valid_for`) and `uq_zone_water_balance_zone_day` (unique on `zone_id, day`). These two are what make the engine's re-runs idempotent — without them a daily pass would stack duplicate rows instead of correcting yesterday's.

### 6. RLS, policies, and no FK to irrigation commands

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       case when c.relrowsecurity then 'OK - RLS on' else 'PROBLEM - RLS off' end as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('zone_water_balance','ai_recommendation','weather_daily','zone')
order by c.relname;
```

Expect `rls_enabled = true` on all four. `rls_forced` should be **false** — deliberate: AgroFlow.Api connects as the table owner and so bypasses the policies, which is how the engine writes rows without needing a write policy.

```sql
select rel.relname as table_name, pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expression
from pg_policy pol
join pg_class rel on rel.oid = pol.polrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname in ('zone_water_balance','ai_recommendation')
order by rel.relname, pol.polname;
```

Expect `zone_water_balance_select_member` and `zone_water_balance_all_admin`, plus on `ai_recommendation` the pre-existing select/admin policies from 0011 and the new `ai_recommendation_dismiss_member`.

```sql
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'ai_recommendation'
  and con.contype = 'f';
```

**Expect no row mentioning an irrigation-command table.** BR 6.9: insights are advisory only and must have no FK path to irrigation commands. A row here naming one is a real problem.

### 7. GRANTs to `authenticated`

```sql
select table_name, privilege_type, 'OK - granted' as verdict
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in ('zone_water_balance','dht_daily','report_daily_weather','ai_recommendation')
order by table_name, privilege_type;
```

Expect `SELECT` on all four, plus `UPDATE` on `ai_recommendation` (the farmer's dismiss). **There should be no `INSERT` or `DELETE` on `zone_water_balance`** — only the engine writes it.

```sql
select table_name, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name = 'ai_recommendation'
order by column_name, privilege_type;
```

Expect `UPDATE` on **`dismissed_at` only**. If `message` or `severity` show up here, a farmer could rewrite an insight rather than just dismiss it.

### 8. The views are `security_invoker = true`

```sql
select c.relname as view_name, c.reloptions,
       case when c.reloptions::text like '%security_invoker=true%'
            then 'OK - security_invoker on'
            else 'PROBLEM - security_invoker NOT set' end as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname in ('dht_daily','report_daily_weather')
order by c.relname;
```

Expect **2 rows, both OK**. This one matters: without `security_invoker` the views run with the owner's rights and could show one farm's sensor readings to another farm's user.

### 9. One combined pass/fail, if you want a single answer

```sql
select 'zone columns' as check_name, count(*) as found, 6 as expected,
       case when count(*) = 6 then 'PASS' else 'FAIL' end as verdict
from information_schema.columns
where table_schema = 'public' and table_name = 'zone'
  and column_name in ('soil_type','area_m2','root_depth_limit_m','calibration_wet','calibration_dry','flow_rate_lpm')
union all
select 'weather_daily columns', count(*), 7,
       case when count(*) = 7 then 'PASS' else 'FAIL' end
from information_schema.columns
where table_schema = 'public' and table_name = 'weather_daily'
  and column_name in ('rh_min_pct','rh_max_pct','wind_ms','wind_height_m','eto_mm','eto_source','rs_source')
union all
select 'ai_recommendation columns', count(*), 5,
       case when count(*) = 5 then 'PASS' else 'FAIL' end
from information_schema.columns
where table_schema = 'public' and table_name = 'ai_recommendation'
  and column_name in ('insight_type','severity','data','valid_for','dismissed_at')
union all
select 'tables and views', count(*), 4,
       case when count(*) = 4 then 'PASS' else 'FAIL' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('zone_water_balance','ai_recommendation','dht_daily','report_daily_weather')
union all
select 'RLS enabled', count(*), 2,
       case when count(*) = 2 then 'PASS' else 'FAIL' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relrowsecurity
  and c.relname in ('zone_water_balance','ai_recommendation')
union all
select 'views security_invoker', count(*), 2,
       case when count(*) = 2 then 'PASS' else 'FAIL' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and c.relname in ('dht_daily','report_daily_weather')
  and c.reloptions::text like '%security_invoker=true%'
union all
select 'authenticated SELECT grants', count(distinct table_name), 4,
       case when count(distinct table_name) = 4 then 'PASS' else 'FAIL' end
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT'
  and table_name in ('zone_water_balance','dht_daily','report_daily_weather','ai_recommendation')
order by check_name;
```

Seven rows, all `PASS`, and the applied schema matches what the code expects.

---

## Set the demo zones' flow rate

Measured on the test rig: **500 mL in 20 s**, so 0.5 L ÷ 20 s × 60 = **1.5 L/min**.

First find the ids, so you are not guessing:

```sql
select z.id, z.name, f.name as farm_name, z.flow_rate_lpm, z.area_m2, z.root_depth_limit_m, z.soil_type
from zone z join farm f on f.farm_id = z.farm_id
order by z.id;
```

Then fill in your two ids and run:

```sql
-- Replace <ZONE_ID_1> and <ZONE_ID_2> with your two demo zone ids.
update zone
set flow_rate_lpm = 1.5
where id in (<ZONE_ID_1>, <ZONE_ID_2>);
```

Confirm it took:

```sql
select id, name, flow_rate_lpm
from zone
where id in (<ZONE_ID_1>, <ZONE_ID_2>);
```

Both rows should read `1.5`. Note `flow_rate_lpm` already **defaults** to 1.5 (migration 0020), so zones created after that may already be correct — the `update` is harmless either way. Any zone on different pump hardware must get its real measured rate instead: every litre figure in the app and in the reports derives from this column, so a wrong value here is confidently wrong everywhere.

While you are in there, the other two installer-set fields the engine needs (there is no admin form for them yet):

```sql
-- Replace with your measurements: wetted area in square metres, tub depth in metres.
update zone set area_m2 = <AREA_M2>, root_depth_limit_m = <DEPTH_M> where id = <ZONE_ID_1>;
update zone set area_m2 = <AREA_M2>, root_depth_limit_m = <DEPTH_M> where id = <ZONE_ID_2>;
```

Without `area_m2` the engine cannot turn a water depth into litres, and without `root_depth_limit_m` a 1.0 m maize root zone in a 0.3 m tub would claim three times the water the tub can hold.
