#nullable enable
using System;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    // Soil rules: how much water a soil holds and how far it can dry.
    // The values are read from Fao56EngineReference (FAO-56 Table 19 and the Chapter 8
    // soil adjustment), never copied here. A test checks these match the table.

    /// <summary>What a soil holds, and whether it was assumed.</summary>
    public sealed class SoilWaterHolding
    {
        public SoilWaterHolding(Fao56SoilClass soil, bool assumed)
        {
            Soil = soil;
            Assumed = assumed;
        }

        public Fao56SoilClass Soil { get; }

        /// <summary>Volumetric water content at field capacity (m³/m³).</summary>
        public double ThetaFieldCapacity => Soil.ThetaFieldCapacity;

        /// <summary>Volumetric water content at wilting point (m³/m³).</summary>
        public double ThetaWiltingPoint => Soil.ThetaWiltingPoint;

        /// <summary>True when no usable soil type was set and garden soil (loam) stood in.</summary>
        public bool Assumed { get; }
    }

    public static class SoilRules
    {
        /// <summary>
        /// Field capacity and wilting point for a soil type.
        /// </summary>
        /// <remarks>
        /// FAO-56 Table 19 (p. 144), midpoints of the published ranges for
        /// sand, loam and clay. No soil type, or one we hold no figures for,
        /// gives loam - DATA RULE: loam sits between sand and clay in Table 19,
        /// so the error from assuming it is bounded and goes either way. The
        /// result says when it was assumed, so it is always labelled.
        /// </remarks>
        public static SoilWaterHolding WaterHoldingFor(string? soilType)
        {
            var soil = Fao56EngineReference.TryResolveSoil(soilType);
            return soil != null
                ? new SoilWaterHolding(soil, assumed: false)
                : new SoilWaterHolding(Fao56EngineReference.DefaultSoil, assumed: true);
        }

        /// <summary>
        /// The multiplier on the crop's depletion fraction p for this soil:
        /// sand ×1.05, loam ×1.00, clay ×0.95.
        /// </summary>
        /// <remarks>
        /// FAO-56 Chapter 8 (p. 167): "for fine textured soils (clay) the p
        /// values listed in Table 22 can be reduced by 5-10%, while for more
        /// coarse textured soils (sand), they can be increased by 5-10%."
        /// The low end, 5%, is used - DATA RULE: the smaller change is the
        /// cautious one when the soil type itself may only be a farmer's guess.
        /// </remarks>
        public static double DepletionFactorAdjust(string? soilType)
        {
            return WaterHoldingFor(soilType).Soil.PFactor;
        }

        /// <summary>Total available water in the root zone, in mm.</summary>
        /// <remarks>FAO-56 Eq. 82 (p. 162): TAW = 1000 (θFC − θWP) Zr.</remarks>
        public static double TotalAvailableWaterMm(SoilWaterHolding soil, double rootDepthM)
        {
            if (soil == null) throw new ArgumentNullException(nameof(soil));
            return SoilWaterBalance.TotalAvailableWaterMm(soil.ThetaFieldCapacity, soil.ThetaWiltingPoint, rootDepthM);
        }
    }
}
