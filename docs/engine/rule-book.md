# AgroFlow rule book

Every piece of advice AgroFlow gives comes from a small, named rule in
`backend/AgroFlow.Domain/IrrigationControl/Agronomy/RuleBook/`. This page is **generated from
those rules** by `RuleBookDocument.cs`: every outcome and every farmer sentence
below is what the code returns for those inputs. A test fails if this page and
the code disagree. Regenerate with:

```
AGROFLOW_WRITE_RULEBOOK=1 dotnet test --filter RuleBookDocument
```

**Sources.** "FAO-56" is Allen et al. (1998), *Crop evapotranspiration*, FAO
Irrigation and Drainage Paper 56, `docs/Fao56.pdf`; page numbers are the book's
printed pages. A **DATA RULE** is our own judgement from how the kit and farms
behave, not FAO-56 - each one says why.

**One table.** Every rule reads crop and soil values from `Fao56EngineReference.cs`; none
is re-typed in a rule. An older extract, `fao56-crop-knowledge.json`, still feeds the
FAO-56 notes in the schedule report. For maize and potato it uses a different Table 11
row (a different planting season) - both are published FAO-56 values, and the reason is
written at the top of `Fao56EngineReference.cs`. No advice on this page comes from it.

**Worked example** used in every table: maize in a 1.5 m² plot with a 0.3 m usable root zone, a 1.5 L/min drip line, crop water use 5 mm/day.

## The order the rules run in

`ZoneInsightBuilder` calls the rules in this order; the first act-now message wins.

1. `ConfidenceRules.NextStep` → setup step (one, not a list)
2. `KitRules.IsOffline` → zone offline
3. `KitRules.IsStuck` → sensor stuck
4. `KitRules.PumpRanNoChange` → watering failed
5. `KitRules.IsDhtOffline` → temperature sensor offline
6. `WaterRules.RecommendedThreshold` + `ThresholdTooDry` → threshold unsafe
7-8. `Fao56Engine` `PrimaryAction` (its rolling outlook: `WaterRules.ShouldWaterToday` on the projected dryness with and without the expected rain) → postpone for rain, else water now (reduced or full)
9. a day with no weather → data gap
10. `WaterRules.WaterSoon` → water soon
11. `WaterRules.HotDaysAhead` → hot days
12. `CropRules` (assumed stage, `SeasonComplete`, `SensitiveStage`, `NextStageChange`, `HarvestSoon`) → growth messages
13. `WaterRules.WasStressed` → stress days
14. `VerdictRules.For` = Too much → overwatering
15. `KitRules.IsDrifting` → sensor drift

## 1. Should I water today? (soil × stage × dryness × rain)

Rules: `WaterRules.ShouldWaterToday` (FAO-56 p. 171: water "before or at the moment" the
readily available water is used up, Dr ≥ RAW), applied by `Fao56Engine` to the projected dryness
with and without the expected rain: postpone only when the rain keeps the soil below RAW (Eq. 85, p. 170).
RAW comes from the soil (Table 19, p. 144), the crop's p (Table 22, pp. 163-165), the soil
adjustment (p. 167) and today's water use (p. 162).

| Soil | Crop stage | Dryness vs RAW | Rain forecast | → Action | Farmer sentence | Source |
|---|---|---|---|---|---|---|
| any (loam shown) | any | below RAW (20.5 of 21.5 mm) | none | Water today | "Water North Plot today: about 25.5 mm (~38 L), run about 25.5 min." | p. 171; p. 170 |
| any (loam shown) | any | at RAW (21.5 mm) | none | Water today | "Water North Plot today: about 26.5 mm (~40 L), run about 26.5 min." | p. 171; p. 170 |
| any (loam shown) | any | at RAW (21.5 mm) | 4.9 mm < need | Water today | "Rain helps, but water North Plot today: about 21.6 mm (~32 L), run about 21.6 min." | p. 171; p. 170 |
| any (loam shown) | any | at RAW (21.5 mm) | 5 mm = need | Water today | "Rain helps, but water North Plot today: about 21.5 mm (~32 L), run about 21.5 min." | p. 171; p. 170 |
| any (loam shown) | any | at RAW (21.5 mm) | 12 mm > need | Postpone for rain | "Postpone watering North Plot: expected rain should move the field below its watering point." | p. 171; p. 170 |
| Sandy | any | at RAW (13 mm) | none | Water today | "Water North Plot today: about 18 mm (~27 L), run about 18 min." | p. 171; p. 170 |
| Clay | any | at RAW (21.9 mm) | none | Water today | "Water North Plot today: about 26.9 mm (~40 L), run about 26.9 min." | p. 171; p. 170 |

**What the soil changes.** Sand holds less water than loam and clay more (Table 19), so in
sand RAW is reached sooner and each watering is smaller - shorter, more often. That is not a
separate rule: it falls out of the numbers above. Whether clay should be watered *slowly*
(infiltration rate) is not in FAO-56 and is listed under "Needs another source".

**Stage.** Stage changes the crop factor (Table 12) and so the daily need, not the rule. At
peak growth a shortage costs the most yield (p. 176) - see the crop table.

## 2. Soil rules (`SoilRules`)

`WaterHoldingFor` - FAO-56 Table 19 (p. 144), midpoints. No soil type → loam, labelled
"assumed" (DATA RULE: loam sits between sand and clay, so the error is bounded both ways).
`DepletionFactorAdjust` - p. 167: p "can be reduced by 5-10%" for clay and "increased by
5-10%" for sand; the cautious 5% is used. `TotalAvailableWaterMm` - Eq. 82, p. 162.

| Soil | θFC | θWP | p × | Water held in 0.3 m (TAW) | Source |
|---|---|---|---|---|---|
| Sandy | 0.12 | 0.045 | ×1.05 | 22.5 mm | Table 19 'Sand', p. 144; p. 167 |
| Loam / garden soil | 0.25 | 0.12 | ×1.00 | 39 mm | Table 19 'Loam', p. 144; p. 167 |
| Clay | 0.36 | 0.22 | ×0.95 | 42 mm | Table 19 'Clay', p. 144; p. 167 |
| (not set) | as Loam / garden soil | | | | assumed: true |

## 3. Crop rules (`CropRules`)

`KcFor` - Table 12 (pp. 110-114) joined by Eq. 66 (p. 132). `StageFor` - Table 11
(pp. 104-108) stage lengths; the last day of a stage still counts as that stage.
`KcWhenStageUnknown` (no planting date) - DATA RULE: the **highest** of the crop's three
Table 12 values, labelled "assumed peak growth", so a wrong guess errs toward enough water.
That is Kc mid for every crop except citrus, whose Kc mid is below its Kc ini.
`SensitiveStage` - p. 176: yield loss from shortage is largest at flowering and yield
formation, which fall in mid-season (p. 95-96) - farmers' "Peak growth".
`StageChangeSoon` warns 7 days ahead and `HarvestSoon` in the last 14 days (DATA RULES: one watering routine; when the late-season fall in Kc starts to matter).

| Crop | Kc start | Kc peak | Kc end | Kc with no planting date | Stage days (est./grow/peak/late) | p | Root depth | Source |
|---|---|---|---|---|---|---|---|---|
| Citrus | 0.70 | 0.65 | 0.70 | 0.70 | 60/90/120/95 = 365 | 0.50 | 1.2 m | Table 11, Jan, Mediterranean, p. 107; Tables 12 and 22 |
| Cucumber | 0.60 | 1.00 | 0.75 | 1.00 | 20/30/40/15 = 105 | 0.50 | 0.7 m | Table 11, June/Aug, Arid Region; Tables 12 and 22 |
| Dry beans | 0.40 | 1.15 | 0.35 | 1.15 | 20/30/40/20 = 110 | 0.45 | 0.6 m | Table 11, May/June, Continental Climate; Tables 12 and 22 |
| Leafy vegetables (lettuce) | 0.70 | 1.00 | 0.95 | 1.00 | 20/30/15/10 = 75 | 0.30 | 0.3 m | Table 11, Apr, Mediterranean (Lettuce), p. 104; Tables 12 and 22 |
| Maize | 0.30 | 1.20 | 0.35 | 1.20 | 25/40/45/30 = 140 | 0.55 | 1.0 m | Table 11, Dec/Jan, Arid Climate; Tables 12 and 22 |
| Potato | 0.50 | 1.15 | 0.75 | 1.15 | 25/30/45/30 = 130 | 0.35 | 0.4 m | Table 11, Jan/Nov, (Semi)Arid Climate; Tables 12 and 22 |
| Spinach | 0.70 | 1.00 | 0.95 | 1.00 | 20/20/15/5 = 60 | 0.20 | 0.3 m | Table 11, Apr, Mediterranean; Tables 12 and 22 |
| Tomato | 0.60 | 1.15 | 0.80 | 1.15 | 30/40/45/30 = 145 | 0.40 | 0.7 m | Table 11, Apr/May, Mediterranean; Tables 12 and 22 |

| Stage | Shortage costs the most yield? |
|---|---|
| Establishing | no |
| Growing | no |
| Peak growth | **yes** (p. 176) |
| Nearing harvest | no |
| Season complete | no |

## 4. Water rules (`WaterRules`)

| Rule | Input | → Outcome | Source |
|---|---|---|---|
| `ShouldWaterToday` | dryness 19.9 mm, RAW 20 mm | no | p. 171 |
| `ShouldWaterToday` | dryness 20 mm, RAW 20 mm | **yes** | p. 171 ("or at the moment") |
| `SkipForRain` | rain 4.9 mm, need 5 mm | no | DATA RULE, Eq. 85 p. 170 |
| `SkipForRain` | rain 5 mm, need 5 mm | **yes** | DATA RULE, Eq. 85 p. 170 |
| `MinutesToRun` | 6 mm, 1.5 m², 1.5 L/min | 6 min | 1 mm on 1 m² = 1 L (Ch. 1 p. 3); never more than the dryness (p. 171); rounded up (DATA RULE) |
| `MinutesToRun` | 6.1 mm, 1.5 m², 1.5 L/min | 7 min | rounded up, never under-waters |
| `MinutesPerSquareMetre` | 6 mm, 1.5 L/min, no size | 4 min per m² | Ch. 1 p. 3; one decimal (DATA RULE) |
| `WaterSoon` | next watering in 2 days | **yes** | DATA RULE: 2-day look-ahead |
| `WaterSoon` | next watering in 3 days | no | |
| `HotDaysAhead` | forecast peak 5.2 mm, last week 4.0 mm | **yes** | DATA RULE: ×1.3 |
| `WasStressed` | Ks 1.0 / 0.99 | no / **yes** | Eq. 84, p. 169 |
| `AtOrBelowFarmerThreshold` | 30% vs 30%, fresh | **yes** | DATA RULE: the farmer's own level |
| `AtOrBelowFarmerThreshold` | 10% vs 30%, reading a day old | no | stale readings never decide alone |
| `WateringResetsBalance` | 2 min run, no size or flow | **yes** | DATA RULE: "the last full watering as the reset" |
| `WateringResetsBalance` | 1 min 59 s run | no | a pump test is not a watering |
| `RecommendedThreshold` | maize p 0.55, loam, wet 1200, dry 3000 | 2190 | Table 22 p, p. 167, clamp 0.1-0.8 p. 162 |
| `SoilFeelDepletion` | farmer says "wet", dryness 12 mm, RAW 20 mm | 0 mm | field capacity, Dr = 0 (p. 167) |
| `SoilFeelDepletion` | farmer says "dry", dryness 6 mm, RAW 20 mm | 20 mm | at least RAW - the watering point (p. 171) |
| `SoilFeelDepletion` | farmer says "moist", dryness 18 mm, RAW 20 mm | 15 mm | DATA RULE: held between 25% and 75% of RAW |

A soil check by hand counts for the day it was made (the latest one that day wins) and,
within 24 h, is named in the confidence ("based on the weather and your own soil check").
It never makes the advice High - only a set-up sensor does.

## 5. Verdict rules (`VerdictRules`)

DATA RULE: more than ×1.2 the crop's need is too much, less than ×0.8 too little.
Pump litres are estimates (run time × flow rate, no flow meter), so a tighter band would flag
noise. Exactly on a boundary is still "About right".

| Water given | Water needed | Ratio | → Verdict |
|---|---|---|---|
| 7.9 L | 10 L | 0.79 | Too little |
| 8 L | 10 L | 0.80 | About right |
| 10 L | 10 L | 1.00 | About right |
| 12 L | 10 L | 1.20 | About right |
| 12.1 L | 10 L | 1.21 | Too much |
| 5 L | 0 L | - | Not enough to judge |

## 6. Confidence rules (`ConfidenceRules`)

All DATA RULES: FAO-56 does not say how far to trust partial inputs. High needs everything set up
and a reading under 24 hours old; Medium allows up to 2 missing inputs;
otherwise Low. The next step is the first missing input in this order: crop, planting date,
flow rate, area, soil, wet/dry setup - then a quiet kit.

| Situation | → Level and reason | → Next step |
|---|---|---|
| Everything set up, fresh reading | High: your sensor, setup and the weather all agree. | - |
| No planting date | Medium: based on the weather; the planting date is missing, so peak growth is assumed. | Add the planting date for advice that follows your crop's growth. |
| No planting date, no zone size | Medium: based on the weather; the planting date is missing, so peak growth is assumed. | Add the planting date for advice that follows your crop's growth. |
| No planting date, size or soil | Low: based on the weather; the planting date is missing, so peak growth is assumed. | Add the planting date for advice that follows your crop's growth. |
| Sensor not set up | Medium: based on the weather; the soil sensor has not been set up. | Do the wet/dry setup on the soil sensor so its readings can be used. |
| Kit quiet since 17 Sep | Medium: based on the weather; your kit hasn't sent data since 17 Sep. | Your kit hasn't sent data since 17 Sep. Check it has power and WiFi. |
| Everything set up, no kit | Medium: based on the weather and your crop; no soil readings yet. | - |
| No crop | Low: no crop is set, so its water use is unknown. | Choose the crop for this zone so we can work out how much water it needs. |
| No weather | Low: there is no weather for this farm yet. | - |

## 7. Kit rules (`KitRules`)

All DATA RULES - FAO-56 knows nothing about sensors. A kit reports every 30 seconds.

| Problem | Rule | → Farmer sentence |
|---|---|---|
| Offline | no reading for 3 h | "No data from North Plot since 08:00 on 6 Oct." |
| Sensor stuck | same reading for 6 h | "North Plot sensor may be faulty or loose. Check it." |
| Pump ran, no change | a run of at least 2 min, soil no wetter 30 min later; never judged on missing readings | "North Plot: pump ran but soil didn't get wetter. Check pump, pipe and water supply." |
| Temperature sensor offline | soil readings arriving, no valid temperature/humidity for 2 h; back after 3 good readings in a row | "North Plot's temperature sensor isn't working. We're using weather app data for now, and our team has been notified." |
| Sensor drift | wettest reading this week more than 15% of the wet/dry span from the saved wet point | "North Plot sensor readings are drifting. Re-do the wet/dry setup." |

## 8. Today's one action (`TodayRules`)

The Home card and the admin farm page show ONE sentence per zone, worded from the engine's
`PrimaryAction` in this order (DATA RULE - the order a farmer would want them):

1. Crop not planted / season complete → "No crop irrigation yet …" / "Crop cycle complete …"
2. Postpone for rain → "No watering today: rain is expected to cover it."
3. Water now → "Water about N min this morning (about N L)"; reduced → "Rain helps, but water …".
4. Kit problem: pump ran with no effect, kit offline, sensor stuck → "Check the …"
5. No crop set → "Finish setup: …" with the one next step.
6. Water soon → "No watering today; next on <day>".
7. No water needed → "No watering needed today" (only for this action).
8. Check field / sensor / pump and pipes → "Check the …".
9. Otherwise (finish setup, not enough data) → "Finish setup: …" or "No advice yet …".

## 9. Recommended for you (`RecommendationRules`)

| Number | Rule | Source |
|---|---|---|
| Water at (relative %) | (1 − p × soil factor) × 100, p clamped 0.1-0.8 - exactly what Reset to recommended saves | Table 22 (pp. 163-165), p. 167, p. 162 |
| Stop at | 100% (field capacity) | p. 167 |
| How often | RAW ÷ ETc days, shown as a whole-day range; ETc = Kc × mean ETo | Eq. 83 p. 162, Eq. 58 p. 103 |
| How long | RAW × area ÷ flow, whole minutes, rounded up | Ch. 1 p. 3, p. 171 |
| Climate | the last 30 days of measured ETo if at least 14; else the forecast; else what history there is | DATA RULE |
| No weather yet | RAW from Table 22's own basis, ETc ≈ 5 mm/day; no "how often" | Table 22 footnote, p. 163 |
| Stage unknown / soil unknown | peak Kc / loam, as in the daily advice, and the confidence says so | item 2 |

Worked example - potato, loam, 0.2 m², 1.5 L/min, ETo 5 mm/day, stage unknown:

> Based on your climate in Mafikeng and since you want to grow potato on loam soil, we recommend: water when the soil reaches about 65% (relative), stop at 100%; expect to water about every 2–3 days in October, about 3 minutes each time for this 0.2 m² irrigation zone.

Confidence: Medium: the planting date is missing, so peak growth is assumed.

## Needs another source

Rules a farmer would find useful that FAO-56 does **not** support. They are not in the app;
each says what would have to be found first.

| Question | Why FAO-56 can't answer it | Kind of source that would |
|---|---|---|
| How slowly should clay be watered to avoid run-off? | FAO-56 gives how much water soil holds (Table 19), not how fast it soaks in. | Soil infiltration rates by texture - ARC Soil, Climate and Water guidelines; FAO Irrigation and Drainage Paper 24. |
| Which growth stage of *each* crop is most sensitive to a shortage, and how much yield is lost? | FAO-56 (p. 176) says only that flowering and yield formation are the most sensitive in general, and points to Paper 33. | Yield response factors Ky by stage - FAO Irrigation and Drainage Paper 33 and Paper 66 (*Crop yield response to water*). |
| When should a farmer plant each crop in the Western Cape? | FAO-56 Table 11 gives example planting months for other regions, not local calendars. | ARC crop production guidelines; Western Cape Department of Agriculture planting calendars. |
| How long does each stage really last for local varieties? | Table 11 says its stage lengths are indicative only. | Local trials or seed-company variety data; ARC. |
| When and how much to fertilise? | Out of scope for FAO-56 (water only). | ARC crop production guidelines; fertiliser-company recommendations from a soil test. |
| Which pests or diseases follow from wet leaves or over-watering? | Out of scope for FAO-56. | ARC Plant Health; Department of Agriculture pest advisories. |
| How much light rain actually reaches the roots in a small tub? | FAO-56 Eq. 85 uses effective rain but gives no method for containers; our cut-off (rain under 0.2 × ETo ignored) is a DATA RULE. | Measurement in our own tubs; FAO Irrigation and Drainage Paper 25 (*Effective rainfall*). |
| How often should a resistive soil probe be re-set-up as it corrodes? | Not about crop water; our 15% drift trigger is a DATA RULE. | Probe manufacturer data; our own drift logs over a season. |
| How well can a farmer judge soil water by hand? | FAO-56 has no feel method; our "moist" band (25-75% of RAW) is a DATA RULE. | USDA NRCS *Estimating Soil Moisture by Feel and Appearance* (1998), checked against our own tubs. |
| Does salty water or soil change the advice? | FAO-56 Eqs. 89-92 need soil salinity (ECe), which AgroFlow does not measure. | A soil and water salinity test from an accredited lab. |
