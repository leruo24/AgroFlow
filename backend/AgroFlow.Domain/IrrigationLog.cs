using System;

namespace AgroFlow.Business
{
    // No flow meter on the confirmed hardware, so water volume is split into
    // runtimeSeconds (measured) and estimatedLitres (derived) - keeps the
    // estimate auditable.
    //
    // This class NO LONGER DERIVES THE VOLUME ITSELF. It used to carry a
    // RatedFlowLitresPerSecond constant flagged as an unverified placeholder,
    // which made it a second source of truth competing with zone.flow_rate_lpm
    // and with the firmware's own constant - three answers for one number.
    // There is now exactly one: zone.flow_rate_lpm, applied by
    // WaterUsageEstimator.EstimateEventLitres. EstimatedLitres here is a plain
    // carrier, set by whoever already did that arithmetic.
    public class IrrigationLog
    {
        #region Data Members
        private int logId;
        private int zoneId;
        private DateTime dateTime;
        private int runtimeSeconds;
        private float estimatedLitres;
        private string action;
        #endregion

        #region Property Methods
        public int LogID { get { return logId; } set { logId = value; } }
        public int ZoneID { get { return zoneId; } set { zoneId = value; } }
        public DateTime DateTime { get { return dateTime; } set { dateTime = value; } }
        public int RuntimeSeconds { get { return runtimeSeconds; } set { runtimeSeconds = value; } }
        public float EstimatedLitres { get { return estimatedLitres; } set { estimatedLitres = value; } }
        public string Action { get { return action; } set { action = value; } }
        #endregion

        #region Constructors
        public IrrigationLog()
        {
            dateTime = DateTime.Now;
            action = "";
        }

        // estimatedLitres is deliberately left at 0 here rather than derived:
        // this constructor has no zone flow rate to work from. Set
        // EstimatedLitres from WaterUsageEstimator.EstimateEventLitres, which
        // takes the zone's configured rate and returns null when there isn't
        // one.
        public IrrigationLog(int pLogID, int pZoneID, int pRuntimeSeconds, string pAction)
        {
            logId = pLogID;
            zoneId = pZoneID;
            dateTime = DateTime.Now;
            runtimeSeconds = pRuntimeSeconds;
            action = pAction;
        }
        #endregion
    }
}
