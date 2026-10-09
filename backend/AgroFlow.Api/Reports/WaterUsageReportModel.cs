using System.Globalization;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Reports;

/// One zone, one period: everything the report prints.
/// The PDF and the workbook both render from this one model, gathered once, so
/// they can never disagree on a figure.
internal sealed class WaterUsageReportModel
{
    public required string FarmName { get; init; }
    public required string ZoneName { get; init; }
    public string? CropLabel { get; init; }

    public required DateOnly From { get; init; }
    public required DateOnly To { get; init; }
    public required DateTimeOffset GeneratedAtSast { get; init; }

    /// Null when the zone has no flow rate; everything derived from it is null too (0018).
    public double? FlowRateLpm { get; init; }

    public required IReadOnlyList<DayLine> Days { get; init; }
    public required IReadOnlyList<ChartSvg.MoisturePoint> MoistureSeries { get; init; }
    public required IReadOnlyList<double> PumpPositions { get; init; }
    public required IReadOnlyList<AdviceLine> Advice { get; init; }

    /// "Peak growth, day 72 of 145". Null when the crop or planting date is not set,
    /// and the report then does not mention a stage.
    public string? GrowthStage { get; init; }

    /// The day the engine expects the soil to reach its watering point.
    public DateOnly? NextWatering { get; init; }
    public double? NextWateringMinutes { get; init; }
    public double? NextWateringLitres { get; init; }

    /* ---- What the action report needs from the engine ------- */

    /// Every insight for the zone, not just the four Advice lines; "This week, do
    /// this" picks from all of them.
    public IReadOnlyList<ZoneInsight> Insights { get; init; } = Array.Empty<ZoneInsight>();

    /// The engine run behind the figures, for confidence, the next setup step, the
    /// forecast and the appendix. Null when the zone has no engine row; the report says so.
    public ZoneEngineInput? EngineInput { get; init; }
    public ZoneEngineResult? Engine { get; init; }

    /// True once the wet/dry setup is done: the soil chart is drawn only then.
    public bool Calibrated { get; init; }

    public double HealthyLowPercent { get; init; } = 60;
    public double HealthyHighPercent { get; init; } = 100;

    /* ---- Totals, computed once so the PDF and the workbook agree ------ */

    public int TotalRuns => Days.Sum(d => d.PumpRuns);
    public double TotalMinutes => Round(Days.Sum(d => d.PumpMinutes));

    /// Every total is rounded to three decimals. Adding seven rounded doubles gave
    /// 10.999999999999998 for 11, which the workbook would store as is. Three decimals
    /// is far beyond the precision of an estimate anyway.
    private static double Round(double value) => Math.Round(value, 3);

    /// Null if no day could be estimated: a zone with no flow rate has no water figure,
    /// which is different from a zone that was not watered.
    public double? TotalLitres =>
        Days.Any(d => d.Litres.HasValue) ? Round(Days.Sum(d => d.Litres ?? 0)) : null;

    public double? TotalNeedLitres =>
        Days.Any(d => d.NeedLitres.HasValue) ? Round(Days.Sum(d => d.NeedLitres ?? 0)) : null;

    public double? Difference =>
        TotalLitres.HasValue && TotalNeedLitres.HasValue ? Round(TotalLitres.Value - TotalNeedLitres.Value) : null;

    /// Days whose average moisture sat below the healthy band.
    public int DaysTooDry =>
        Days.Count(d => d.AvgMoisturePercent.HasValue && d.AvgMoisturePercent < HealthyLowPercent);

    public double? AvgMoisturePercent
    {
        get
        {
            var values = Days.Where(d => d.AvgMoisturePercent.HasValue)
                             .Select(d => d.AvgMoisturePercent!.Value).ToList();
            return values.Count == 0 ? null : Round(values.Average());
        }
    }

    public double TotalRainMm => Round(Days.Sum(d => d.RainMm ?? 0));

    public double? AvgAreaTempC => Avg(Days.Select(d => d.AreaMaxC));
    public double? AvgLocalTempC => Avg(Days.Select(d => d.LocalMaxC));
    public double? AvgAreaHumidity => Avg(Days.Select(d => d.AreaHumidity));
    public double? AvgLocalHumidity => Avg(Days.Select(d => d.LocalHumidity));

    private static double? Avg(IEnumerable<double?> values)
    {
        var present = values.Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return present.Count == 0 ? null : Round(present.Average());
    }

    public sealed record DayLine(
        DateOnly Date,
        int PumpRuns,
        double PumpMinutes,
        double? Litres,
        double? NeedLitres,
        double? AvgMoisturePercent,
        double? AreaMaxC,
        double? LocalMaxC,
        double? AreaHumidity,
        double? LocalHumidity,
        double? RainMm,
        string Note)
    {
        /// "Mon 28" for charts, "Mon 28 Sep" for tables. Invariant culture, because some
        /// hosts write "Sept" and this can reach a Telegram caption.
        public string ShortLabel =>
            Date.ToDateTime(TimeOnly.MinValue).ToString("ddd d", CultureInfo.InvariantCulture);

        public string LongLabel =>
            Date.ToDateTime(TimeOnly.MinValue).ToString("ddd d MMM", CultureInfo.InvariantCulture);
    }

    // The insight's own explanation, for the "Why:" line.
    public sealed record AdviceLine(string Message, string Source, AgroFlow.Business.Agronomy.RuleBook.Explanation? Why = null);

    // The period's verdict comes from VerdictRules and carries its own explanation.
    // Cached so the PDF's "Why:" line and its appendix entry are the same object.
    private AgroFlow.Business.Agronomy.RuleBook.Explanation? _verdictWhy;
    private bool _verdictBuilt;

    public AgroFlow.Business.Agronomy.RuleBook.WateringVerdict? Verdict =>
        TotalLitres.HasValue && TotalNeedLitres.HasValue
            ? AgroFlow.Business.Agronomy.RuleBook.VerdictRules.For(TotalLitres.Value, TotalNeedLitres.Value)
            : null;

    public AgroFlow.Business.Agronomy.RuleBook.Explanation? VerdictWhy
    {
        get
        {
            if (!_verdictBuilt)
            {
                _verdictBuilt = true;
                _verdictWhy = TotalLitres.HasValue && TotalNeedLitres.HasValue
                    ? AgroFlow.Business.Agronomy.RuleBook.Explanations.Verdict(TotalLitres.Value, TotalNeedLitres.Value, CropLabel, "this period")
                    : null;
            }
            return _verdictWhy;
        }
    }
}

/// Builds the model. All reads; nothing here writes.
internal static class WaterUsageReportBuilder
{
    /// SAST (UTC+2, no daylight saving).
    private static readonly TimeSpan Sast = TimeSpan.FromHours(2);

    /// How far back the engine's balance reaches. A report older than this cannot show
    /// crop-need or moisture figures, and says so.
    public const int EngineWindowDays = Fao56EngineController.BalanceWindowDays;

    /// Security: returns null when the zone does not exist or the caller does not own
    /// it. The caller turns that into a 404, so "not yours" and "not there" look the same.
    public static async Task<WaterUsageReportModel?> BuildAsync(
        NpgsqlConnection connection,
        Fao56EngineController engine,
        Guid profileId,
        long zoneId,
        DateOnly from,
        DateOnly to,
        CancellationToken ct)
    {
        /* ---- 1. The zone, and whether this person may read it --------- */
        const string zoneSql = """
            select z.id, z.name, z.crop_type, z.flow_rate_lpm,
                   z.calibration_wet, z.calibration_dry,
                   f.farm_id, f.name
              from zone z
              join farm f on f.farm_id = z.farm_id
             where z.id = $1
               and (exists (select 1 from farm f2 where f2.farm_id = z.farm_id and f2.owner_id = $2)
                 or exists (select 1 from farm_member fm where fm.farm_id = z.farm_id and fm.profile_id = $2)
                 or exists (select 1 from profile p where p.id = $2 and p.role = 'admin'))
            """;

        string zoneName, farmName;
        string? cropType;
        double? flowRate, calibrationWet, calibrationDry;

        await using (var cmd = new NpgsqlCommand(zoneSql, connection))
        {
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(profileId);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return null;

            zoneName = reader.IsDBNull(1) ? $"Zone {zoneId}" : reader.GetString(1);
            cropType = reader.IsDBNull(2) ? null : reader.GetString(2);
            flowRate = reader.IsDBNull(3) ? null : reader.GetFloat(3);
            calibrationWet = reader.IsDBNull(4) ? null : reader.GetDouble(4);
            calibrationDry = reader.IsDBNull(5) ? null : reader.GetDouble(5);
            farmName = reader.IsDBNull(7) ? "Farm" : reader.GetString(7);
        }

        // A past period keeps the crop that was growing then.
        var cropChanges = await CropHistory.ReadAsync(connection, zoneId, ct);
        var (cropThen, _) = CropHistory.AsOf(cropType, null, cropChanges, to);
        cropType = cropThen;

        /* ---- 2. Pump runs per day ------------------------------------- */
        // Grouped in SAST, not UTC: a run at 01:30 local belongs to that morning, not
        // the previous day.
        const string eventSql = """
            select (started_at at time zone 'Africa/Johannesburg')::date as day,
                   count(*),
                   coalesce(sum(runtime_seconds), 0),
                   -- Item 6: waterings the farmer logged by hand (read
                   -- through jsonb so a database without 0042 still works).
                   count(*) filter (where (to_jsonb(irrigation_event) ->> 'logged_by_profile_id') is not null),
                   coalesce(sum(estimated_litres) filter (
                       where (to_jsonb(irrigation_event) ->> 'logged_by_profile_id') is not null
                         and coalesce(runtime_seconds, 0) = 0), 0)
              from irrigation_event
             where zone_id = $1
               and (started_at at time zone 'Africa/Johannesburg')::date between $2 and $3
             group by 1
            """;

        var runsByDay = new Dictionary<DateOnly, (int Runs, long Seconds, int ByHand, double HandLitres)>();

        await using (var cmd = new NpgsqlCommand(eventSql, connection))
        {
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                runsByDay[reader.GetFieldValue<DateOnly>(0)] =
                    ((int)reader.GetInt64(1), reader.GetInt64(2), (int)reader.GetInt64(3), Convert.ToDouble(reader.GetValue(4)));
            }
        }

        /* ---- 3. Each pump run's moment, for the chart markers ---------- */
        const string pumpTimesSql = """
            select started_at at time zone 'Africa/Johannesburg'
              from irrigation_event
             where zone_id = $1
               and (started_at at time zone 'Africa/Johannesburg')::date between $2 and $3
             order by started_at
            """;

        var pumpTimes = new List<DateTime>();

        await using (var cmd = new NpgsqlCommand(pumpTimesSql, connection))
        {
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) pumpTimes.Add(reader.GetDateTime(0));
        }

        /* ---- 4. Soil moisture readings -------------------------------- */
        const string moistureSql = """
            select recorded_at at time zone 'Africa/Johannesburg', value
              from sensor_reading
             where zone_id = $1
               and sensor_type = 'SoilMoisture'
               and (recorded_at at time zone 'Africa/Johannesburg')::date between $2 and $3
             order by recorded_at
            """;

        var readings = new List<(DateTime At, double Raw)>();

        await using (var cmd = new NpgsqlCommand(moistureSql, connection))
        {
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                readings.Add((reader.GetDateTime(0), reader.GetDouble(1)));
            }
        }

        /* ---- 5. Temperature and humidity measured locally in the zone --- */
        const string dhtSql = """
            select (recorded_at at time zone 'Africa/Johannesburg')::date,
                   max(value) filter (where sensor_type = 'Temperature'),
                   avg(value) filter (where sensor_type = 'Humidity')
              from sensor_reading
             where zone_id = $1
               and sensor_type in ('Temperature', 'Humidity')
               and (recorded_at at time zone 'Africa/Johannesburg')::date between $2 and $3
             group by 1
            """;

        var localByDay = new Dictionary<DateOnly, (double? MaxC, double? Humidity)>();

        await using (var cmd = new NpgsqlCommand(dhtSql, connection))
        {
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                localByDay[reader.GetFieldValue<DateOnly>(0)] = (
                    reader.IsDBNull(1) ? null : reader.GetDouble(1),
                    reader.IsDBNull(2) ? null : reader.GetDouble(2));
            }
        }

        /* ---- 6. The engine: crop need, weather, stage, next watering --- */
        // Anchored on the report's last day instead of today, so last week's report uses
        // a balance that ended last week and its "next watering" fits that period.
        var engineZone = engine.Data.GetZone(zoneId);
        ZoneEngineResult? engineResult = null;
        ZoneEngineInput? engineInput = null;
        var weatherByDay = new Dictionary<DateOnly, ZoneWeatherDay>();
        var insights = new List<ZoneInsight>();

        if (engineZone is not null)
        {
            var today = Fao56EngineController.TodayInSast();
            var anchor = to > today ? today : to;

            // The crop and planting date as they were on the anchor day.
            if (cropChanges.Count > 0)
            {
                (engineZone.CropType, engineZone.PlantingDate) =
                    CropHistory.AsOf(engineZone.CropType, engineZone.PlantingDate, cropChanges, anchor);
            }

            var input = engine.BuildInput(engineZone, anchor);
            engineInput = input;
            foreach (var w in input.Weather) weatherByDay[w.Date] = w;

            engineResult = Fao56Engine.Run(input);

            // We call ZoneInsightBuilder.Build directly, not engine.RunActNowChecks, because
            // that saves insights as a side effect. Making a report must not change what the
            // farmer sees in the app; the builder is pure.
            var signals = engine.BuildFaultSignals(engineZone, anchor);
            insights = ZoneInsightBuilder.Build(input, engineResult, signals);
        }

        var balanceByDay = engineResult?.Days.ToDictionary(d => d.Day) ?? new Dictionary<DateOnly, WaterBalanceDay>();
        var areaM2 = engineZone?.AreaM2;

        /* ---- 7. Assemble a line per day ------------------------------- */
        var days = new List<WaterUsageReportModel.DayLine>();

        for (var date = from; date <= to; date = date.AddDays(1))
        {
            runsByDay.TryGetValue(date, out var runs);
            var minutes = runs.Seconds / 60.0;

            // The formula from migration 0018, the only place litres are worked out.
            // Null when the zone has no flow rate, never 0.
            double? litres = flowRate.HasValue ? minutes * flowRate.Value : null;

            // A hand-logged watering given in litres adds the litres the farmer entered.
            if (runs.HandLitres > 0) litres = (litres ?? 0) + runs.HandLitres;

            balanceByDay.TryGetValue(date, out var balance);

            // ETc is a depth in mm and 1 mm over 1 m² is 1 litre, so a zone with no area
            // has no need figure.
            double? needLitres = balance?.EtcAdjustedMm is { } mm && areaM2 is { } area
                ? mm * area
                : null;

            var dayReadings = readings
                .Where(r => DateOnly.FromDateTime(r.At) == date)
                .Select(r => SoilWaterBalance.RelativeMoisturePercent(r.Raw, calibrationWet, calibrationDry))
                .Where(p => p.HasValue)
                .Select(p => p!.Value)
                .ToList();

            double? avgMoisture = dayReadings.Count == 0 ? null : dayReadings.Average();

            weatherByDay.TryGetValue(date, out var weather);
            localByDay.TryGetValue(date, out var local);

            days.Add(new WaterUsageReportModel.DayLine(
                date,
                runs.Runs,
                Math.Round(minutes, 2),
                litres.HasValue ? Math.Round(litres.Value, 2) : null,
                needLitres.HasValue ? Math.Round(needLitres.Value, 2) : null,
                avgMoisture.HasValue ? Math.Round(avgMoisture.Value, 1) : null,
                weather?.TMaxC,
                local.MaxC ?? weather?.DhtTMaxC,
                weather?.RhMeanPct,
                local.Humidity ?? weather?.DhtRhMeanPct,
                balance?.RainMm ?? weather?.RainMm,
                HandPrefix(runs.ByHand) + DayNote(runs.Runs, litres, needLitres, balance?.RainMm ?? weather?.RainMm, avgMoisture)));
        }

        /* ---- 8. The moisture series, positioned by actual time --------- */
        var periodStart = from.ToDateTime(TimeOnly.MinValue);
        var periodSpan = to.AddDays(1).ToDateTime(TimeOnly.MinValue) - periodStart;

        var series = readings
            .Select(r => new
            {
                Position = periodSpan.TotalSeconds <= 0 ? 0 : (r.At - periodStart).TotalSeconds / periodSpan.TotalSeconds,
                Percent = SoilWaterBalance.RelativeMoisturePercent(r.Raw, calibrationWet, calibrationDry),
            })
            .Where(p => p.Percent.HasValue)
            .Select(p => new ChartSvg.MoisturePoint(p.Position, p.Percent!.Value))
            .ToList();

        var pumpPositions = pumpTimes
            .Select(t => periodSpan.TotalSeconds <= 0 ? 0 : (t - periodStart).TotalSeconds / periodSpan.TotalSeconds)
            .ToList();

        /* ---- 9. Advice, with where each line came from ----------------- */
        // Act-now first, then the rest, at most four: past that a farmer stops reading
        // a numbered list.
        var advice = insights
            .OrderBy(i => i.Severity == InsightSeverity.ActNow ? 0 : 1)
            .Take(4)
            .Select(i => new WaterUsageReportModel.AdviceLine(i.Message, i.Source, i.Explanation))
            .ToList();

        /* ---- 10. The crop and its stage -------------------------------- */
        var crop = Fao56EngineReference.TryResolveCrop(cropType);

        string? stage = null;
        if (engineResult?.Stage is { } st && engineResult.DayOfSeason is { } dayOfSeason && crop is not null)
        {
            stage = $"{Fao56EngineReference.StageLabel(st)}, day {dayOfSeason} of {crop.TotalDays}";
        }

        return new WaterUsageReportModel
        {
            FarmName = farmName,
            ZoneName = zoneName,
            CropLabel = crop?.Label,
            Insights = insights,
            EngineInput = engineInput,
            Engine = engineResult,
            Calibrated = calibrationWet.HasValue && calibrationDry.HasValue,
            From = from,
            To = to,
            GeneratedAtSast = DateTimeOffset.UtcNow.ToOffset(Sast),
            FlowRateLpm = flowRate,
            Days = days,
            MoistureSeries = series,
            PumpPositions = pumpPositions,
            Advice = advice,
            GrowthStage = stage,
            NextWatering = engineResult?.NextWateringDate,
            NextWateringMinutes = engineResult?.RecommendedMinutes,
            NextWateringLitres = engineResult?.RecommendedLitres,
        };
    }

    /// The one-line note in the daily table. Plain, and never a judgement the data
    /// cannot support: with no need figure we only say what happened.
    // Entries typed in by the farmer are labelled as such.
    internal static string HandPrefix(int byHand) => byHand switch
    {
        0 => string.Empty,
        1 => "Watered by hand (logged); ",
        _ => $"{byHand} waterings logged by hand; ",
    };

    private static string DayNote(
        int runs, double? litres, double? need, double? rain, double? moisture)
    {
        if (rain is >= 2) return "Rain helped";
        if (runs == 0) return "Pump did not run";

        if (litres is null || need is null)
        {
            return runs == 1 ? "One run" : $"{runs} runs";
        }

        if (moisture is { } m && m < 60) return "Soil dipped low";
        if (litres < need * 0.8) return "Less than needed";
        if (litres > need * 1.3) return "More than needed";

        return "Watering about right";
    }
}
