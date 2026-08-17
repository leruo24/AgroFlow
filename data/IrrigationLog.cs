using System;

namespace AgroFlow.Business
{
    // No flow meter on the confirmed hardware, so water volume is split into
    // runtimeSeconds (measured) and estimatedLitres (derived from a rated flow
    // constant) - keeps the estimate auditable.
    public class IrrigationLog
    {
        #region Data Members
        private int logId;
        private int zoneId;
        private DateTime dateTime;
        private int runtimeSeconds;
        private float estimatedLitres;
        private string action;

        // TODO: unverified placeholder - replace with the actual rated flow-rate
        // constant for your pump/kit before relying on estimatedLitres.
        private const float RatedFlowLitresPerSecond = 0.05f;
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

        public IrrigationLog(int pLogID, int pZoneID, int pRuntimeSeconds, string pAction)
        {
            logId = pLogID;
            zoneId = pZoneID;
            dateTime = DateTime.Now;
            runtimeSeconds = pRuntimeSeconds;
            estimatedLitres = pRuntimeSeconds * RatedFlowLitresPerSecond;
            action = pAction;
        }
        #endregion
    }
}
