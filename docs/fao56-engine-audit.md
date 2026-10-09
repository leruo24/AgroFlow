# AgroFlow FAO-56 Engine Audit

Audit date: 2026-10-07  
Scope: read-only forensic review of the repository and the bundled FAO-56 PDF. No production code, configuration, crop/soil data, API, database, migration, firmware, or application code was changed.

## Executive verdict

**Overall verdict: PARTLY.**

The isolated FAO-56 mathematics is mostly implemented correctly: extraterrestrial radiation, Penman-Monteith, crop-coefficient interpolation, ETc, TAW, RAW, Ks, and the simplified daily root-zone balance reproduce the relevant FAO examples within rounding tolerance. Depth-to-volume and volume-to-runtime conversions are dimensionally correct.

The complete live recommendation path is not yet reliable enough to describe as a sound FAO-56 irrigation scheduler. Several integration rules can materially change or suppress a farmer's watering instruction:

1. A current soil reading is treated as the depletion at the beginning of the entire 31-day weather history and then up to 31 days of weather are replayed over it.
2. The rain override can say “skip” while the computed root zone remains far beyond RAW and the engine simultaneously calculates a large refill requirement.
3. The current firmware sends a 0–100 moisture percentage, while server calibration requires at least 409.5 units of wet/dry separation. That calibration cannot be completed with the current firmware's output range.
4. Open-Meteo's daily maximum 10 m wind is supplied to a formula requiring a daily mean wind, materially biasing ETo upward on gusty days.
5. Missing calendar days silently disappear from the water balance.

Plain-English answers:

- **Would advice today be based on a sound model?** The FAO core is sound, but the end-to-end decision is only partly sound because time alignment, rain override, sensor units, and weather input semantics can dominate the answer.
- **Directly FAO-56:** the standard ETo equations, Kc interpolation, ETc = Kc ETo, TAW, RAW, Ks, p adjustment for ETc, and the simplified form of Eq. 85.
- **AgroFlow rules:** crop-row selection, soil midpoint selection, sensor freshness and calibration tolerances, linear conversion of relative sensor percentage into depletion, soil-feel resets, the two-minute watering reset, confidence labels, and the rain-skip message rule.
- **Biggest scientific weakness:** one-point root-zone depletion is inferred linearly from a relative wet/dry sensor percentage that is not volumetric water content and may not represent the full root zone.
- **Biggest calculation/software risk:** the fresh sensor reading is temporally anchored before the historical replay. In a deterministic test this added 39.22 mm, 7,844 L, and 392 minutes to the current recommendation.
- **Input most affecting accuracy:** current depletion. In this implementation that is usually dominated by sensor calibration/placement and its time alignment; without a valid fresh sensor it is dominated by the assumed starting state and completeness of daily weather.
- **Does 0.2 m² scale to 1 ha?** Yes for the depth and volume equations. The same depth is preserved and litres scale linearly with area. Hardware hydraulics and whole-minute rounding do not automatically scale.
- **Does sensor percentage become true volumetric water content?** It is not labelled as volumetric water content, which is good, but it is mapped linearly to the entire TAW reservoir. Scientifically, that still assumes more than the sensor establishes.
- **Are pump runtimes dimensionally correct?** Yes, for litres and L/min. Rounding every positive runtime up to a whole minute can grossly over-apply water in a small-area/high-flow configuration.

The appropriate status is therefore not “FAO equations are wrong.” It is “correct core equations embedded in an unsafe state-estimation and decision integration.”

## Audit method and evidence

The audit traced the executed controller/database path, domain engine, older advisory path, rule book, weather ingestion, firmware payload, schema constraints, tests, and the local copy of FAO-56.

Primary implementation files:

- backend/AgroFlow.Domain/Agronomy/Fao56Engine.cs
- backend/AgroFlow.Domain/Agronomy/SoilWaterBalance.cs
- backend/AgroFlow.Domain/Agronomy/Fao56EngineReference.cs
- backend/AgroFlow.Domain/Agronomy/PenmanMonteithEto.cs
- backend/AgroFlow.Domain/Agronomy/ReferenceEvapotranspiration.cs
- backend/AgroFlow.Domain/Agronomy/DailyEtoResolver.cs
- backend/AgroFlow.Domain/Agronomy/OpenMeteoDailyParser.cs
- backend/AgroFlow.Domain/Agronomy/IrrigationAdvisor.cs
- backend/AgroFlow.Domain/Agronomy/ZoneInsightBuilder.cs
- backend/AgroFlow.Domain/Agronomy/RuleBook/WaterRules.cs
- backend/AgroFlow.Domain/Agronomy/RuleBook/CropRules.cs
- backend/AgroFlow.Domain/Agronomy/RuleBook/ConfidenceRules.cs
- backend/AgroFlow.Domain/Fao56EngineController.cs
- backend/AgroFlow.Domain/Fao56EngineXDB.cs
- backend/AgroFlow.Api/Services/WeatherCollectionService.cs
- backend/AgroFlow.Domain/Agronomy/fao56-crop-knowledge.json
- hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino
- supabase/migrations/0010_sensor_readings.sql
- supabase/migrations/0016_irrigation_events.sql
- supabase/migrations/0018_weather_daily.sql
- supabase/migrations/0020_agronomy.sql
- supabase/migrations/0027_ai_recommendation.sql
- docs/Fao56.pdf

Verification commands and outcomes:

- FAO verification tests: 48/48 passed.
- data-rule, ETo, and edge-case selection: 80/80 passed.
- full already-built test assembly: 1,228/1,228 passed in about 9 seconds.
- a detailed rerun of FAO Example 18 exposed an incorrect test input despite the pass; see “FAO worked examples.”

Passing tests prove the covered equations. They do not cover live wind aggregation, historical sensor anchoring, absent database dates, the firmware/server calibration-domain mismatch, threshold-unit consistency, or the rain-skip contradiction.

## Engine architecture

The actual executed water-balance path is:

    Fao56EngineController
      -> Fao56EngineXDB loads zone, farm, weather, readings, irrigation and soil-feel events
      -> Fao56Engine.Run
         -> resolve crop and soil
         -> select latest valid calibrated reading
         -> choose effective root depth and calculate TAW
         -> initialise Dr from the current sensor, otherwise 0
         -> replay each stored weather row through today
            -> DailyEtoResolver
               -> Penman-Monteith when the required fields exist
               -> Hargreaves when only valid temperature/latitude exist
            -> season stage and Kc
            -> ETc and adjusted p
            -> RAW and Ks from start-of-day Dr
            -> effective rain and measured irrigation
            -> bounded end-of-day Dr
            -> optional wet-sensor, soil-feel, or unmeasurable-watering reset
         -> project forecast days
         -> calculate refill depth, litres and whole minutes
      -> ZoneInsightBuilder
         -> decide water / no-water / skip-for-rain / setup messaging
      -> IrrigationAdvisor and report builders also contribute legacy narrative fields

The codebase has two parallel agronomy knowledge/calculation paths:

- The current water-balance engine uses Fao56EngineReference and Penman-Monteith where possible.
- Legacy narrative/schedule logic uses fao56-crop-knowledge.json and Hargreaves.

The API/reporting layer invokes both. The water-balance action overwrites the older action, but older summary/fact fields can still show a different crop schedule, Kc, ETo, or ETc. This is especially visible for maize and potato.

One latent implementation defect is ZoneEngineResult.Today: it selects the first observed row, not the row for Today. Repository search found no current production consumer, so this is low present risk but should not be relied on.

## Inputs

| Input | Actual source | Unit/domain | Required and fallback |
|---|---|---:|---|
| today / now | controller, fixed South Africa clock handling | DateOnly; UTC timestamp | required |
| farm latitude | farm row | decimal degrees, south negative | required for ETo; no ETo without it |
| farm elevation | not loaded into this engine | m | forced to 0 m |
| crop_type | zone free text, alias-resolved | category | unknown/missing crop stops balance setup |
| planting_date | zone | local date | optional; absent means “assumed peak” using max Kc |
| soil_type | zone | sandy/loam/clay | absent/unknown defaults to loam |
| root_depth_limit_m | zone | m | optional; crop root depth is capped by a positive value |
| area_m2 | zone | m² | optional for water depth; positive value required for litres |
| flow_rate_lpm | zone | L/min | optional; positive value required for runtime |
| moisture_threshold | zone | stored sensor-domain number | optional; also compared directly with normalised percent |
| desired_moisture | zone | stored sensor-domain number | presentation/setup input, not the refill-depth target |
| calibration_wet/dry | zone | stored reading units | both required for normalisation; separation must be at least 409.5 |
| soil reading | sensor_reading | current firmware: 0–100%; server accepts 0–4095 | most recent plausible value; “fresh” at at most 24 h |
| soil-feel observation | manual log | wet/moist/dry category | optional balance correction |
| irrigation runtime | irrigation_event | seconds | converted to minutes |
| configured flow | zone | L/min | runtime × flow yields litres |
| manually logged litres | irrigation_event | L | added directly |
| estimated_litres | irrigation_event | L | ignored except the separate manual-litres path |
| Tmin/Tmax | weather_daily/Open-Meteo; possible DHT fields | °C | weather preferred; DHT is intended fallback |
| RHmin/RHmax | Open-Meteo | % | enables stronger PM humidity calculation |
| RH mean | DHT or weather | % | fallback actual-vapour-pressure path |
| wind | Open-Meteo wind_speed_10m_max | m/s at 10 m | optional; default path can still estimate ETo |
| rain | Open-Meteo / weather_daily | mm/day | null behaves as zero |
| forecast flag | date relative to collection day | boolean | today and future can be forecasts |
| forecast probability | not collected | none | not used |

Important source-path limitation: Fao56EngineXDB starts daily inputs from weather_daily and left-joins DHT aggregates. A calendar day with DHT but no weather_daily row does not reach DailyEtoResolver. WeatherCollectionService also avoids persisting a row without usable weather temperatures. The unit-tested DHT fallback therefore works for a weather row whose temperature fields are absent, but cannot rescue a wholly absent weather day through the actual query.

## Equations

### Reference evapotranspiration

The preferred method is the FAO-56 daily grass-reference Penman-Monteith equation (Eq. 6):

    ETo = [0.408 Δ (Rn - G) + γ (900 / (T + 273)) u2 (es - ea)]
          / [Δ + γ (1 + 0.34 u2)]

Units are mm/day. Daily soil heat flux G is set to 0, which is the FAO daily-time-step convention.

| Symbol | Code value | Unit | Derivation/source |
|---|---|---:|---|
| T | mean of Tmin/Tmax | °C | weather preferred; DHT intended fallback |
| Δ | SaturationSlopeKpaPerC | kPa/°C | FAO Eq. 13 |
| Rn | NetRadiationMj | MJ/m²/day | Rns − Rnl, Eqs. 38–40 |
| G | 0 | MJ/m²/day | daily approximation |
| γ | PsychrometricConstantKpaPerC | kPa/°C | pressure Eqs. 8–9 |
| u2 | WindSpeedAt2M | m/s | Eq. 47 from configured 10 m height |
| es | MeanSaturationVapourPressureKpa | kPa | Eqs. 11–12 |
| ea | RHmax/RHmin or RHmean derivation | kPa | Eqs. 17 or 19 |
| Ra | ExtraterrestrialRadiationMj | MJ/m²/day | Eqs. 21, 23–25 |
| Rs | SolarRadiationFromTemperatureRangeMj | MJ/m²/day | Eq. 50, kRs = 0.16 |
| Rso | ClearSkySolarRadiationMj | MJ/m²/day | implemented as 0.75 Ra |

The Ra implementation converts latitude to radians, retains the southern-hemisphere sign, uses DateOnly.DayOfYear, and uses MJ/m²/day consistently. It accepts leap-day day 366 while the FAO approximation retains 365 in its annual-angle denominators; that is normal for this approximation and immaterial.

The resolver falls back to FAO-56 Hargreaves Eq. 52:

    ETo = 0.0023 (Tmean + 17.8) sqrt(Tmax - Tmin) (0.408 Ra)

Here 0.408 converts Ra from MJ/m²/day to equivalent mm/day. It is a recognised FAO estimate when radiation/humidity/wind data are unavailable, but less accurate than PM.

Method classification using the requested terms: **APPROXIMATE BUT VALID in isolation; QUESTIONABLE in the current live input path**. The equations are accurate, the radiation estimate is a recognised FAO approximation, and the 0 m elevation assumption is modest. The live wind series is not the variable FAO requires: wind_speed_10m_max is a daily maximum, while FAO requires the average daily wind. In a controlled case, substituting 6 m/s daily maximum for 2 m/s daily mean raised ETo from 6.198 to 7.663 mm/day, +23.6%.

The 0 m elevation simplification affects atmospheric pressure and Rso. At an illustrative 1,700 m, otherwise identical calculation, AgroFlow produced 6.198 versus 6.299 mm/day using elevation-aware FAO expressions: −0.101 mm/day or −1.6%. That is much smaller than the wind-semantic error.

### Crop coefficient and crop stage

The water-balance table is hard-coded in Fao56EngineReference:

Its cited sources are FAO-56 Table 11 (stage lengths, printed pp. 103–108), Table 12 (Kc, printed pp. 110–114), and Table 22 (root depth and p, printed pp. 163–165). Individual rows and any midpoint/management choice are recorded alongside each code entry.

| Key | Stage days ini/dev/mid/late | Kc ini/mid/end | Root m | p | FAO row/choice |
|---|---:|---:|---:|---:|---|
| spinach | 20/20/15/5 | 0.70/1.00/0.95 | 0.3 | 0.20 | Mediterranean spinach / small-vegetable initial |
| tomato | 30/40/45/30 | 0.60/1.15/0.80 | 0.7 | 0.40 | Mediterranean; end is midpoint of 0.70–0.90 |
| cucumber | 20/30/40/15 | 0.60/1.00/0.75 | 0.7 | 0.50 | fresh-market, arid row |
| potato | 25/30/45/30 | 0.50/1.15/0.75 | 0.4 | 0.35 | semi-arid row; selected alternative mid length |
| dry beans | 20/30/40/20 | 0.40/1.15/0.35 | 0.6 | 0.45 | continental row |
| maize | 25/40/45/30 | 0.30/1.20/0.35 | 1.0 | 0.55 | arid, field-dried grain |
| leafy_veg | 20/30/15/10 | 0.70/1.00/0.95 | 0.3 | 0.30 | actually lettuce; generic name is broader than evidence |
| citrus | 60/90/120/95 | 0.70/0.65/0.70 | 1.2 | 0.50 | mature 70% canopy, no ground cover |

Six keys are declared as offered: maize, potato, tomato, dry beans, spinach, cucumber. Leafy vegetables and citrus remain alias-resolvable. Other application lists/tests now expose all eight, so crop availability is not governed by one source.

For development and late season, SoilWaterBalance.Kc implements FAO Eq. 66:

    Kc(i) = Kc_prev + [(i - sum(previous stage lengths)) / L_stage]
                       (Kc_next - Kc_prev)

Boundaries are inclusive:

- day 1 through Lini: Kc_ini
- day Lini + 1 through Lini + Ldev: interpolated development
- next day through end of mid: Kc_mid
- next day through total season: interpolated late
- after total: Kc_end, with stage labelled complete

At the exact development endpoint, the fraction is 1 and Kc is Kc_mid. This matches Eq. 66. Day 0 or a future planting date is treated as establishing at Kc_ini rather than “not planted.” After harvest, annual crops remain at Kc_end indefinitely and can continue receiving irrigation advice.

When planting date is absent, the engine uses max(Kc_ini, Kc_mid, Kc_end) and labels the result assumed peak. This is an AgroFlow fallback. It is conservative against under-watering but can be strongly over-conservative early; maize uses 1.20 rather than 0.30, a 4× Kc ratio.

Kc values are not adjusted using FAO Eq. 62 for the actual wind, minimum humidity, and crop height. Kc_ini is also not adjusted for wetting frequency. Direct use of the tabulated values is a common planning approximation, not full site calibration.

The parallel JSON differs materially:

- maize JSON/legacy: 30/40/50/30 = 150 days and Kc_end 0.60; engine: 25/40/45/30 = 140 and Kc_end 0.35.
- potato JSON/legacy: 30/35/50/25 = 140 days; engine: 25/30/45/30 = 130.

Both are traceable FAO row choices, but two simultaneous answers are a product-integrity problem.

### ETc

Potential crop evapotranspiration is:

    ETc = Kc × ETo

Both inputs are daily, so ETc is mm/day. No premature rounding occurs. During balance replay, stress-adjusted ET is:

    ETc_adj = Ks × ETc

If an ETo row cannot be calculated, the first missing day is carried without ET; a second consecutive unresolved row stops that sequence. Entirely absent dates are not rows and therefore are neither carried nor counted.

### Soil, root depth, TAW, p, RAW, and Ks

Soil constants are midpoints of FAO-56 Table 19 ranges:

| Soil key | θFC fraction | θWP fraction | TAW per metre | p multiplier |
|---|---:|---:|---:|---:|
| sandy (FAO Sand) | 0.120 | 0.045 | 75 mm/m | 1.05 |
| loam | 0.250 | 0.120 | 130 mm/m | 1.00 |
| clay | 0.360 | 0.220 | 140 mm/m | 0.95 |

FAO supplies ranges, not these exact midpoints. FAO also says Table 22 p can generally be raised 5–10% for coarse sand and reduced 5–10% for fine clay; choosing exactly ±5% and multiplying before the ETc adjustment is AgroFlow's defensible data rule.

Effective root depth is:

    Zr = min(crop Table 22 low-end root depth, positive zone root-depth limit)

If the limit is absent or non-positive, the crop depth is used. Area is never used to infer a tub or root depth, so there is no “small area = tub” leak in this engine.

The serious limitation is time: the Table 22 value is a maximum effective root depth but is applied from day 1. FAO Example 38 explicitly grows Zr from 0.30 to 0.35 m over ten days. For tomato, AgroFlow can use 0.70 m on the first day even if the young effective root zone is, for example, 0.15 m. That makes the modelled reservoir about 4.7× deeper until roots develop.

FAO Eq. 82 is implemented exactly:

    TAW = 1000 (θFC - θWP) Zr

θ values are fractions, Zr is metres, and TAW is mm. For tomato/loam at 0.70 m:

    TAW = 1000 (0.25 - 0.12) 0.70 = 91.0 mm

The adjusted depletion fraction is:

    p_adj = clamp[p_table × soil_factor + 0.04 (5 - ETc), 0.10, 0.80]

The 0.04(5 − ETc) term is the FAO Table 22 footnote. The soil multiplier and numerical clamps are implementation rules.

FAO Eq. 83 is implemented exactly:

    RAW = p_adj × TAW

FAO Eq. 84 is implemented for Dr > RAW:

    Ks = (TAW - Dr) / [(1 - p_adj) TAW]

For Dr ≤ RAW, Ks = 1; output is bounded 0–1. ETc_adj is used in the actual balance, not just reporting.

Ks is computed from start-of-day depletion before that day's rain or irrigation is applied. FAO examples that assume early-day wetting account for that event before the day's stress calculation. AgroFlow's ordering can understate ET on a day when early rain/irrigation relieves stress.

## Water balance

The implemented daily step is:

    Dr_end = clamp(Dr_start - effective_rain - irrigation + ETc_adj, 0, TAW)

Compared with FAO Eq. 85:

| Eq. 85 term | AgroFlow handling | Consequence |
|---|---|---|
| prior Dr | carried from prior processed row | correct if rows/state are temporally complete |
| P | effective-rain rule | rainfall below 0.2 ETo ignored; all larger rain credited |
| RO | fixed 0 | no slope/intensity/runoff loss |
| I | event litres / zone area | correct net-depth dimensions; assumes delivered litres infiltrate |
| CR | fixed 0 | defensible where water table is sufficiently deep |
| ETc | Ks × Kc × ETo | correct single-coefficient stressed ET structure |
| DP | implicit through clamp at Dr = 0 | excess wetting is discarded as same-day drainage |

The simplification is valid for a prototype if clearly labelled and if inputs are complete. The current state initialisation makes it unsafe:

- If a fresh calibrated sensor exists now, current relative moisture is converted to Dr and assigned before the oldest retained weather date.
- The query uses today minus 30 days through today, which is 31 inclusive dates.
- The engine then replays up to 31 days of ET/rain/irrigation over what was already a current reading.
- Intermediate readings are ignored except for readings at the calibrated wet point, which can reset the day to field capacity.

Controlled result with the same current 50% tomato reading:

| Weather history supplied | Final Dr |
|---|---:|
| one deterministic dry day | 50.702 mm |
| 31 identical dry days | 89.923 mm |
| artificial difference | **39.221 mm** |

At 200 m² and 20 L/min, that artificial difference is 7,844 L and 392.2 exact minutes. This is a critical temporal bug, not a small approximation.

Missing calendar dates are also silent. In a three-day controlled sequence, all rows produced Dr = 59.400 mm; omitting yesterday's row produced 55.317 mm, an unreported 4.083 mm understatement. The database unique key prevents normal duplicate farm/date rows, but the engine itself would process duplicate supplied dates twice.

After watering:

- measured/logged litres are divided by area and subtracted exactly;
- over-watering cannot make Dr negative because Dr is clamped to zero;
- excess is implicitly deep drainage;
- an event of at least 120 seconds whose volume cannot be computed resets Dr to zero;
- a wet soil-feel record or a reading at the wet calibration point also resets Dr to zero;
- “dry” soil feel raises Dr to at least RAW; “moist” maps within 25–75% of RAW.

Those final three behaviours are AgroFlow correction rules, not FAO equations.

## Rain and forecast logic

Effective rain is:

    if P < 0.2 ETo: 0
    otherwise: P

FAO states that small rain below about 0.2 ETo can normally be ignored in a single-Kc water balance. Crediting every larger millimetre assumes no runoff and treats any excess through the Dr = 0 clamp as drainage. This is a defensible first model on level, infiltrative ground, but can over-credit intense rain, sloped/clayey sites, and forecast rain.

Today's Open-Meteo row is marked forecast when its date is today or later. The balance nevertheless treats date ≤ today as the observed balance and can credit today's forecast rain fully.

The farmer-facing override is more problematic. If irrigation is already due but today's rain is at least today's ETc, ZoneInsightBuilder emits skip_rain rather than water_now. It compares rain with the daily loss, not with accumulated root-zone depletion or the recommended refill depth.

Controlled case:

- rain = 7.2 mm
- potential ETc = 7.127 mm
- end Dr = 43.502 mm
- RAW = 28.657 mm
- calculated refill = 43.5 mm = 8,700 L = 436 whole minutes
- displayed action: **skip for rain**

The forecast probability is neither requested nor used. This is a red decision bug: daily rain can offset ET while leaving a large pre-existing deficit.

## Sensor integration

The repository's current firmware identifies the probe as a **resistive YL-69**, not a capacitive probe. It defines ADC_DRY = 4095 and ADC_WET = 1550, converts the ADC reading into a clamped 0–100 percentage, and sends that percentage. It also sends DHT11 temperature and humidity. The audit cannot substantiate the prompt's “capacitive” description against current code.

Server normalisation is:

    relative moisture % =
      clamp[(reading - dry) / (wet - dry) × 100, 0, 100]

This correctly handles either calibration direction and clamps values. NaN/infinite and implausible readings are rejected. However:

1. The server calls the stored value a raw reading and permits 0–4095.
2. Calibration acceptance requires wet/dry separation ≥ 0.10 × 4095 = 409.5.
3. Current firmware can only send values 0–100.
4. Therefore current firmware cannot produce a valid wet/dry calibration pair through this validation.
5. Historic raw-ADC calibrations such as 1200/3000 are incompatible with new 0–100 payloads; those readings fall outside the plausibility band and are excluded.

For a fresh valid reading, depletion is inferred as:

    Dr_sensor = (1 - relative_moisture_percent / 100) × TAW

This does not literally label sensor percentage as volumetric θ. Nevertheless, it assumes a linear equivalence between one relative sensor reading and the fraction of the entire root-zone available-water store. That inference is not provided by FAO-56 and is not scientifically established by two wet/dry endpoints. It is especially weak for stratified field soil, shallow sensor placement, salinity, texture differences, and a growing root zone.

The sensor also triggers irrigation independently when a fresh normalised percentage is at or below the stored threshold. Threshold units are inconsistent:

- reset/recommendation code stores a threshold in sensor units as wet − p(wet − dry);
- decision code compares relative percentage directly to that stored value.

Only a 0/100 calibration makes those domains coincide. With wet = 80, dry = 20, and p = 0.40, the stored threshold is 56 sensor units while the equivalent relative threshold is 60%; the trigger shifts by 4 percentage points.

The 24-hour freshness boundary, wet-point tolerance, dry/wet plausibility tolerance, and confidence contribution are product rules. They are not FAO-56.

The DHT11 path has plausibility bounds but no laboratory calibration model. Weather is preferred whenever present. Even a perfectly implemented ETo equation cannot make a DHT11 mounted in a tub or enclosure equivalent to standard reference-weather observations. Model accuracy and sensor accuracy must be reported separately.

## Irrigation decision

The water-balance condition is:

    due_for_water = BalanceRan AND Dr >= RAW

Equality waters: Dr = RAW is due. ZoneInsightBuilder then also allows:

    due_for_water = due_for_water OR
                    (fresh calibrated relative moisture <= configured threshold)

This second route can recommend water even when no water balance ran. Missing/stale readings and missing calibration disable only the sensor branch. Missing planting date does not disable the balance; peak Kc is assumed. A missing/unknown crop does disable the balance because no crop table can be selected.

If due:

- today's rain ≥ today's potential ETc produces skip_rain;
- otherwise action is water_now.

If not due, the output is monitor/no-water depending on surrounding report logic. The forecast projection is informative rather than a probability model.

The refill target is field capacity, not merely RAW:

    required depth = max(0, current Dr)

Thus RAW is the timing threshold and Dr is the net refill depth. That is consistent with FAO guidance that net irrigation should not exceed current depletion.

Confidence is communication logic, not an agronomic coefficient:

| Confidence | Actual rule |
|---|---|
| High | crop resolved, balance ran, no missing setup fields, and a fresh valid calibrated reading |
| Medium | crop resolved, balance ran, and at most two setup inputs missing |
| Low | no crop, no balance, or more than two setup inputs missing |

A “High” label does not validate sensor representativeness, weather aggregation, crop-row applicability, or the temporal anchor. Conversely, a low-confidence calculation can still be dimensionally correct under its disclosed assumptions.

## Volume/runtime calculations

For positive area:

    litres = required depth mm × area m²

This correctly uses 1 mm over 1 m² = 1 L. The requested check is exact:

    12 mm × 200 m² = 2,400 L

For a positive pump flow in L/min:

    exact minutes = litres / flow
    reported minutes = ceiling(exact minutes)

Therefore:

    2,400 L / 20 L/min = 120 minutes

There is no L/hour confusion. Irrigation-event runtime in seconds is divided by 60 before multiplying by L/min. Missing, zero, or negative area suppresses litres; missing, zero, or negative flow suppresses runtime. There is no maximum runtime. Every positive exact runtime becomes at least one whole minute.

Whole-minute ceiling is harmless for the demo's roughly matched pump and area, but not generally scale-safe. For 10 mm on 0.2 m² at 500 L/min:

- required volume = 2 L
- exact runtime = 0.004 min = 0.24 s
- reported runtime = 1 min
- following that literally applies 500 L, **250×** the requested volume.

The depth/volume formula scales; this actuator representation does not.

### Area-independence range

For a fixed 10 mm requirement:

| Area | Volume | Depth remains |
|---:|---:|---:|
| 0.2 m² | 2 L | 10 mm |
| 10 m² | 100 L | 10 mm |
| 200 m² | 2,000 L | 10 mm |
| 1 ha = 10,000 m² | 100,000 L | 10 mm |
| 10 ha = 100,000 m² | 1,000,000 L | 10 mm |

For 10,000 L:

| Flow | Exact time | Whole-minute result |
|---:|---:|---:|
| 0.5 L/min | 20,000 min | 20,000 min |
| 1.5 L/min | 6,666.67 min | 6,667 min |
| 20 L/min | 500 min | 500 min |
| 500 L/min | 20 min | 20 min |

These large durations are not arithmetic overflow; they reveal a pump/area/configuration mismatch. Within the requested ranges, double volume and 32-bit integer minutes remain safe.

## Unit audit

| Quantity/conversion | Implementation | Verdict |
|---|---|---|
| temperature | °C throughout PM/Hargreaves; +273 in aerodynamic term | correct |
| ETo, ETc | mm/day | correct |
| Dr, rain, irrigation, TAW, RAW | mm water depth | correct |
| θFC, θWP | m³/m³ fractions, not percentages | correct |
| root depth | metres | correct |
| centimetres | no runtime conversion path found | no hidden cm/m mix |
| area | m² | correct |
| hectare | not internally converted; 1 ha must enter as 10,000 m² | conceptually correct, UI/data responsibility |
| depth × area | mm × m² = L | correct |
| flow | L/min | correct |
| event runtime | seconds / 60 × L/min | correct |
| radiation | MJ/m²/day | correct |
| Ra for Hargreaves | ×0.408 to equivalent mm/day | correct |
| latitude | degrees stored, converted to radians before trig | correct |
| southern hemisphere | negative latitude retained | correct |
| day of year | 1–366 from date; FAO annual approximation uses 365 | acceptable |
| RH | percent divided by 100 in vapour equations | correct |
| sensor percentage | 0–100 before division by 100 | arithmetic correct, scientific mapping weak |
| ADC | firmware converts counts to %, server still models 0–4095 | **wrong contract** |
| wind height | 10 m converted to 2 m with Eq. 47 | correct conversion |
| wind statistic | daily maximum used where daily mean is required | **wrong input meaning** |
| elevation | metres in helper, but live path supplies 0 | approximation |

There was no evidence of accidental degrees-in-trigonometry, incorrect southern-season sign, mm-to-litres error, L/hour error, or area being applied to depth.

## Worked examples

### Deterministic tomato decision, manual versus AgroFlow

Fixed inputs:

- date 2026-01-15, latitude −33.9249°, elevation as implemented 0 m
- Tmin 15°C, Tmax 30°C, RHmin 30%, RHmax 80%
- wind 2.0 m/s already at 2 m; rain 0
- tomato planted 89 days earlier, so season day 90 and Kc_mid = 1.15
- loam, no root-depth limit, area 200 m², flow 20 L/min
- wet/dry calibration 100/0; current fresh reading 50%

| Step | Manual calculation | AgroFlow | Difference |
|---|---:|---:|---:|
| day J | 15 | 15 | 0 |
| Ra | 43.333045 MJ/m²/day | 43.333045 | rounding only |
| Rs | 26.852506 MJ/m²/day | 26.852506 | rounding only |
| Rso | 32.499784 MJ/m²/day | 32.499784 | rounding only |
| es | 2.974206 kPa | 2.974206 | rounding only |
| ea | 1.318598 kPa | 1.318598 | rounding only |
| Rns | 20.676430 MJ/m²/day | 20.676430 | rounding only |
| Rnl | 5.159820 MJ/m²/day | 5.159820 | rounding only |
| Rn | 15.516609 MJ/m²/day | 15.516609 | rounding only |
| Δ | 0.165483 kPa/°C | 0.165483 | rounding only |
| γ | 0.0673645 kPa/°C | 0.0673645 | rounding only |
| ETo | 6.197625 mm/day | 6.197625 | < 10⁻⁶ |
| Kc | 1.15 | 1.15 | 0 |
| potential ETc | 7.127269 mm/day | 7.127269 | < 10⁻⁶ |
| root depth | 0.70 m | 0.70 m | 0 |
| TAW | 1000(0.25−0.12)(0.70) = 91.0 mm | 91.0 | 0 |
| sensor initial Dr | (1−0.50)(91) = 45.5 mm | 45.5 | 0 |
| p | 0.40 + .04(5−7.127269) = 0.314909 | 0.314909 | < 10⁻⁶ |
| RAW | 0.314909(91) = 28.656742 mm | 28.656742 | < 10⁻⁶ |
| Ks | (91−45.5)/[(1−.314909)91] = 0.729830 | 0.729830 | < 10⁻⁶ |
| ETc_adj | 0.729830(7.127269) = 5.201697 mm | 5.201697 | < 10⁻⁶ |
| end Dr | 45.5 + 5.201697 = 50.701697 mm | 50.701697 | < 10⁻⁶ |
| decision | Dr ≥ RAW: water | water | 0 |
| required depth | 50.701697 mm | 50.7 mm displayed | presentation rounding |
| litres | 50.701697 × 200 = 10,140.339 L | 10,140.339 L | < 0.001 L |
| runtime | ceil(10,140.339 / 20) = 508 min | 508 min | 0 |

The engine and manual implementation agree. This proves code consistency for the selected equations. It does **not** prove the real field needed 50.7 mm: 45.5 mm of the answer came from the unvalidated linear sensor-to-root-zone mapping, the crop used a mature 0.70 m root depth, and site elevation was omitted.

### FAO-56 examples from docs/Fao56.pdf

The PDF page numbers below are the document's printed pages.

#### A. Kc — Example 28, printed pp. 132–133

Dry beans: stages 25/25/30/20 and Kc 0.15/1.19/0.35.

| Day | FAO printed | AgroFlow equation | Difference | Error |
|---:|---:|---:|---:|---:|
| 20 | 0.15 | 0.150 | 0.000 | 0% |
| 40 | 0.77 | 0.774 | +0.004 | +0.52% versus rounded print |
| 70 | 1.19 | 1.190 | 0.000 | 0% |
| 95 | 0.56 | 0.560 | 0.000 | 0% |

The 0.774 value is the unrounded Eq. 66 result; FAO prints two decimals. This is compliant.

#### B. TAW/RAW — Examples 36 and 37, printed pp. 166–168

- Example 36 tomato/silt: expected TAW 136 mm and printed RAW 54 mm. AgroFlow gives 136.0 and 54.4 mm; the 0.4 mm (0.74%) difference is FAO's whole-mm presentation rounding.
- Example 37 tomato/silty soil: expected TAW 160 mm and RAW 64 mm. AgroFlow gives 160.0 and 64.0 exactly.

#### C. Ks and depletion — Example 37, printed pp. 168–169

With Dr = 55 mm initially, ETo = 5 mm/day, Kc = 1.2, TAW = 160, RAW = 64, no rain/irrigation:

- at Dr = 67, FAO prints Ks 0.97; code gives 0.96875;
- at Dr = 72.8, FAO prints 0.91; code gives 0.90833;
- after ten days, FAO prints Dr 104.5 mm; code gives 104.505 mm.

Maximum displayed difference is 0.005 mm after ten days (0.005%). This is compliant.

#### D. ETo — Example 18, printed pp. 72–73

FAO's input is 10 km/h = 2.78 m/s measured at 10 m. Eq. 47 converts it to u2 = 2.079 m/s. With the book's published radiation values, Eq. 6 gives 3.879 mm/day, matching FAO's 3.88 (reported as 3.9).

The repository test instead declares u2 = 2.78 and passes that value directly as 2 m wind. Its detailed result is:

| Quantity | FAO expected | Test/code actual |
|---|---:|---:|
| Ra | 41.090 | 41.088 |
| Rso | 30.900 | 30.816 |
| Rn | 13.280 | 13.267 |
| ETo | 3.900 | 3.972 |

3.972 is +0.093 mm/day (+2.39%) against the unrounded 3.879 target. It passes only because tolerance is ±0.12. The PM implementation is correct; the test's wind variable/comment is wrong. Its Rso difference also reflects live code omitting the elevation term (0.75 + 2×10⁻⁵z), even though the test supplies 100 m to pressure.

The actual live resolver estimates Rs from temperature range (Eq. 50) because AgroFlow does not receive sunshine duration or measured radiation. That is a different valid FAO method and must not be claimed to reproduce Example 18's measured-sunshine radiation path.

## Range and sanity tests

- ETo methods reject/avoid physically invalid temperature ordering and clamp negative results. Hargreaves yields zero for a zero diurnal range; PM plausibility filters exclude extreme input ranges.
- Kc values in the selected table remain positive and within the tabulated crop choices (0.30–1.20, except the tested generic Eq. 66 example at 0.15).
- relative moisture is clamped 0–100 after calibration; readings too far outside the calibrated range are excluded.
- Dr is clamped 0–TAW after every normal balance step, so normal execution does not produce negative water, NaN, or infinity.
- ETo and water depth do not depend on zone area.
- 0.2 m² through 10 ha scales linearly without numeric overflow.
- 0.5 through 500 L/min is dimensionally handled; implausible durations are surfaced rather than capped.
- Irrigation-event litres equal runtime seconds / 60 × configured L/min plus manual litres. Division by area then yields mm.
- There is no maximum practical irrigation depth, volume, or runtime warning.

The requested “5 mm/day for three days” accumulation is exact while unstressed: starting at Dr = 0, no rain/irrigation, and ETc_adj = 5 gives 5, 10, then 15 mm. Once Dr exceeds RAW, Ks deliberately reduces further ETc, so accumulation becomes less than potential ETc as FAO intends.

## Edge cases

| Case | Actual behaviour | Assessment |
|---|---|---|
| no planting date | maximum of crop Kc values; assumed peak | approximate, conservative for water |
| future planting date | establishing/Kc_ini and can recommend water | unsafe |
| beyond annual-crop season | Kc_end forever; can recommend water | unsafe |
| no crop | no balance; setup messaging | handled correctly |
| unknown crop | no guessing; no balance | handled correctly |
| no soil | loam default | approximate |
| no root limit | crop Table 22 low-end maximum | approximate |
| zero/negative root limit | ignored; crop depth used | safe fallback in domain; DB should prevent invalid configured values |
| no/zero area | depth retained; litres/runtime null | handled correctly |
| no/zero pump flow | litres retained; runtime null | handled correctly |
| no rainfall value | zero | handled correctly |
| huge rainfall | Dr clamps to 0; excess implicit DP; RO = 0 | valid simplification with site limitation |
| no weather rows | no balance; fresh sensor can still independently say water | questionable |
| one invalid weather day | carry state; second consecutive invalid row stops sequence | explicit approximation |
| absent calendar date | day silently omitted with no warning | unsafe |
| duplicate date | processed twice if supplied; DB uniqueness normally prevents it | engine unsafe, storage mitigates |
| stale sensor | not used for Dr or direct trigger | handled correctly |
| no calibration | weather balance still runs; no sensor percentage | handled correctly |
| sensor exactly wet | 100%, Dr = 0; wet-point reset | handled correctly under mapping assumption |
| sensor exactly dry | 0%, Dr = TAW, Ks = 0 and water due | handled correctly under mapping assumption |
| sensor just outside calibration | clamped to 0/100 if within tolerance | approximate |
| sensor far outside calibration | excluded | handled correctly |
| Dr = RAW | water due; Ks = 1 | correct |
| Dr = TAW | Ks = 0 | correct |
| Dr > TAW supplied to helpers | Ks clamps to 0; normal next step clamps Dr | handled |
| Dr < 0 supplied to helpers | next step and required litres clamp at 0 | handled |
| missing latitude | ETo unavailable | handled, but gaps can hide |
| South Africa timezone | fixed UTC+2/SAST aggregation | correct for SA; no daylight saving |

## Accuracy findings

| Subsystem | Class | Reason |
|---|---|---|
| ETo | **ORANGE** | correct PM/Hargreaves equations; max-vs-mean wind error and 0 m elevation |
| Kc | **ORANGE** | FAO rows, but parallel tables diverge and no local climate adjustment |
| crop stage | **ORANGE** | Eq. 66 correct; future/past-season behaviour can advise irrigation |
| ETc | **GREEN** | Kc × ETo and Ks use are correct; inherits upstream uncertainty |
| soil properties | **YELLOW** | documented Table 19 midpoint selection |
| root depth | **ORANGE** | correct cap form; maximum mature depth applied from day 1 |
| TAW | **GREEN** | Eq. 82 and units correct; inherits root/soil assumptions |
| p | **YELLOW** | FAO ET adjustment plus defensible ±5% AgroFlow selection |
| RAW | **GREEN** | Eq. 83 correct; inherits p/TAW assumptions |
| Ks | **GREEN** | Eq. 84, bounds, and ET use correct; same-day wetting order caveat |
| rainfall | **ORANGE** | FAO trace threshold; full credit, no RO, forecast treated as water |
| depletion balance | **RED** | Eq. 85 core correct, but current sensor is replayed as historical and dates can vanish |
| sensor integration | **RED** | impossible current calibration contract; linear whole-root inference; time misalignment |
| irrigation trigger | **RED** | threshold-unit mismatch and contradictory rain override |
| required mm | **GREEN** | Dr refill target is dimensionally and conceptually correct |
| litres | **GREEN** | 1 mm·m² = 1 L correctly applied |
| pump runtime | **ORANGE** | L/L·min⁻¹ correct; whole-minute ceiling can massively over-deliver |
| forecast-rain decision | **RED** | no probability; rain ≥ ETc can suppress watering despite Dr ≫ RAW |

“Green” here means the subsystem's equation is directly consistent with FAO-56, not that its upstream inputs are accurate.

## FAO source mapping and AgroFlow-specific assumptions

| Rule | FAO-56? | AgroFlow assumption/product rule | Source | Risk |
|---|---|---|---|---|
| daily PM ETo | yes | none in equation | Eq. 6 | low |
| Hargreaves fallback | yes | choose when PM inputs absent | Eq. 52 | medium |
| Ra astronomy | yes | leap day accepted with 365 approximation | Eqs. 21, 23–25 | low |
| Rs from temperature range | yes | interior kRs 0.16 everywhere | Eq. 50 | medium |
| use daily maximum wind | no | ingestion-field choice | OpenMeteoDailyParser | high |
| elevation = 0 | no | unavailable-location fallback | DailyEtoResolver/live input | low–medium |
| Kc stage interpolation | yes | inclusive implementation | Eq. 66 | low |
| select particular Table 11 rows | values yes | row/management choice is AgroFlow's | Tables 11/12 | medium |
| no Kc climate adjustment | simplified | use tabulated Kc directly | Eq. 62 omitted | medium |
| peak Kc with missing planting date | no | conservative fallback | Fao56Engine | medium |
| mature root depth from day 1 | no | fixed crop depth | Table 22 used as constant | high |
| TAW | yes | midpoint soil values | Eq. 82/Table 19 | low–medium |
| RAW | yes | none beyond p selection | Eq. 83 | low |
| p + 0.04(5−ETc) | yes | clamp 0.1–0.8 | Table 22 footnote | low |
| sand/clay p factor | direction/range yes | exact ±5% choice/multiplication | printed p. 167 | low–medium |
| Ks | yes | none material | Eq. 84 | low |
| daily balance | yes, simplified | RO = CR = 0; DP implicit | Eq. 85–88 | medium |
| ignore rain < 0.2 ETo | yes | strict implementation threshold | printed p. 170 | low |
| credit all larger rain | not required by FAO | zero runoff assumption | balance rule | medium–high |
| fresh sensor ≤24 h | no | freshness policy | engine/rule book | medium |
| relative sensor % maps linearly to TAW | no | state-estimation rule | Fao56Engine | critical |
| wet sensor resets Dr = 0 | no | correction rule | Fao56Engine | high |
| ≥120 s unmeasurable watering resets Dr = 0 | no | correction rule | Fao56Engine | high |
| soil-feel category modifies Dr | no | correction heuristic | Fao56Engine | medium |
| Dr ≥ RAW waters | yes | equality explicitly waters | FAO scheduling concept | low |
| rain ≥ today's ETc says skip | no | message/action override | ZoneInsightBuilder | critical |
| refill Dr to field capacity | yes | net requirement without efficiency factor | printed p. 171 | medium |
| confidence labels | no | communication policy | ConfidenceRules | low |
| round runtime up to whole minute | no | actuator/presentation rule | Fao56Engine | high in mismatched configurations |

## Risk-ranked bugs

Severity measures likely change to a real recommendation, not code neatness.

### Critical

1. **Current sensor reading is placed before historical replay.** A controlled 31-day dry-history case added 39.221 mm versus a one-day calculation. At 200 m²/20 L/min this is 7,844 L and 392.2 minutes. It can turn a current state observation into extensive apparent future depletion.
2. **Rain skip contradicts the water deficit.** A tested 7.2 mm rain day emitted skip while Dr remained 43.502 mm versus RAW 28.657 mm and the same engine calculated 8,700 L / 436 min required.

### High

3. **Firmware/server calibration domains are incompatible.** Required separation is 409.5, but current payload spans only 0–100. Sensor calibration cannot pass as implemented.
4. **Missing daily rows are invisible.** Omitting one deterministic day reduced calculated Dr by 4.083 mm with BalanceRan still true and no gap warning. Repeated gaps accumulate.
5. **Daily maximum wind is used instead of daily mean.** The controlled case raised ETo 23.6% (6.198 → 7.663 mm/day).
6. **Mature root depth is used from planting.** A 0.70 m tomato reservoir can be 4.7× a 0.15 m young effective root zone, materially changing TAW, RAW, and refill volume.
7. **Sensor threshold units can differ.** Example calibration 80/20 with p = 0.40 stores 56 but corresponds to 60% relative moisture, a four-point trigger error.
8. **Whole-minute runtime can over-deliver severely.** The 0.2 m²/500 L/min example reports 1 minute for a 0.24-second requirement, 250× volume if followed literally.

### Medium

9. **Two crop/ETo paths can disagree.** Maize can be 140 days/Kc_end 0.35 in the engine versus 150/0.60 in narrative JSON.
10. **Future and completed seasons still calculate water.** This can create advice for an unplanted or harvested annual crop.
11. **Current-day forecast rain is credited as observed with no probability.**
12. **DHT fallback is blocked by the query when no weather row exists.**
13. **Ks is calculated before same-day early wetting.** This can understate same-day ET after rain/irrigation relieves stress.
14. **No irrigation efficiency/distribution-uniformity factor.** Calculated litres are net root-zone water, not necessarily gross applied water for a field system.

### Low

15. **Live elevation is fixed at zero.** The illustrative 1,700 m error was −1.6%, smaller than other uncertainties.
16. **ZoneEngineResult.Today selects the first observed row.** No current production consumer was found.
17. **FAO ETo test uses the wrong wind height.** This masks a test defect but does not show a defect in Eq. 47 itself.

## Valid simplifications

- Daily G = 0 in Penman-Monteith.
- Hargreaves Eq. 52 as a disclosed fallback.
- Eq. 50 temperature-range solar-radiation estimate where measured radiation/sunshine is unavailable.
- Table 19 midpoints as documented representative soil classes.
- Table 22 low-end maximum rooting depth for irrigation planning, once stage growth/actual soil-depth limits are handled.
- p adjustment with ETc and a documented 5% sand/clay choice.
- CR = 0 where groundwater is sufficiently deep.
- implicit same-day deep drainage by clamping Dr at zero.
- ignoring rainfall below about 0.2 ETo.
- zero runoff as an explicitly labelled prototype assumption for suitable sites.
- refilling net depletion Dr to field capacity.
- displaying approximate rather than spurious decimal precision.

## Missing science / evidence

The repository does not establish:

- sensor model response, installation depth, soil-specific calibration, salinity/temperature sensitivity, spatial representativeness, or conversion to volumetric θ;
- pump calibration under pressure, emitter distribution uniformity, application efficiency, leakage, or effective wetted area;
- actual farm elevation;
- measured solar radiation/sunshine;
- daily mean wind in the weather payload;
- forecast probability or forecast-error policy;
- runoff/infiltration based on slope, texture, rainfall intensity, or antecedent conditions;
- water-table depth/capillary rise;
- stage-varying root growth;
- climate-adjusted Kc or local cultivar/management validation;
- crop/soil-specific field validation against gravimetric or reliable profile moisture observations.

Numerical output should therefore say “about.” A result such as 50.701697 mm or 508 minutes has computational precision, not field accuracy. Sensible presentation would preserve calculations internally but round and disclose the limiting assumptions externally.

## Recommendations

No fixes were made. Recommended order for a later, explicitly authorised implementation phase:

1. **Fix time semantics first:** anchor each sensor observation on its timestamp; initialise history before the observation or replay forward only from it. Detect/fill or explicitly invalidate missing calendar dates.
2. **Remove the contradictory rain override:** base skip/postpone on projected Dr after effective forecast rain relative to RAW and target refill; clearly separate forecast from observed rain and incorporate an explicit forecast-confidence policy if data becomes available.
3. **Unify the moisture data contract:** choose raw ADC or firmware percentage end-to-end, migrate/identify old calibrations safely, and compare thresholds in one normalised domain.
4. **Stop presenting relative probe percentage as a precise root-zone depletion measurement:** treat it as a bounded correction/independent signal until soil-specific volumetric/profile validation exists.
5. **Request/use daily mean wind and farm elevation.** Add an integration test over the exact Open-Meteo field mapping.
6. **Model stage-varying effective root depth** or require an actual available/effective depth, especially early season and in containers/raised beds.
7. **Make future planting and completed annual seasons non-irrigating states** unless an explicit perennial/cycle rule applies.
8. **Represent runtime with seconds or fractional minutes and validate pump/area combinations.**
9. **Consolidate crop knowledge and advisory paths** so one request cannot describe two different seasons/Kc values.
10. **Add gross-application configuration later** (efficiency, distribution uniformity, wetted fraction) for field-scale operational recommendations.

Optional refinements after the above:

- Eq. 62 Kc climate adjustment and Kc_ini wetting-frequency treatment;
- site runoff/infiltration and shallow-groundwater capillary rise;
- measured radiation or sunshine data;
- finer soil classes or measured θFC/θWP;
- local cultivar and field calibration;
- surface the low-risk Today-property correction;
- improve the FAO Example 18 test to use Eq. 47 and altitude-aware Rso.

The priority is not to make the formulas more elaborate. It is to make the current observation, historical balance, weather semantics, and user-facing action describe the same physical day and the same units.
