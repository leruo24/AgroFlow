# Simulated demonstration farms

These records are demonstrations, not measurements. Every farm name, zone name and generated
reading is labelled **Simulated**, and the database also stores `farm.is_simulated = true` and
`sensor_reading.simulated = true`.

## Locations

Coordinates were queried from the [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api)
on 14 October 2026:

| Farm | Open-Meteo result used | Latitude | Longitude |
| --- | --- | ---: | ---: |
| Rustlers Valley (Simulated) | Ficksburg, Free State (the requested nearby locality; “Rustlers Valley” returned no result) | -28.872 | 27.87506 |
| Brits (Simulated) | Brits, North West | -25.63473 | 27.78022 |

## How readings are generated

`SimulationService` is off by default. Set `Simulation__Enabled=true` to run it; the optional
`Simulation__IntervalHours` defaults to 6. A zone receives at most one generated soil-moisture
reading per Johannesburg day.

The service only selects zones whose farm is flagged `is_simulated`, whose daily weather source
is `open-meteo-*`, and whose existing FAO-56 `zone_water_balance` has a usable depletion (`dr_end_mm`)
and total available water (`taw_mm`). Moisture is the balance's relative fullness:

`100 × (1 − dr_end_mm / taw_mm)`

A deterministic noise term of at most ±0.35 percentage points is added so the demonstration does
not draw a mathematically perfect line. The insert independently checks `farm.is_simulated = true`,
then stores `simulated=true`. It bypasses sensor command processing and never writes an MQTT or pump
command. If weather or the water balance is missing, it writes nothing rather than inventing a result.
