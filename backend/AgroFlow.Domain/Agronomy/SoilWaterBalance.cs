#nullable enable
using System;

namespace AgroFlow.Business.Agronomy
{
    // The FAO-56 root-zone soil water balance: Kc through the season, TAW/RAW from
    // soil texture and rooting depth, the daily depletion Dr, and the water-stress
    // coefficient Ks.
    //
    // Pure arithmetic throughout - every method is a function of its arguments
    // only, so the book's worked examples (Examples 28, 36, 37) run straight
    // through it. See Fao56EngineVerificationTests.
    //
    // Equation numbers are FAO-56 (Allen et al., 1998).
    public static class SoilWaterBalance
    {
        // -------------------------------------------------------------------
        // Kc through the season - FAO-56 Eq. 66, p. 132
        // -------------------------------------------------------------------
        // Constant at Kc_ini through the initial stage; a straight line up to
        // Kc_mid across the development stage; constant at Kc_mid through
        // mid-season; a straight line to Kc_end across the late season.
        //
        // dayOfSeason is 1-based: day 1 is the planting date (spec section 6.1,
        // i = (today - planting_date).Days + 1).
        //
        // Past the end of the season Kc_end is held, and the caller flags
        // season_complete. Kc is never extrapolated past Kc_end.
        public static double Kc(
            double kcIni, double kcMid, double kcEnd,
            int lIni, int lDev, int lMid, int lLate,
            int dayOfSeason)
        {
            if (dayOfSeason < 1) return kcIni;

            // dayOfSeason is used directly against the cumulative stage lengths,
            // which is the convention FAO-56's own worked example uses: Example 28
            // (stages 25/25/30/20, Kc 0.15/1.19/0.35) gives Kc = 0.77 on day 40,
            // which is (40 - 25) / 25 of the way from Kc_ini to Kc_mid. Counting
            // day 40 as 39 days after planting would give 0.73 instead.
            var dap = dayOfSeason;

            if (dap < lIni) return kcIni;

            var devEnd = lIni + lDev;
            if (dap < devEnd)
            {
                if (lDev <= 0) return kcMid;
                var throughDev = (double)(dap - lIni) / lDev;
                return kcIni + throughDev * (kcMid - kcIni);
            }

            var midEnd = devEnd + lMid;
            if (dap < midEnd) return kcMid;

            var lateEnd = midEnd + lLate;
            if (dap < lateEnd)
            {
                if (lLate <= 0) return kcEnd;
                var throughLate = (double)(dap - midEnd) / lLate;
                return kcMid + throughLate * (kcEnd - kcMid);
            }

            return kcEnd;
        }

        // Which stage a day falls in, in the farmer's vocabulary (spec 5c).
        //
        // Boundaries are inclusive at the top so that the last day of a stage
        // still reads as that stage - day 25 of a 25-day initial stage is the last
        // day of Establishing, not the first day of Growing. Season complete is
        // i > total, matching the season_complete insight trigger in spec 7.
        public static SeasonStage Stage(int lIni, int lDev, int lMid, int lLate, int dayOfSeason)
        {
            if (dayOfSeason <= lIni) return SeasonStage.Establishing;
            if (dayOfSeason <= lIni + lDev) return SeasonStage.Growing;
            if (dayOfSeason <= lIni + lDev + lMid) return SeasonStage.PeakGrowth;
            if (dayOfSeason <= lIni + lDev + lMid + lLate) return SeasonStage.NearingHarvest;
            return SeasonStage.SeasonComplete;
        }

        // -------------------------------------------------------------------
        // p adjusted for the day's ETc
        // -------------------------------------------------------------------
        // Table 22 footnote: p = p_Table22 + 0.04 (5 - ETc), limited to
        // 0.1 <= p <= 0.8, with ETc in mm/day (FAO-56 p. 162).
        //
        // The soil factor is applied to the TABULATED p before the ETc term, per
        // spec section 6.5: p_adj = clamp(p * soilFactor + 0.04 * (5 - ETc), 0.1, 0.8).
        // FAO-56 Chapter 8 allows p to be cut for clay and raised for sand; the
        // 5% used here is an ASSUMPTION recorded in the report.
        public const double MinDepletionFraction = 0.1;
        public const double MaxDepletionFraction = 0.8;

        public static double AdjustP(double tabulatedP, double soilFactor, double etcMmPerDay)
        {
            var adjusted = tabulatedP * soilFactor + 0.04 * (5.0 - etcMmPerDay);
            if (adjusted < MinDepletionFraction) return MinDepletionFraction;
            if (adjusted > MaxDepletionFraction) return MaxDepletionFraction;
            return adjusted;
        }

        // -------------------------------------------------------------------
        // Rooting depth
        // -------------------------------------------------------------------
        // The Table 22 figure, capped by any physical root-zone boundary
        // (spec section 6.6). A 1.0 m maize root zone in 0.3 m of available
        // soil would otherwise claim more water than the root zone can hold.
        public static double EffectiveRootDepthM(double tableRootDepthM, double? rootDepthLimitM)
        {
            if (!rootDepthLimitM.HasValue) return tableRootDepthM;
            if (rootDepthLimitM.Value <= 0.0) return tableRootDepthM;
            return Math.Min(tableRootDepthM, rootDepthLimitM.Value);
        }

        // -------------------------------------------------------------------
        // TAW / RAW - FAO-56 Eq. 82 and Eq. 83, p. 162
        // -------------------------------------------------------------------
        // TAW = 1000 (theta_FC - theta_WP) Zr   [mm]
        public static double TotalAvailableWaterMm(double thetaFc, double thetaWp, double rootDepthM)
        {
            return 1000.0 * (thetaFc - thetaWp) * rootDepthM;
        }

        // RAW = p TAW   [mm]
        public static double ReadilyAvailableWaterMm(double adjustedP, double tawMm)
        {
            return adjustedP * tawMm;
        }

        // -------------------------------------------------------------------
        // Daily water balance - FAO-56 Eq. 85, p. 170
        // -------------------------------------------------------------------
        // Dr_i = Dr_{i-1} - (P_i - RO_i) - I_i - CR_i + ETc_i + DP_i
        //
        // Runoff (RO) and capillary rise (CR) are taken as zero, per spec section
        // 6.8. Deep percolation (DP) is handled by the clamp at zero: Eq. 88 says
        // water in excess of field capacity drains, which is exactly what
        // "depletion cannot go below zero" expresses. The clamp at TAW stops the
        // profile drying past wilting point, which it physically cannot.
        public static double NextDepletionMm(
            double previousDepletionMm,
            double rainfallMm,
            double irrigationMm,
            double etcAdjustedMm,
            double tawMm)
        {
            var dr = previousDepletionMm - rainfallMm - irrigationMm + etcAdjustedMm;
            if (dr < 0.0) return 0.0;
            if (dr > tawMm) return tawMm;
            return dr;
        }

        // Rain below this multiple of ETo is ignored (spec section 6.8): a trace of
        // rain evaporates rather than reaching the root zone, so crediting it
        // against depletion would overstate how wet the soil is.
        public const double RainIgnoreFractionOfEto = 0.2;

        public static double EffectiveRainfallMm(double rainfallMm, double etoMmPerDay)
        {
            if (rainfallMm <= 0.0) return 0.0;
            return rainfallMm < RainIgnoreFractionOfEto * etoMmPerDay ? 0.0 : rainfallMm;
        }

        // -------------------------------------------------------------------
        // Water stress coefficient Ks - FAO-56 Eq. 84, p. 169
        // -------------------------------------------------------------------
        //         TAW - Dr
        //   Ks = -----------      for Dr > RAW;   Ks = 1 otherwise.
        //        (1 - p) TAW
        //
        // Ks < 1 means the crop is drawing water harder than it can replace it and
        // transpiration is being suppressed - i.e. it had a stressed day.
        public static double StressCoefficient(double depletionMm, double tawMm, double rawMm, double adjustedP)
        {
            if (depletionMm <= rawMm) return 1.0;
            if (tawMm <= 0.0) return 1.0;

            var denominator = (1.0 - adjustedP) * tawMm;
            if (denominator <= 0.0) return 0.0;

            var ks = (tawMm - depletionMm) / denominator;
            if (ks < 0.0) return 0.0;
            if (ks > 1.0) return 1.0;
            return ks;
        }

        // ETc adjusted for water stress - FAO-56 Eq. 81, p. 161: ETc_adj = Ks Kc ETo.
        public static double StressAdjustedEtcMm(double ksCoefficient, double etcMm)
        {
            return ksCoefficient * etcMm;
        }

        // -------------------------------------------------------------------
        // Anchoring Dr to a soil moisture reading
        // -------------------------------------------------------------------
        // Relative moisture % from a raw sensor reading and the zone's wet/dry
        // calibration points, clamped 0-100.
        //
        // The probe is resistive: a WETTER soil conducts better, so the raw ADC
        // value FALLS as moisture rises. The formula is written against the
        // calibration points rather than against an assumed direction, so it works
        // whichever way round the two points sit.
        public static double? RelativeMoisturePercent(double reading, double? calibrationWet, double? calibrationDry)
        {
            if (!calibrationWet.HasValue || !calibrationDry.HasValue) return null;

            var wet = calibrationWet.Value;
            var dry = calibrationDry.Value;
            var span = wet - dry;
            if (Math.Abs(span) < 1e-9) return null;

            var percent = (reading - dry) / span * 100.0;
            if (percent < 0.0) return 0.0;
            if (percent > 100.0) return 100.0;
            return percent;
        }

        // Dr implied by a relative moisture reading: a linear stand-in for FAO-56
        // Eq. 87 (Dr = 1000 (theta_FC - theta) Zr), which needs a volumetric
        // moisture content the resistive probe cannot give.
        //
        // ASSUMPTION, recorded in the report: relative dryness is treated as
        // proportional to depletion. The probe reads relative conductivity, not
        // volumetric water content, so this is a mapping and not a measurement.
        public static double DepletionFromRelativeMoistureMm(double relativeMoisturePercent, double tawMm)
        {
            var dryness = 1.0 - relativeMoisturePercent / 100.0;
            if (dryness < 0.0) dryness = 0.0;
            if (dryness > 1.0) dryness = 1.0;
            return dryness * tawMm;
        }

        // -------------------------------------------------------------------
        // Turning a depletion into an irrigation instruction
        // -------------------------------------------------------------------
        // Litres to refill the root zone: a depth of water over the zone's area.
        // 1 mm over 1 m2 is 1 litre, so litres = Dr [mm] * area [m2].
        //
        // Net irrigation never exceeds Dr (spec section 6.12): watering past field
        // capacity drains away, so advising more would waste it.
        public static double? IrrigationLitres(double depletionMm, double? areaM2)
        {
            if (!areaM2.HasValue || areaM2.Value <= 0.0) return null;
            if (depletionMm <= 0.0) return 0.0;
            return depletionMm * areaM2.Value;
        }

        // Whole minutes, rounded up: a part-minute of pump time is not something a
        // farmer can act on, and rounding down would under-water.
        public static int? IrrigationMinutes(double? litres, double? flowRateLpm)
        {
            if (!litres.HasValue) return null;
            if (!flowRateLpm.HasValue || flowRateLpm.Value <= 0.0) return null;
            if (litres.Value <= 0.0) return 0;
            return (int)Math.Ceiling(litres.Value / flowRateLpm.Value);
        }

        // Irrigation depth applied by a run, for the water balance: litres spread
        // over the zone area, in mm.
        public static double? IrrigationDepthMm(double? litres, double? areaM2)
        {
            if (!litres.HasValue) return null;
            if (!areaM2.HasValue || areaM2.Value <= 0.0) return null;
            return litres.Value / areaM2.Value;
        }
    }
}
