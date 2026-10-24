using System;

namespace AgroFlow.Business
{
    // There is no flow meter, so water is split into runtimeSeconds (measured) and
    // estimatedLitres (derived), which keeps the estimate checkable.
    // This class does not work out the volume itself: zone.flow_rate_lpm through
    // WaterUsageEstimator.EstimateEventLitres is the only source. EstimatedLitres here
    // only carries the result.
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

        // estimatedLitres stays 0 here because this constructor has no flow rate. Set it
        // from WaterUsageEstimator.EstimateEventLitres, which returns null when the zone has
        // no rate.
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
