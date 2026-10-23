# What the FAO-56 engine does when weather is missing

Written for the 22 October 2026 audit (AF-03, AF-18). This describes the engine as it is in
`backend/AgroFlow.Domain/Agronomy/`. **No maths was changed** for the audit; the display fixes
are separate (`WeatherAvailability`, `AdviceProvenance`, the app's `lib/weatherStatus.ts`).

## Inputs

The engine reads `weather_daily` (migration 0016): one row per farm per date, observed
(`is_forecast = false`) or forecast (`is_forecast = true`), with `tmin_c`, `tmax_c`,
`precipitation_mm`, humidity, wind and `fetched_at`.

## Day by day

| Situation | What `Fao56Engine` does | Where |
|---|---|---|
| A past day in the balance window has **no weather row** | The day is still in the soil water balance, with `HasWeatherRow = false`. Rain for that day is taken as **0 mm**. | `Fao56Engine.cs`, the observed-days loop (`new ZoneWeatherDay { HasWeatherRow = false }`) and `BuildDay` (`RainMm = w.RainMm ?? 0.0`) |
| A day has no usable **temperature** | Reference ET (ETo) falls back to the kit's DHT11 daily temperatures when there are any, and the day is marked `Incomplete` with a limitation line ("No weather-app temperature for …"). With neither, ETo for that day is not computed and the balance has a gap. | `DailyEtoResolver.Resolve` (temperature: weather app → DHT11 → none) |
| No **wind** or **humidity** | FAO-56's defaults are used (2 m/s wind, p. 63) and the day is `Incomplete`. | `DailyEtoResolver` |
| No **forecast** rows | No rolling outlook is made, and the advice carries the limitation "There is no weather forecast saved for this farm, so no advice could be given on when the next watering will be needed." | `Fao56Engine.cs` (`forecastDays.Count == 0`) |
| The balance cannot run (no crop, no planting date, no observed days) | `PrimaryAction = InsufficientData`: the app says what is missing instead of advising. | `Fao56Engine.cs` (`!result.BalanceRan`) |

## Why this is conservative

Counting missing rain as 0 mm makes the soil look **drier** than it may be, so the engine
leans towards "water" rather than "skip". Combined with the per-zone run cap (AF-05, every run
capped at the zone's maximum in the API, the database trigger and the firmware) a missing
forecast cannot turn into an over-long run. It can, however, turn into advice to water when it
did rain: that is why the advice now says which days had no weather (`missingWeatherDays` in
`AdviceProvenance`) and the screens say "Weather unavailable" instead of "Dry / No".

## What the screens show now

- `GET /api/farmer/farms/{id}/today` returns `weather` (`available` / `missing` / `stale`,
  `rainExpected` only when available) and, per zone, `provenance`: the saved crop, the engine's
  crop model, the observed weather dates used, the days with no weather, and `calculatedAt`.
- The farmer dashboard returns `weatherToday` (today's `weather_daily` row); the zone screen reads
  rain from `precipitation_mm` (1 mm or more, `ForecastOutlook.RainMmThreshold`) and says
  "Weather unavailable" / "Weather out of date" when it is missing or older than 12 hours.

## Not changed

The water balance, Kc, ETo, the decision thresholds and `PrimaryAction` are as they were. A
different missing-weather policy (for example, holding advice when more than N days are missing)
is a decision for the team; this document is the starting point for it.
