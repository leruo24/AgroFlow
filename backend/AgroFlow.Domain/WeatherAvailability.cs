#nullable enable
using System;

namespace AgroFlow.Business;

// Whether AgroFlow knows today's weather for a farm, and whether rain is expected (AF-03).
// Unknown is never "dry": a missing or stale forecast is "missing" / "stale" with a reason, and
// rainExpected is null. Rain comes from the forecast's precipitation in millimetres, never from
// the word "rain" in a description. The app has the same rule (apps/mobile/src/lib/weatherStatus.ts),
// checked against the same cases (docs/audit/fixtures/weather-cases.json).
public static class WeatherAvailability
{
    public const string Available = "available";
    public const string Missing = "missing";
    public const string Stale = "stale";

    // Collection runs every 6 hours; older than two missed runs is stale (the same 12 hours as
    // the staff health check).
    public static readonly TimeSpan StaleAfter = TimeSpan.FromHours(12);

    // ForecastOutlook.RainMmThreshold: 1 mm or more is rain worth mentioning.
    public const double RainMmThreshold = ForecastOutlook.RainMmThreshold;

    public sealed record Status(string Availability, bool? RainExpected, double? PrecipitationMm, DateTimeOffset? FetchedAt, string Reason);

    public static Status Evaluate(bool hasRow, double? precipitationMm, DateTimeOffset? fetchedAt, DateTimeOffset now)
    {
        if (!hasRow || fetchedAt is null)
            return new Status(Missing, null, null, null, "no_forecast");
        if (now - fetchedAt.Value > StaleAfter)
            return new Status(Stale, null, precipitationMm, fetchedAt, "forecast_old");
        if (precipitationMm is not { } mm || double.IsNaN(mm) || mm < 0)
            return new Status(Missing, null, null, fetchedAt, "no_precipitation");
        return new Status(Available, mm >= RainMmThreshold, mm, fetchedAt, mm >= RainMmThreshold ? "rain_forecast" : "dry_forecast");
    }
}
