#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using AgroFlow.Business.Agronomy;
using AgroFlow.Data;

namespace AgroFlow.Business
{
    public sealed class MoistureMlController
    {
        private readonly MoistureMlXDB db;
        public MoistureMlController(string connectionString) => db = new MoistureMlXDB(connectionString);

        public MoistureMlXDB Data => db;

        public bool CanAccessZone(long zoneId, Guid profileId) => db.CanAccessZone(zoneId, profileId);

        // A reading in relative % when the zone's calibration allows it; otherwise the
        // raw value, which still works for the "unchanged" and spike checks.
        public static double ToRelativeOrRaw(double raw, double? wet, double? dry)
        {
            var domain = Fao56Engine.DetectSensorDomain(wet, dry);
            if (domain == SoilMoistureDomain.RelativePercent) return Math.Clamp(raw, 0, 100);
            return SoilWaterBalance.RelativeMoisturePercent(raw, wet, dry) ?? raw;
        }

        public static bool IsRelative(double? wet, double? dry)
        {
            var domain = Fao56Engine.DetectSensorDomain(wet, dry);
            return domain == SoilMoistureDomain.RelativePercent
                   || (wet.HasValue && dry.HasValue && domain != SoilMoistureDomain.InvalidMixedCalibration
                       && Math.Abs(wet.Value - dry.Value) > 1e-9);
        }

        public List<MoistureSample> Samples(MoistureFaultZone zone, DateTime sinceUtc)
            => db.GetReadings(zone.ZoneId, sinceUtc)
                .Select(r => new MoistureSample
                {
                    AtUtc = r.AtUtc,
                    Value = ToRelativeOrRaw(r.Value, zone.CalibrationWet, zone.CalibrationDry),
                })
                .ToList();

        // Training rows from the database: simulated farms and real farms, each day
        // keeping whether its reading was simulated.
        public List<(string ZoneKey, string SoilType, List<MoistureDay> Days)> TrainingHistory()
        {
            var result = new List<(string, string, List<MoistureDay>)>();
            foreach (var zone in db.GetTrainingHistory())
            {
                if (!IsRelative(zone.CalibrationWet, zone.CalibrationDry)) continue;
                var days = zone.Days.Select(d =>
                {
                    d.Day.MoisturePct = d.RawReading.HasValue
                        ? ToRelativeOrRaw(d.RawReading.Value, zone.CalibrationWet, zone.CalibrationDry)
                        : null;
                    d.Day.Simulated = zone.FarmIsSimulated || d.ReadingSimulated;
                    return d.Day;
                }).ToList();
                result.Add(("db-zone-" + zone.ZoneId, zone.SoilType, days));
            }
            return result;
        }
    }
}
