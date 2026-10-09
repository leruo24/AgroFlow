#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    public enum KitProblem
    {
        /// <summary>No soil reading for <see cref="KitRules.ZoneOfflineHours"/>.</summary>
        Offline,

        /// <summary>The same reading for <see cref="KitRules.SensorStuckHours"/>.</summary>
        SensorStuck,

        /// <summary>The pump ran but the soil did not get wetter.</summary>
        PumpRanNoChange,

        /// <summary>Soil readings arrive, but no valid temperature or humidity.</summary>
        DhtOffline,

        /// <summary>The wettest reading after watering has moved away from the saved wet point.</summary>
        SensorDrift,
    }

    // Kit rules - is the hardware telling the truth?
    //
    // Every rule here is a DATA RULE: FAO-56 knows nothing about sensors and
    // pumps. The thresholds come from how the kit behaves - it reports every
    // 30 seconds - and are written down here so they can be argued with.
    //
    // The data layer (Fao56EngineXDB) reads the rows; these methods decide.
    public static class KitRules
    {
        // DATA RULE: a kit reports every 30 seconds, so three hours of silence
        // is hundreds of missed readings - power or WiFi, not a blip.
        public const int ZoneOfflineHours = 3;

        // DATA RULE: real soil moves at least a little over six hours (it dries
        // in the day, cools at night). An unchanged number that long is a
        // loose or failed probe.
        public const int SensorStuckHours = 6;

        // DATA RULE: a run must be at least this long to be judged - the same
        // two minutes WaterRules uses for "a real watering".
        public const double PumpCheckMinimumSeconds = WaterRules.FullWateringMinimumSeconds;

        // DATA RULE: water should reach a correctly placed zone probe within
        // half an hour; no change by then means none reached it.
        public const int PumpCheckWindowMinutes = 30;

        // DATA RULE: the window in which a missing temperature/humidity reading
        // counts as the DHT11 being offline, while soil readings still arrive.
        public const int DhtOfflineWindowHours = 2;

        // DATA RULE: three valid readings in a row before a flapping DHT11 is
        // called back online, so one good reading does not clear the fault.
        public const int DhtBackOnlineReadingCount = 3;

        // DATA RULE: the wettest reading drifting more than 15% of the wet/dry
        // span from the saved wet point. Resistive probes corrode; 15% is past
        // day-to-day scatter, before readings become useless.
        public const double SensorDriftFraction = 0.15;

        // DATA RULE (spec 3b plausibility): a DHT11 reading outside these is
        // a timeout or checksum failure, not weather.
        public const double DhtMinTemperatureC = -10.0;
        public const double DhtMaxTemperatureC = 60.0;
        public const double DhtMinHumidityPct = 0.0;
        public const double DhtMaxHumidityPct = 100.0;

        /// <summary>No reading for <see cref="ZoneOfflineHours"/> or more.</summary>
        public static bool IsOffline(TimeSpan? sinceLastReading)
        {
            return sinceLastReading.HasValue && sinceLastReading.Value.TotalHours >= ZoneOfflineHours;
        }

        /// <summary>The same reading for <see cref="SensorStuckHours"/> or more.</summary>
        public static bool IsStuck(TimeSpan? identicalReadingFor)
        {
            return identicalReadingFor.HasValue && identicalReadingFor.Value.TotalHours >= SensorStuckHours;
        }

        /// <summary>How long the newest reading has stayed unchanged, from readings newest first.</summary>
        public static TimeSpan IdenticalFor(IReadOnlyList<(DateTime At, double Value)> newestFirst)
        {
            if (newestFirst == null || newestFirst.Count == 0) return TimeSpan.Zero;

            var newest = newestFirst[0].Value;
            var oldestIdentical = newestFirst[0].At;
            for (var i = 1; i < newestFirst.Count; i++)
            {
                if (Math.Abs(newestFirst[i].Value - newest) > 1e-9) break;
                oldestIdentical = newestFirst[i].At;
            }

            return newestFirst[0].At - oldestIdentical;
        }

        /// <summary>
        /// The wettest of a set of readings - the lowest number when the probe
        /// reads lower when wet, otherwise the highest.
        /// </summary>
        public static double? Wettest(IReadOnlyCollection<double> readings, double? calibrationWet, double? calibrationDry)
        {
            if (readings == null || readings.Count == 0) return null;
            if (!calibrationWet.HasValue || !calibrationDry.HasValue) return null;
            return calibrationWet.Value < calibrationDry.Value ? readings.Min() : readings.Max();
        }

        /// <summary>Whether the wettest reading has drifted past <see cref="SensorDriftFraction"/> of the span.</summary>
        public static bool IsDrifting(double? sevenDayWettest, double? calibrationWet, double? calibrationDry)
        {
            if (!sevenDayWettest.HasValue || !calibrationWet.HasValue || !calibrationDry.HasValue) return false;
            var span = Math.Abs(calibrationWet.Value - calibrationDry.Value);
            if (span <= 0.0) return false;
            return Math.Abs(sevenDayWettest.Value - calibrationWet.Value) > SensorDriftFraction * span;
        }

        /// <summary>Whether a temperature or humidity value is plausible.</summary>
        public static bool IsValidDhtValue(string sensorType, double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return false;

            if (sensorType == "Temperature") return value >= DhtMinTemperatureC && value <= DhtMaxTemperatureC;
            if (sensorType == "Humidity") return value >= DhtMinHumidityPct && value <= DhtMaxHumidityPct;
            return false;
        }

        /// <summary>
        /// Whether the DHT11 is offline while the board still reports soil.
        /// </summary>
        /// <remarks>
        /// No soil readings either means the whole board is quiet - that is
        /// <see cref="KitProblem.Offline"/>, not a DHT11 fault. Otherwise it is
        /// offline unless there was a valid reading inside the window AND the
        /// newest <see cref="DhtBackOnlineReadingCount"/> are all valid.
        /// </remarks>
        public static bool IsDhtOffline(
            bool soilStillReporting,
            IReadOnlyList<(DateTime At, string Type, double Value)> dhtNewestFirst,
            DateTime nowUtc,
            out DateTime? offlineSinceUtc)
        {
            offlineSinceUtc = null;
            if (!soilStillReporting) return false;

            var since = nowUtc.AddHours(-DhtOfflineWindowHours);
            var anyValidRecently = dhtNewestFirst.Any(d => d.At >= since && IsValidDhtValue(d.Type, d.Value));

            if (anyValidRecently)
            {
                var consecutive = 0;
                foreach (var d in dhtNewestFirst)
                {
                    if (IsValidDhtValue(d.Type, d.Value)) consecutive++;
                    else break;
                }
                if (consecutive >= DhtBackOnlineReadingCount) return false;
            }

            var lastValid = dhtNewestFirst.FirstOrDefault(d => IsValidDhtValue(d.Type, d.Value));
            offlineSinceUtc = lastValid.At == default ? (DateTime?)null : lastValid.At;
            return true;
        }

        /// <summary>
        /// Whether a pump run left the soil no wetter: the reading just before
        /// against the wettest in the <see cref="PumpCheckWindowMinutes"/> after.
        /// </summary>
        /// <remarks>
        /// Not judged until the window has fully passed (a run that ended a
        /// minute ago is not a failure), and never on missing evidence: no
        /// reading on either side is a data gap, not a broken pump. An
        /// uncalibrated probe is assumed to read higher when wet - what the
        /// current firmware sends.
        /// </remarks>
        public static bool PumpRanNoChange(
            DateTime runStartedUtc, double runtimeSeconds, DateTime nowUtc,
            double? readingBefore, IReadOnlyCollection<double> readingsAfter, bool wetIsLower)
        {
            if (runtimeSeconds < PumpCheckMinimumSeconds) return false;

            var runEnded = runStartedUtc.AddSeconds(runtimeSeconds);
            if (nowUtc < runEnded.AddMinutes(PumpCheckWindowMinutes)) return false;

            if (!readingBefore.HasValue || readingsAfter == null || readingsAfter.Count == 0) return false;

            var movedTowardWet = wetIsLower
                ? readingsAfter.Min() < readingBefore.Value
                : readingsAfter.Max() > readingBefore.Value;

            return !movedTowardWet;
        }

        /// <summary>Every kit problem the signals show, in a fixed order.</summary>
        public static List<KitProblem> Problems(ZoneFaultSignals signals, double? calibrationWet, double? calibrationDry)
        {
            var problems = new List<KitProblem>();
            if (signals == null) return problems;

            if (IsOffline(signals.SinceLastReading)) problems.Add(KitProblem.Offline);
            if (IsStuck(signals.IdenticalReadingFor)) problems.Add(KitProblem.SensorStuck);
            if (signals.WateringAppearedToFail) problems.Add(KitProblem.PumpRanNoChange);
            if (signals.DhtOffline) problems.Add(KitProblem.DhtOffline);
            if (IsDrifting(signals.SevenDayMinimumReading, calibrationWet, calibrationDry)) problems.Add(KitProblem.SensorDrift);

            return problems;
        }
    }
}
