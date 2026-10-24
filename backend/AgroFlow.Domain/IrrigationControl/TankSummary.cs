#nullable enable

namespace AgroFlow.Business;

// One answer to "what do we know about this farm's tank?" for every screen (AF-06): Home's water
// budget, the Tank screen, the setup tasks and the zone tiles all read this instead of each
// guessing, so a saved 2 500 L tank is never called "not set up" because the budget could not be
// worked out. Missing names the one input that is lacking.
public static class TankSummary
{
    // Missing values, in the order they are asked for.
    public const string NotATankFarm = "not_a_tank_farm";   // the water is a borehole, municipal, river...
    public const string NoTank = "no_tank";                 // no capacity saved and no water source chosen
    public const string LevelUnknown = "level_unknown";     // capacity saved, never a level or refill
    public const string UseUnknown = "use_unknown";         // a level, but no watering history or advice to divide by
    public const string Complete = "complete";

    public sealed record View(string State, bool HasTank, double? CapacityLitres, double? RemainingLitres, string? Missing);

    public static View Describe(string? waterSource, double? capacityLitres, double? remainingLitres, double? litresPerDay)
    {
        var cap = capacityLitres is > 0 ? capacityLitres : null;
        if (waterSource is not null and not "tank" && cap is null)
            return new View(NotATankFarm, false, null, null, null);
        if (cap is null)
            return new View(NoTank, false, null, null, "capacity");
        if (remainingLitres is null)
            return new View(LevelUnknown, true, cap, null, "level");
        if (litresPerDay is not > 0)
            return new View(UseUnknown, true, cap, remainingLitres, "daily_use");
        return new View(Complete, true, cap, remainingLitres, null);
    }
}
