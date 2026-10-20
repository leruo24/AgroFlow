#nullable enable
using System;
using System.Collections.Generic;
using AgroFlow.Data;

namespace AgroFlow.Business
{
    public sealed class TankPhController
    {
        private readonly TankPhXDB db;

        public TankPhController(string connectionString)
        {
            db = new TankPhXDB(connectionString);
        }

        public bool CanAccessFarm(long farmId, Guid profileId) => db.CanAccessFarm(farmId, profileId);
        public bool CanAccessZone(long zoneId, Guid profileId) => db.CanAccessZone(zoneId, profileId);

        public TankStatus? GetTank(long farmId, DateTimeOffset? at = null)
            => db.GetTankStatus(farmId, at ?? DateTimeOffset.UtcNow);

        public string? SetCapacity(long farmId, decimal litres)
        {
            var error = TankPhRules.ValidateCapacity(litres);
            if (error is null) db.SetCapacity(farmId, litres);
            return error;
        }

        public (TankRefillResult? Result, string? Error) LogRefill(
            long farmId, decimal litres, decimal? waterPh, DateTimeOffset at, Guid profileId)
        {
            at = at.ToUniversalTime();
            var before = db.GetTankStatus(farmId, at);
            if (before is null) return (null, "Farm not found.");
            if (at > DateTimeOffset.UtcNow.AddMinutes(5)) return (null, "The refill date cannot be in the future.");
            if (before.CapacityLitres is not { } capacity)
                return (null, "Set the tank size before logging a refill.");

            var error = TankPhRules.ValidateRefill(litres, waterPh, capacity);
            if (error is not null) return (null, error);

            // The phone keeps a refill logged offline and sends it later with its own time. The
            // same farm, time and litres is the same refill, so a resend is not counted twice.
            if (db.RefillAlreadyLogged(farmId, at, litres))
            {
                return (new TankRefillResult { Status = db.GetTankStatus(farmId, DateTimeOffset.UtcNow)! }, null);
            }

            decimal? estimated = before.LastRefillId.HasValue ? before.EstimatedUsedLitres : null;
            decimal? observed = before.LastRefillId.HasValue ? litres : null;
            db.InsertRefill(farmId, litres, waterPh, at, profileId, estimated, observed);

            var after = db.GetTankStatus(farmId, DateTimeOffset.UtcNow)!;
            var comparison = estimated.HasValue
                ? $"AgroFlow estimated {estimated.Value:0.#} L used; the tank shows {litres:0.#} L"
                : null;
            return (new TankRefillResult
            {
                Status = after,
                EstimatedUsedBeforeRefill = estimated,
                ObservedUsed = observed,
                Comparison = comparison,
            }, null);
        }

        public IReadOnlyList<SoilPhEntry> GetSoilPh(long zoneId) => db.GetSoilPh(zoneId);
        public IReadOnlyList<ZoneSoilPhSummary> DataForAdmin(long farmId) => db.GetFarmSoilPh(farmId);

        public (SoilPhEntry? Entry, string? Error) LogSoilPh(
            long zoneId, decimal ph, DateTimeOffset at, string? note, Guid profileId)
        {
            at = at.ToUniversalTime();
            if (at > DateTimeOffset.UtcNow.AddMinutes(5)) return (null, "The measurement date cannot be in the future.");
            note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
            var error = TankPhRules.ValidateSoilPh(ph, note);
            if (error is not null) return (null, error);
            // Same zone, time and pH as one already stored: a resend from the phone's offline queue.
            return (db.FindSoilPh(zoneId, at, ph) ?? db.InsertSoilPh(zoneId, ph, at, note, profileId), null);
        }

        public IReadOnlyList<long> GetConfiguredFarmIds() => db.GetConfiguredFarmIds();
        public bool SetLowAlert(long farmId, bool low) => db.SetLowAlert(farmId, low);
    }
}
