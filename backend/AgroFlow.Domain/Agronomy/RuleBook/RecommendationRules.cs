#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    /// <summary>What "Recommended for you" says for one zone.</summary>
    public sealed class Recommendation
    {
        public string CropKey { get; set; } = "";
        public string CropLabel { get; set; } = "";
        public string SoilLabel { get; set; } = "";
        public string SoilKey { get; set; } = "";
        public bool SoilAssumed { get; set; }
        public bool StageAssumed { get; set; }

        /// <summary>Mean ETo used, mm/day; null when the farm has no weather yet.</summary>
        public double? MeanEtoMm { get; set; }
        /// <summary>"the last 30 days", "the forecast" - where the ETo came from.</summary>
        public string? EtoBasis { get; set; }

        public double Kc { get; set; }
        public double? EtcMm { get; set; }
        public double RootDepthM { get; set; }
        public double TawMm { get; set; }
        public double RawMm { get; set; }

        /// <summary>Relative moisture to water at: (1 − p × soil factor) × 100, whole %.</summary>
        public int ThresholdPercent { get; set; }
        /// <summary>Relative moisture to stop at: always 100 (field capacity).</summary>
        public int StopPercent { get; set; } = 100;

        public int? IntervalDaysLow { get; set; }
        public int? IntervalDaysHigh { get; set; }
        public int? Minutes { get; set; }
        public double? Litres { get; set; }

        public Confidence Confidence { get; set; } = new Confidence(ConfidenceLevel.Low, "Low: not worked out yet.");

        /// <summary>The card's sentence.</summary>
        public string Text { get; set; } = "";
    }

    // Item 6b: "Recommended for you" - thresholds and an expected rhythm from
    // the farm's climate, the crop and the soil, in one plain sentence.
    //
    // Every number comes from the same rules the daily advice uses, so the
    // card never promises something the advice then contradicts:
    //   threshold %  = (1 − p × soil factor) × 100   - exactly what "Reset to
    //                  recommended" saves (Table 22 p, p. 167 soil adjust,
    //                  clamp 0.1-0.8 p. 162)
    //   interval     = RAW ÷ ETc, ETc = Kc × ETo     - Eqs 58 (p. 103), 83 (p. 162)
    //   minutes      = RAW × area ÷ flow              - Ch. 1 p. 3, rounded up
    public static class RecommendationRules
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        /// <summary>
        /// The ETc Table 22's p values are given for (FAO-56 Table 22 footnote, p. 163: "The
        /// values for p apply for ETc ≈ 5 mm/day"). Used for RAW when the
        /// farm has no weather yet, so the 0.04 × (5 − ETc) correction is zero.
        /// </summary>
        public const double Table22EtcMm = 5.0;

        /// <summary>
        /// DATA RULE: at least this many days of measured ETo before the
        /// history is used; with fewer, the forecast stands in (item 6b: "the
        /// last 14-30 days, or the forecast if history is short").
        /// </summary>
        public const int MinHistoryDays = 14;

        /// <summary>Which ETo to use, and how to describe it.</summary>
        public static (double? MeanEto, string? Basis) PickEto(long historyDays, double? historyMean, double? forecastMean)
        {
            if (historyDays >= MinHistoryDays && historyMean is > 0) return (historyMean, "the last 30 days");
            if (forecastMean is > 0) return (forecastMean, "the forecast");
            if (historyMean is > 0) return (historyMean, "the last " + historyDays.ToString(Inv) + " days");
            return (null, null);
        }

        public static Recommendation? For(
            string? cropType, string? soilType, int? dayOfSeason, double? meanEtoMm, string? etoBasis,
            double? areaM2, double? flowRateLpm, double? rootDepthLimitM, string? place, DateOnly month)
        {
            var crop = Fao56EngineReference.TryResolveCrop(cropType);
            if (crop == null) return null;

            var soil = SoilRules.WaterHoldingFor(soilType);
            var stageAssumed = !dayOfSeason.HasValue;
            var kc = stageAssumed ? CropRules.KcWhenStageUnknown(crop) : CropRules.KcFor(crop, dayOfSeason!.Value);

            var r = new Recommendation
            {
                CropKey = crop.Key,
                CropLabel = crop.Label,
                SoilLabel = soil.Soil.Label,
                SoilKey = soil.Soil.Key,
                SoilAssumed = soil.Assumed,
                StageAssumed = stageAssumed,
                MeanEtoMm = meanEtoMm is > 0 ? meanEtoMm : null,
                EtoBasis = meanEtoMm is > 0 ? etoBasis : null,
                Kc = kc,
            };

            // Threshold: the same p × soil factor that "Reset to recommended" saves.
            var pr = Clamp(crop.DepletionFractionP * soil.Soil.PFactor);
            r.ThresholdPercent = (int)Math.Round((1.0 - pr) * 100.0, MidpointRounding.AwayFromZero);

            // RAW for the rhythm and the minutes: what the daily balance uses.
            r.EtcMm = r.MeanEtoMm.HasValue ? kc * r.MeanEtoMm.Value : (double?)null;
            var pAdjusted = SoilWaterBalance.AdjustP(crop.DepletionFractionP, soil.Soil.PFactor, r.EtcMm ?? Table22EtcMm);
            r.RootDepthM = SoilWaterBalance.EffectiveRootDepthM(crop.RootDepthM, rootDepthLimitM);
            r.TawMm = SoilRules.TotalAvailableWaterMm(soil, r.RootDepthM);
            r.RawMm = SoilWaterBalance.ReadilyAvailableWaterMm(pAdjusted, r.TawMm);

            if (r.EtcMm is > 0)
            {
                var days = r.RawMm / r.EtcMm.Value;
                r.IntervalDaysLow = Math.Max(1, (int)Math.Floor(days));
                r.IntervalDaysHigh = Math.Max(1, (int)Math.Ceiling(days));
            }

            r.Litres = SoilWaterBalance.IrrigationLitres(r.RawMm, areaM2);
            r.Minutes = WaterRules.MinutesToRun(r.RawMm, areaM2, flowRateLpm);

            r.Confidence = ConfidenceFor(r);
            r.Text = Sentence(r, place, areaM2, month);
            return r;
        }

        private static double Clamp(double p) =>
            p < SoilWaterBalance.MinDepletionFraction ? SoilWaterBalance.MinDepletionFraction
            : p > SoilWaterBalance.MaxDepletionFraction ? SoilWaterBalance.MaxDepletionFraction
            : p;

        /// <summary>
        /// DATA RULE: High only with measured climate, a planting date and a
        /// chosen soil; no weather at all is Low; anything assumed is Medium.
        /// </summary>
        public static Confidence ConfidenceFor(Recommendation r)
        {
            if (!r.MeanEtoMm.HasValue)
                return new Confidence(ConfidenceLevel.Low, "Low: there is no weather for this farm yet, so how often to water is not known.");

            var missing = new List<string>();
            if (r.StageAssumed) missing.Add("the planting date is missing, so peak growth is assumed");
            if (r.SoilAssumed) missing.Add("the soil type is missing, so loam is assumed");

            if (missing.Count == 0 && r.EtoBasis == "the last 30 days")
                return new Confidence(ConfidenceLevel.High, "High: your farm's own weather, crop stage and soil.");

            if (missing.Count == 0)
                return new Confidence(ConfidenceLevel.Medium, "Medium: based on " + r.EtoBasis + ", as the farm has little weather history yet.");

            return new Confidence(ConfidenceLevel.Medium, "Medium: " + missing[0] + ".");
        }

        private static string Sentence(Recommendation r, string? place, double? areaM2, DateOnly month)
        {
            var climate = string.IsNullOrWhiteSpace(place) ? "your climate" : "your climate in " + place!.Trim();
            var soil = r.SoilAssumed ? "garden soil (loam, assumed)" : r.SoilKey + " soil";

            var s = "Based on " + climate + " and since you want to grow " + r.CropLabel.ToLowerInvariant() + " on " + soil +
                    ", we recommend: water when the soil reaches about " + r.ThresholdPercent.ToString(Inv) +
                    "% (relative), stop at " + r.StopPercent.ToString(Inv) + "%";

            if (r.IntervalDaysLow.HasValue)
            {
                var every = r.IntervalDaysLow == r.IntervalDaysHigh
                    ? (r.IntervalDaysLow == 1 ? "every day" : "every " + r.IntervalDaysLow.Value.ToString(Inv) + " days")
                    : "every " + r.IntervalDaysLow.Value.ToString(Inv) + "–" + r.IntervalDaysHigh!.Value.ToString(Inv) + " days";
                s += "; expect to water about " + every + " in " + month.ToString("MMMM", Inv);
            }

            if (r.Minutes is > 0 && areaM2.HasValue)
            {
                s += ", about " + r.Minutes.Value.ToString(Inv) + " minutes each time for " + AreaWords(areaM2.Value);
            }
            else if (r.Litres is > 0 && areaM2.HasValue)
            {
                s += ", about " + Math.Round(r.Litres.Value).ToString("0", Inv) + " litres each time for " + AreaWords(areaM2.Value);
            }

            s += ".";
            if (!r.IntervalDaysLow.HasValue)
                s += " How often to water will show once the farm's weather has been collected.";
            return s;
        }

        private static string AreaWords(double m2) =>
            m2 < 1 ? "a " + m2.ToString("0.##", Inv) + " m² tub" : m2.ToString("0.##", Inv) + " m²";
    }
}
