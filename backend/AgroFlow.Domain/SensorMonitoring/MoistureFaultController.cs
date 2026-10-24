#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using AgroFlow.Business.Agronomy;
using AgroFlow.Data;

namespace AgroFlow.Business
{
    public sealed class MoistureFaultController
    {
        private readonly MoistureFaultXDB db;
        public MoistureFaultController(string connectionString) => db = new MoistureFaultXDB(connectionString);

        public MoistureFaultXDB Data => db;

        // A reading in relative % when the zone's calibration allows it; otherwise the
        // raw value, which still works for the "unchanged" check.
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
    }
}
