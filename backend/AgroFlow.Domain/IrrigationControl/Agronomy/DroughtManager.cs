#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AgroFlow.Business.Agronomy
{
    // Drought mode (docs/drought-community.md, Part 1): a layer ON TOP of the normal advice.
    // It never changes the FAO-56 engine or TodayRules/PrimaryAction; it takes the engine's
    // own recommended amount for each zone and says how much of it to give while water is
    // short, and why. Advice comes from the farm's own tank estimate, readings and forecast
    // only: it does not predict droughts and is not an official drought declaration.

    // Every threshold is an app_setting row (migration 0054), so staff can change it.
    public sealed record DroughtSettings(
        double TankLowFraction,
        int ForecastDays,
        double RainSumMm,
        double EtoRatio,
        int EtoLookbackDays,
        double KyFullAt,
        double KySkipBelow,
        double ReducedFraction)
    {
        // The seeded defaults in 0054 (the API reads the live values).
        public static readonly DroughtSettings Defaults = new(0.25, 7, 5, 1.0, 30, 1.0, 0.25, 0.5);
    }

    // The farm's own facts for one decision.
    public sealed record DroughtInputs(
        double? TankFraction,              // tank estimate / capacity; null = no tank
        bool AnyZoneBelowThreshold,        // soil below the zone's own threshold (no-tank path)
        double ForecastRainMm,             // sum over DroughtSettings.ForecastDays
        double? ForecastMeanEtoMm,         // reference ET, mean over the forecast days
        double? RecentMeanEtoMm,           // the farm's own mean over EtoLookbackDays
        string? Override);                 // "on" / "off" by hand, null = automatic

    public sealed record DroughtDecision(bool Active, bool Automatic, string Reason);

    public static class DroughtRules
    {
        public static DroughtDecision Decide(DroughtInputs i, DroughtSettings s)
        {
            if (i.Override == "on") return new(true, false, "Drought mode was switched on by hand.");
            if (i.Override == "off") return new(false, false, "Drought mode was switched off by hand.");

            var waterShort = i.TankFraction is { } f
                ? f < s.TankLowFraction
                : i.AnyZoneBelowThreshold;
            var dry = i.ForecastRainMm < s.RainSumMm;
            // "High for the area": at or above the farm's own recent average (no fixed number).
            var etHigh = i.ForecastMeanEtoMm is { } now && i.RecentMeanEtoMm is { } usual && usual > 0
                && now >= usual * s.EtoRatio;

            var why = new List<string>();
            why.Add(i.TankFraction is { } t
                ? $"tank about {Percent(t)} full (drought line {Percent(s.TankLowFraction)})"
                : i.AnyZoneBelowThreshold ? "soil below the watering point" : "soil not below the watering point");
            why.Add($"{Mm(i.ForecastRainMm)} mm of rain forecast over {s.ForecastDays} days (less than {Mm(s.RainSumMm)} mm counts as dry)");
            why.Add(i.ForecastMeanEtoMm is { } e && i.RecentMeanEtoMm is { } r
                ? $"crop water use {Mm(e)} mm a day forecast against {Mm(r)} mm usual for this farm"
                : "crop water use not known yet");

            var active = waterShort && dry && etHigh;
            return new(active, true, (active ? "Drought mode on: " : "Drought mode off: ") + string.Join("; ", why) + ".");
        }

        // "You have about X L. At normal watering that lasts N days; in drought mode M days."
        public static (int NormalDays, int DroughtDays)? Budget(double litresLeft, double normalLitresPerDay, double droughtLitresPerDay)
        {
            if (litresLeft < 0 || normalLitresPerDay <= 0) return null;
            int Days(double perDay) => perDay <= 0 ? int.MaxValue : (int)Math.Floor(litresLeft / perDay);
            return (Days(normalLitresPerDay), Days(Math.Min(droughtLitresPerDay, normalLitresPerDay)));
        }

        public static string BudgetText(double litresLeft, (int NormalDays, int DroughtDays) b) =>
            $"You have about {Math.Round(litresLeft).ToString("N0", CultureInfo.InvariantCulture).Replace(',', ' ')} L. " +
            $"At normal watering that lasts {DaysText(b.NormalDays)}; in drought mode it lasts {DaysText(b.DroughtDays)}.";

        private static string DaysText(int days) => days == int.MaxValue ? "a long time" : days == 1 ? "1 day" : $"{days} days";
        private static string Percent(double f) => $"{Math.Round(f * 100):0}%";
        private static string Mm(double v) => v.ToString("0.#", CultureInfo.InvariantCulture);
    }

    // Yield response factors (Ky): how much yield a crop loses for a water shortfall in each
    // growth stage, from the FAO water production function (1 - Ya/Yx) = Ky (1 - ETa/ETx).
    //
    // Source: Steduto, P., Hsiao, T.C., Fereres, E. & Raes, D. (2012). Crop yield response to
    // water. FAO Irrigation and Drainage Paper 66, Rome. Chapter 2, "Yield response to water:
    // the original FAO water production function" (pp. 6-13):
    //   - Table 1, "Seasonal Ky values from FAO Irrigation and Drainage Paper No. 33"
    //     (Doorenbos & Kassam 1979): beans 1.15, maize 1.25, potato 1.1, tomato 1.05.
    //   - Table 2, FAO columns Tr-0111 / Tr-1011 / Tr-1101 / Tr-1110 = water deficit in the
    //     initial / crop development / mid-season / late season stage (the FAO-56 stages):
    //     beans 0.20 / 1.10 / 0.75 / 0.20; maize 0.40 / 1.50 / 0.50 / 0.20;
    //     potato 0.60 / (none) / 0.70 / 0.20.
    //   Also in FAO Water Reports 22, "Deficit irrigation practices" (2002), Moutonnet,
    //   "Yield response factors of field crops to deficit irrigation", Table 1.
    // A stage with no published value uses the crop's seasonal value. Lettuce (AgroFlow's
    // "leafy veg") and citrus are not in these tables, so they have no Ky here and drought mode
    // does not cut their water (DroughtPriority.NoFactor). Nothing below is estimated.
    public static class YieldResponse
    {
        public const string Source =
            "FAO Irrigation and Drainage Paper 66 (Steduto et al. 2012), chapter 2, Tables 1 and 2 (from FAO Paper 33, Doorenbos & Kassam 1979)";

        private sealed record CropKy(double Seasonal, double? Initial, double? Development, double? MidSeason, double? LateSeason);

        private static readonly Dictionary<string, CropKy> Table = new()
        {
            ["dry_beans"] = new(1.15, 0.20, 1.10, 0.75, 0.20),
            ["maize"] = new(1.25, 0.40, 1.50, 0.50, 0.20),
            ["potato"] = new(1.10, 0.60, null, 0.70, 0.20),
            ["tomato"] = new(1.05, null, null, null, null),
        };

        public static double? For(string? crop, GrowthStage stage)
        {
            if (crop is null || !Table.TryGetValue(crop, out var k)) return null;
            var stageValue = stage switch
            {
                GrowthStage.Initial => k.Initial,
                GrowthStage.Development => k.Development,
                GrowthStage.MidSeason => k.MidSeason,
                GrowthStage.LateSeason => k.LateSeason,
                _ => null,
            };
            return stageValue ?? k.Seasonal;
        }

        public static bool HasStageValue(string? crop, GrowthStage stage) =>
            crop is not null && Table.TryGetValue(crop, out var k) && stage switch
            {
                GrowthStage.Initial => k.Initial.HasValue,
                GrowthStage.Development => k.Development.HasValue,
                GrowthStage.MidSeason => k.MidSeason.HasValue,
                GrowthStage.LateSeason => k.LateSeason.HasValue,
                _ => false,
            };
    }

    public enum DroughtPriority { Full, Reduced, Skip, NoFactor }

    public static class DroughtStages
    {
        // The engine's farmer-facing stage is the FAO-56 stage by another name
        // (SoilWaterBalance.Stage: L_ini, L_dev, L_mid, L_late), so the mapping is one to one.
        public static GrowthStage From(SeasonStage? stage) => stage switch
        {
            SeasonStage.Establishing => GrowthStage.Initial,
            SeasonStage.Growing => GrowthStage.Development,
            SeasonStage.PeakGrowth => GrowthStage.MidSeason,
            SeasonStage.NearingHarvest => GrowthStage.LateSeason,
            SeasonStage.SeasonComplete => GrowthStage.PastSeasonEnd,
            _ => GrowthStage.NotYetPlanted,
        };
    }

    public sealed record ZoneDroughtAdvice(
        long ZoneId,
        string ZoneName,
        DroughtPriority Priority,
        double Fraction,          // share of the normal amount to give today
        double? Ky,
        double? NormalLitres,     // the engine's own amount (unchanged)
        double? DroughtLitres,    // NormalLitres x Fraction
        string Why);

    public static class DroughtPriorities
    {
        public static ZoneDroughtAdvice For(long zoneId, string zoneName, string? crop, GrowthStage stage,
            double? normalLitres, DroughtSettings s)
        {
            var stageName = StageName(stage);
            if (stage is GrowthStage.NotYetPlanted or GrowthStage.PastSeasonEnd)
                return new(zoneId, zoneName, DroughtPriority.Skip, 0.0, null, normalLitres, normalLitres is null ? null : 0,
                    "It is not in its growing season, so it needs no water today.");
            var ky = YieldResponse.For(crop, stage);
            DroughtPriority p;
            double fraction;
            string why;
            if (ky is null)
            {
                p = DroughtPriority.NoFactor;
                fraction = 1.0;
                why = "AgroFlow has no published yield-response figure for this crop, so its water is not cut.";
            }
            else if (ky >= s.KyFullAt)
            {
                p = DroughtPriority.Full;
                fraction = 1.0;
                why = $"Its {stageName} stage is very sensitive to a water shortfall (FAO Ky {Fmt(ky.Value)}), so it gets full water.";
            }
            else if (ky < s.KySkipBelow)
            {
                p = DroughtPriority.Skip;
                fraction = 0.0;
                why = $"Its {stageName} stage loses little yield from a short dry spell (FAO Ky {Fmt(ky.Value)}), so it can skip today.";
            }
            else
            {
                p = DroughtPriority.Reduced;
                fraction = s.ReducedFraction;
                // FAO water production function: relative yield loss = Ky x relative water shortfall.
                var loss = ky.Value * (1 - s.ReducedFraction);
                why = $"At {Percent(s.ReducedFraction)} water its expected yield loss is about {Percent(loss)} (FAO Ky {Fmt(ky.Value)} x {Percent(1 - s.ReducedFraction)} less water).";
            }
            return new(zoneId, zoneName, p, fraction, ky, normalLitres,
                normalLitres is { } n ? Math.Round(n * fraction, 1) : null, why);
        }

        // "Drought mode on: water Zone 1 fully, Zone 2 at half, skip Zone 3 today."
        public static string Summary(IReadOnlyList<ZoneDroughtAdvice> zones)
        {
            var parts = zones.Select(z => z.Priority switch
            {
                DroughtPriority.Full or DroughtPriority.NoFactor => $"water {z.ZoneName} fully",
                DroughtPriority.Skip => $"skip {z.ZoneName} today",
                _ => Math.Abs(z.Fraction - 0.5) < 1e-9 ? $"{z.ZoneName} at half" : $"{z.ZoneName} at {Percent(z.Fraction)}",
            }).ToList();
            if (parts.Count == 0) return "Drought mode on.";
            var text = parts.Count == 1 ? parts[0] : string.Join(", ", parts.Take(parts.Count - 1)) + ", " + parts[^1];
            return "Drought mode on: " + char.ToLowerInvariant(text[0]) + text[1..] + ".";
        }

        public static string StageName(GrowthStage stage) => stage switch
        {
            // The FAO-56 stages, which FAO-66 Table 2's columns follow (crop development runs
            // up to the start of flowering).
            GrowthStage.Initial => "early",
            GrowthStage.Development => "crop development",
            GrowthStage.MidSeason => "mid-season",
            GrowthStage.LateSeason => "late-season (ripening)",
            _ => "current",
        };

        private static string Fmt(double v) => v.ToString("0.00", CultureInfo.InvariantCulture);
        private static string Percent(double f) => $"{Math.Round(f * 100):0}%";
    }

    // Irrigation type: turns the engine's NET water need into the GROSS amount to apply,
    // gross = net / ea. A separate layer: the FAO-56 engine and PrimaryAction are not changed.
    //
    // Source: Brouwer, C., Prins, K. & Heibloem, M. (1989). Irrigation Water Management:
    // Irrigation Scheduling. FAO Training manual no. 4, Rome. Annex I, Table 8 "Indicative
    // values of the field application efficiency (ea)": surface irrigation (border, furrow,
    // basin) 60%, sprinkler irrigation 75%, drip irrigation 90%.
    // Mapping decisions (the table has three classes): a centre pivot is a sprinkler system, so
    // it uses the sprinkler value; micro-sprinklers are not in the table, so they use the
    // sprinkler value too (the cautious, larger amount); hand watering has no published value,
    // so the net need is shown unchanged.
    public static class ApplicationEfficiency
    {
        public const string Source =
            "FAO Training manual no. 4, Irrigation Scheduling (Brouwer, Prins & Heibloem 1989), Annex I Table 8";

        public static readonly IReadOnlyList<string> Types =
            new[] { "drip", "sprinkler", "micro_sprinkler", "centre_pivot", "surface", "hand" };

        public static double? For(string? irrigationType) => irrigationType switch
        {
            "drip" => 0.90,
            "sprinkler" => 0.75,
            "centre_pivot" => 0.75,
            "micro_sprinkler" => 0.75,
            "surface" => 0.60,
            _ => null,   // hand watering or not set: no published value
        };

        public static double Gross(double netLitres, string? irrigationType) =>
            For(irrigationType) is { } ea ? Math.Round(netLitres / ea, 1) : netLitres;

        // For "Why am I seeing this?".
        public static string Explain(string? irrigationType) => For(irrigationType) is { } ea
            ? $"With {Label(irrigationType)} about {Math.Round(ea * 100):0}% of the water reaches the roots, so AgroFlow adds the rest to the amount (FAO field application efficiency)."
            : irrigationType == "hand"
                ? "Hand watering has no published efficiency figure, so the amount is the crop's own need."
                : "The irrigation type is not set, so the amount is the crop's own need.";

        public static string Label(string? t) => t switch
        {
            "drip" => "drip",
            "sprinkler" => "sprinklers",
            "micro_sprinkler" => "micro-sprinklers",
            "centre_pivot" => "a centre pivot",
            "surface" => "surface or furrow watering",
            "hand" => "hand watering",
            _ => "this system",
        };
    }
}
