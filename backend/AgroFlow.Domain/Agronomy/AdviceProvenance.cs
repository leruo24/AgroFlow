#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace AgroFlow.Business.Agronomy;

// What one piece of advice was worked out from (AF-18), so the farmer can judge it: the crop the
// zone is set to (the saved crop_type, never inferred from the zone's name), the engine's crop
// model for it, the planting date, the dates of the weather used, the days that had no weather,
// and when it was calculated. Read from the engine's own input and result; the engine is unchanged.
public sealed record AdviceProvenanceView(
    string? CropType,
    string? CropModelKey,
    string? CropModelLabel,
    bool CropModelIsDefault,
    DateOnly? PlantingDate,
    bool StageAssumed,
    string SoilModel,
    bool SoilDefaulted,
    DateOnly? WeatherFrom,
    DateOnly? WeatherTo,
    int ForecastDays,
    IReadOnlyList<DateOnly> MissingWeatherDays,
    DateTimeOffset CalculatedAt);

public static class AdviceProvenance
{
    // The latest few missing days are listed; older gaps are counted in the Limitations.
    public const int MaxMissingDaysListed = 7;

    public static AdviceProvenanceView From(ZoneEngineInput input, ZoneEngineResult result, DateTimeOffset calculatedAt)
    {
        var observed = input.Weather.Where(w => !w.IsForecast && w.HasWeatherRow).Select(w => w.Date).ToList();
        var forecast = input.Weather.Where(w => w.IsForecast && w.Date >= input.Today).Select(w => w.Date).Distinct().Count();
        var withRow = new HashSet<DateOnly>(observed);
        var missing = result.Days
            .Where(d => !d.IsForecast && !withRow.Contains(d.Day))
            .Select(d => d.Day)
            .OrderByDescending(d => d)
            .Take(MaxMissingDaysListed)
            .OrderBy(d => d)
            .ToList();

        var saved = input.CropType?.Trim();
        var crop = result.Crop;
        return new AdviceProvenanceView(
            CropType: string.IsNullOrEmpty(saved) ? null : saved,
            CropModelKey: crop?.Key,
            CropModelLabel: crop?.Label,
            // The engine's model is a stand-in when its key differs from the saved crop (for example
            // "leafy_veg" advised as lettuce): the farmer is told which model was used.
            CropModelIsDefault: crop is not null && !string.Equals(crop.Key, saved, StringComparison.OrdinalIgnoreCase),
            PlantingDate: input.PlantingDate,
            StageAssumed: result.StageAssumed,
            SoilModel: result.Soil.Key,
            SoilDefaulted: result.SoilWasDefaulted,
            WeatherFrom: observed.Count > 0 ? observed.Min() : null,
            WeatherTo: observed.Count > 0 ? observed.Max() : null,
            ForecastDays: forecast,
            MissingWeatherDays: missing,
            CalculatedAt: calculatedAt);
    }
}
