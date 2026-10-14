#nullable enable
using System;
using System.Collections.Generic;
using AgroFlow.Data;

namespace AgroFlow.Business
{
    public sealed class SimulationController
    {
        private readonly SimulationXDB db;
        public SimulationController(string connectionString) => db = new SimulationXDB(connectionString);

        public IReadOnlyList<SimulationTarget> Targets(DateOnly day) => db.GetTargets(day);

        public bool Write(SimulationTarget target, DateTimeOffset recordedAt)
        {
            var moisture = SimulationRules.MoistureFromStoredBalance(
                target.DepletionMm, target.TotalAvailableWaterMm,
                SimulationRules.NoiseFor(target.ZoneId, target.Day));
            return db.InsertReading(target, moisture, recordedAt);
        }
    }
}
