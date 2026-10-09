#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace AgroFlow.Business.Agronomy
{
    public enum IrrigationPlanChangeKind
    {
        IrrigationNowRequired,
        IrrigationNoLongerRequired,
        MovedEarlier,
        MovedLater,
        AmountIncreased,
        AmountReduced,
        PostponeForRain,
        RainNoLongerSufficient,
    }

    public sealed record IrrigationPlanChange(
        IrrigationPlanChangeKind Kind,
        string Message,
        DateOnly? OldDate = null,
        DateOnly? NewDate = null);

    // Pure, testable material-change policy. Small numerical forecast movement
    // is intentionally ignored; alerts are about changed farmer decisions.
    public static class IrrigationPlanChangeDetector
    {
        public const double MaterialDepthChangeMm = 5.0;
        public const double MaterialDepthChangeFraction = 0.25;

        public static IrrigationPlanChange? Compare(
            string zoneName,
            IReadOnlyList<RollingIrrigationDay> previous,
            IReadOnlyList<RollingIrrigationDay> current)
        {
            var oldToday = previous.FirstOrDefault();
            var newToday = current.FirstOrDefault();
            if (oldToday == null || newToday == null) return null;

            var oldWaters = Waters(oldToday.Action);
            var newWaters = Waters(newToday.Action);

            if (oldToday.Action == IrrigationPrimaryAction.PostponeForRain && newWaters)
                return new(IrrigationPlanChangeKind.RainNoLongerSufficient,
                    $"Rainfall forecast has dropped. Expected rain is no longer enough for {zoneName}; irrigation is now likely.");

            if (oldWaters && newToday.Action == IrrigationPrimaryAction.PostponeForRain)
                return new(IrrigationPlanChangeKind.PostponeForRain,
                    $"Expected rain now covers {zoneName}'s projected deficit. Postpone irrigation and reassess after rain.");

            if (!oldWaters && newWaters)
                return new(IrrigationPlanChangeKind.IrrigationNowRequired,
                    $"Conditions changed: irrigation is now required for {zoneName}.");

            if (oldWaters && !newWaters)
                return new(IrrigationPlanChangeKind.IrrigationNoLongerRequired,
                    $"Conditions changed: the planned irrigation for {zoneName} is no longer required.");

            var oldEvent = previous.FirstOrDefault(d => Waters(d.Action));
            var newEvent = current.FirstOrDefault(d => Waters(d.Action));
            if (oldEvent != null && newEvent != null && oldEvent.Date != newEvent.Date)
            {
                var kind = newEvent.Date < oldEvent.Date
                    ? IrrigationPlanChangeKind.MovedEarlier
                    : IrrigationPlanChangeKind.MovedLater;
                return new(kind,
                    $"{zoneName}'s next irrigation moved from {oldEvent.Date:ddd d MMM} to {newEvent.Date:ddd d MMM}.",
                    oldEvent.Date, newEvent.Date);
            }

            if (oldEvent?.RequiredDepthMm is { } oldDepth && newEvent?.RequiredDepthMm is { } newDepth)
            {
                var difference = Math.Abs(newDepth - oldDepth);
                var fraction = oldDepth > 0.0 ? difference / oldDepth : 1.0;
                if (difference >= MaterialDepthChangeMm && fraction >= MaterialDepthChangeFraction)
                {
                    var reduced = newDepth < oldDepth;
                    return new(reduced ? IrrigationPlanChangeKind.AmountReduced : IrrigationPlanChangeKind.AmountIncreased,
                        reduced
                            ? $"Weather has reduced {zoneName}'s expected irrigation amount."
                            : $"Weather has increased {zoneName}'s expected irrigation amount.");
                }
            }

            return null;
        }

        private static bool Waters(IrrigationPrimaryAction action) =>
            action is IrrigationPrimaryAction.WaterNow or IrrigationPrimaryAction.WaterNowReduced;
    }
}
