#nullable enable

namespace AgroFlow.Business.Agronomy.RuleBook
{
    public enum WateringVerdict
    {
        /// <summary>Nothing to judge against: the crop needed nothing, or the need is unknown.</summary>
        Unknown,
        TooLittle,
        AboutRight,
        TooMuch,
    }

    // Verdict rules: was the water a zone got about right?
    // Every rule here is a DATA RULE. FAO-56 says how much water a crop uses (ETc,
    // Eq. 58 p. 103), not how far from that is acceptable; these bands are our judgement.
    public static class VerdictRules
    {
        // DATA RULE: more than 20% over the crop's use is too much. Pump litres are estimates
        // (run time x flow rate, no flow meter), so a smaller margin would flag noise.
        public const double OverwaterRatio = 1.2;

        // DATA RULE: less than 80% of the crop's use is too little; the same 20% margin.
        public const double UnderwaterRatio = 0.8;

        /// <summary>Too little / About right / Too much, for water applied against water needed.</summary>
        /// <remarks>
        /// Applied and needed in the same unit (litres, or mm). Exactly
        /// <see cref="OverwaterRatio"/> or <see cref="UnderwaterRatio"/> times
        /// the need is still About right: only past the margin is it flagged.
        /// With no need (0) or a negative figure, there is nothing to judge.
        /// </remarks>
        public static WateringVerdict For(double appliedL, double neededL)
        {
            if (neededL <= 0.0 || appliedL < 0.0) return WateringVerdict.Unknown;
            if (appliedL > OverwaterRatio * neededL) return WateringVerdict.TooMuch;
            if (appliedL < UnderwaterRatio * neededL) return WateringVerdict.TooLittle;
            return WateringVerdict.AboutRight;
        }

        /// <summary>The verdict in the farmer's words.</summary>
        public static string Label(WateringVerdict verdict)
        {
            switch (verdict)
            {
                case WateringVerdict.TooLittle: return "Too little";
                case WateringVerdict.AboutRight: return "About right";
                case WateringVerdict.TooMuch: return "Too much";
                default: return "Not enough to judge";
            }
        }
    }
}
