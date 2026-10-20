#nullable enable
namespace AgroFlow.Business
{
    // The one rule for whether a sensor reading sends an automatic pump command, kept pure so
    // it is tested without a database (SensorReadingProcessor fetches the inputs and saves
    // the result). In order:
    //   1. Only an Automatic zone (IrrigationMode.AllowsAutoCommands). Manual and Scheduled
    //      zones, and anything unrecognised, never get an automatic command.
    //   2. The zone's thresholds decide start (too dry) or stop (wet enough), else nothing.
    //   3. A manual run, or one that ended under 30 minutes ago, takes priority.
    //   4. Only a change: the same instruction twice in a row is not sent again.
    public static class AutoIrrigationDecision
    {
        public static string? Decide(
            string? irrigationMode,
            float reading,
            float? moistureThreshold,
            float? desiredMoisture,
            bool manualRunActive,
            string? lastCommand)
        {
            if (!IrrigationMode.AllowsAutoCommands(irrigationMode)) return null;

            var zone = new Zone { MoistureThreshold = moistureThreshold, DesiredMoisture = desiredMoisture };
            string? wanted = zone.ShouldStartIrrigation(reading) ? "start"
                : zone.ShouldStopIrrigation(reading) ? "stop"
                : null;

            if (wanted is null || manualRunActive) return null;
            return lastCommand == wanted ? null : wanted;
        }
    }
}
