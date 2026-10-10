#nullable enable
using System;

namespace AgroFlow.Business.Agronomy
{
    public enum GrowthStage
    {
        Initial,
        Development,
        MidSeason,
        LateSeason,

        // Days after planting is past the end of the tabulated season. Not an error: the
        // farmer may not have updated the planting date after harvest. The advisor says so
        // instead of extending the Kc curve past the table.
        PastSeasonEnd,

        // Planting date is in the future relative to the day being assessed.
        NotYetPlanted,
    }

    // The result of placing one zone on its crop's FAO-56 coefficient curve.
    public sealed class StageAssessment
    {
        public GrowthStage Stage { get; }
        public int DaysAfterPlanting { get; }
        public int DayWithinStage { get; }       // 0-based
        public int StageLengthDays { get; }
        public int DaysRemainingInStage { get; }
        public int SeasonLengthDays { get; }
        public double Kc { get; }

        // Where this Kc came from, in plain words, so every number the farmer sees can be
        // traced to a table or an interpolation.
        public string KcBasis { get; }

        public StageAssessment(
            GrowthStage stage, int daysAfterPlanting, int dayWithinStage, int stageLengthDays,
            int daysRemainingInStage, int seasonLengthDays, double kc, string kcBasis)
        {
            Stage = stage;
            DaysAfterPlanting = daysAfterPlanting;
            DayWithinStage = dayWithinStage;
            StageLengthDays = stageLengthDays;
            DaysRemainingInStage = daysRemainingInStage;
            SeasonLengthDays = seasonLengthDays;
            Kc = kc;
            KcBasis = kcBasis;
        }

        public string StageDisplayName
        {
            get
            {
                switch (Stage)
                {
                    case GrowthStage.Initial: return "Initial";
                    case GrowthStage.Development: return "Crop development";
                    case GrowthStage.MidSeason: return "Mid-season";
                    case GrowthStage.LateSeason: return "Late season";
                    case GrowthStage.PastSeasonEnd: return "Past season end";
                    case GrowthStage.NotYetPlanted: return "Not yet planted";
                    default: return Stage.ToString();
                }
            }
        }

        public bool IsWithinSeason
        {
            get { return Stage == GrowthStage.Initial || Stage == GrowthStage.Development
                         || Stage == GrowthStage.MidSeason || Stage == GrowthStage.LateSeason; }
        }
    }

    // Places (planting date, today) on the FAO-56 four-stage crop coefficient curve
    // for a crop, and works out Kc for the day.
    // The curve, per FAO-56 Chapter 6 (Figure 24, p. 97):
    //
    //   Kc |          ,--------------.
    //      |        ,'                `.
    //      |  _____,                    `------
    //      |  Kc_ini                            Kc_end
    //      +-------------------------------------------> days
    //        initial | development |  mid  |  late
    //
    // Kc is flat through initial and mid-season, and changes linearly through
    // development (Kc_ini -> Kc_mid) and late season (Kc_mid -> Kc_end).
    // Day convention: the planting day is day-after-planting 0. A stage boundary belongs
    // to the stage it opens: at dap == L_ini the crop is on its first day of development.
    public static class GrowthStageCalculator
    {
        public static StageAssessment Assess(Fao56Crop crop, DateOnly plantingDate, DateOnly asOf)
        {
            if (crop == null) throw new ArgumentNullException(nameof(crop));

            var dap = asOf.DayNumber - plantingDate.DayNumber;
            var lengths = crop.StageLengths;
            var season = lengths.TotalDays;

            if (dap < 0)
            {
                return new StageAssessment(
                    GrowthStage.NotYetPlanted, dap, 0, 0, 0, season, crop.Kc.Initial,
                    "Planting date is " + (-dap) + " day(s) in the future; no crop in the ground yet.");
            }

            if (dap >= season)
            {
                return new StageAssessment(
                    GrowthStage.PastSeasonEnd, dap, 0, 0, 0, season, crop.Kc.End,
                    "Day " + dap + " is past the end of the " + season + "-day season in " + crop.StageLengthsCite +
                    ". Kc is held at Kc_end rather than extrapolated off the end of the table.");
            }

            // Initial: Kc flat at Kc_ini.
            if (dap < lengths.DevelopmentStartsAtDap)
            {
                return new StageAssessment(
                    GrowthStage.Initial, dap, dap, lengths.InitialDays,
                    lengths.InitialDays - dap, season, crop.Kc.Initial,
                    "Kc is constant at Kc_ini = " + Fao56Knowledge.Format(crop.Kc.Initial, 2) +
                    " through the initial stage (" + crop.KcCite + ").");
            }

            // Development: Kc rises linearly Kc_ini -> Kc_mid.
            if (dap < lengths.MidSeasonStartsAtDap)
            {
                var dayWithin = dap - lengths.DevelopmentStartsAtDap;
                var fraction = (double)dayWithin / lengths.DevelopmentDays;
                var kc = crop.Kc.Initial + (crop.Kc.MidSeason - crop.Kc.Initial) * fraction;

                return new StageAssessment(
                    GrowthStage.Development, dap, dayWithin, lengths.DevelopmentDays,
                    lengths.DevelopmentDays - dayWithin, season, kc,
                    "Kc interpolated linearly from Kc_ini " + Fao56Knowledge.Format(crop.Kc.Initial, 2) +
                    " to Kc_mid " + Fao56Knowledge.Format(crop.Kc.MidSeason, 2) +
                    ", " + Fao56Knowledge.Format(fraction * 100.0, 0) + "% through a " +
                    lengths.DevelopmentDays + "-day development stage (" + crop.KcCite + ").");
            }

            // Mid-season: Kc flat at its maximum.
            if (dap < lengths.LateSeasonStartsAtDap)
            {
                var dayWithin = dap - lengths.MidSeasonStartsAtDap;
                return new StageAssessment(
                    GrowthStage.MidSeason, dap, dayWithin, lengths.MidSeasonDays,
                    lengths.MidSeasonDays - dayWithin, season, crop.Kc.MidSeason,
                    "Kc is constant at Kc_mid = " + Fao56Knowledge.Format(crop.Kc.MidSeason, 2) +
                    " through mid-season (" + crop.KcCite + ").");
            }

            // Late season: Kc falls linearly Kc_mid -> Kc_end.
            {
                var dayWithin = dap - lengths.LateSeasonStartsAtDap;
                var fraction = (double)dayWithin / lengths.LateSeasonDays;
                var kc = crop.Kc.MidSeason + (crop.Kc.End - crop.Kc.MidSeason) * fraction;

                return new StageAssessment(
                    GrowthStage.LateSeason, dap, dayWithin, lengths.LateSeasonDays,
                    lengths.LateSeasonDays - dayWithin, season, kc,
                    "Kc interpolated linearly from Kc_mid " + Fao56Knowledge.Format(crop.Kc.MidSeason, 2) +
                    " to Kc_end " + Fao56Knowledge.Format(crop.Kc.End, 2) +
                    ", " + Fao56Knowledge.Format(fraction * 100.0, 0) + "% through a " +
                    lengths.LateSeasonDays + "-day late season (" + crop.KcCite + ").");
            }
        }

        // Kc on a future day, used for the "water demand will rise" warning.
        // Returns null once the lookahead runs past the end of the season.
        public static double? KcOnDay(Fao56Crop crop, DateOnly plantingDate, DateOnly futureDay)
        {
            var assessment = Assess(crop, plantingDate, futureDay);
            return assessment.IsWithinSeason ? assessment.Kc : (double?)null;
        }

        // The next stage the crop will enter, and how many days until it does.
        // Null at or past the last stage.
        public static StageTransition? NextTransition(Fao56Crop crop, StageAssessment current)
        {
            if (!current.IsWithinSeason) return null;

            GrowthStage next;
            double kcAtNextStageStart;

            switch (current.Stage)
            {
                case GrowthStage.Initial:
                    next = GrowthStage.Development;
                    // Development starts at Kc_ini and climbs, so for "demand will rise" we compare with
                    // the value at the start of mid-season.
                    kcAtNextStageStart = crop.Kc.Initial;
                    break;
                case GrowthStage.Development:
                    next = GrowthStage.MidSeason;
                    kcAtNextStageStart = crop.Kc.MidSeason;
                    break;
                case GrowthStage.MidSeason:
                    next = GrowthStage.LateSeason;
                    kcAtNextStageStart = crop.Kc.MidSeason;
                    break;
                default:
                    return null; // late season ends at harvest, not at another stage
            }

            return new StageTransition(next, current.DaysRemainingInStage, kcAtNextStageStart);
        }
    }

    public sealed class StageTransition
    {
        public GrowthStage NextStage { get; }
        public int DaysUntil { get; }
        public double KcAtStart { get; }

        public StageTransition(GrowthStage nextStage, int daysUntil, double kcAtStart)
        {
            NextStage = nextStage;
            DaysUntil = daysUntil;
            KcAtStart = kcAtStart;
        }
    }
}
