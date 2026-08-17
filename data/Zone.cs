namespace AgroFlow.Business
{
    public class Zone
    {
        #region Data Members
        private int zoneId;
        private string cropType;
        private float moisture;
        private float temperature;
        private float humidity;
        private float waterSaved;
        private string healthStatus;
        #endregion

        #region Property Methods
        public int ZoneID
        {
            get { return zoneId; }
            set { zoneId = value; }
        }

        public string CropType
        {
            get { return cropType; }
            set { cropType = value; }
        }

        public float Moisture
        {
            get { return moisture; }
            set { moisture = value; }
        }

        public float Temperature
        {
            get { return temperature; }
            set { temperature = value; }
        }

        public float Humidity
        {
            get { return humidity; }
            set { humidity = value; }
        }

        public float WaterSaved
        {
            get { return waterSaved; }
            set { waterSaved = value; }
        }

        public string HealthStatus
        {
            get { return healthStatus; }
            set { healthStatus = value; }
        }
        #endregion

        #region Constructors
        public Zone()
        {
            zoneId = 0;
            cropType = "";
            healthStatus = "Unknown";
        }

        public Zone(int pZoneID, string pCropType)
        {
            zoneId = pZoneID;
            cropType = pCropType;
            healthStatus = "Unknown";
        }
        #endregion

        #region Methods
        public string CalculateHealth()
        {
            if (moisture < 20f) healthStatus = "Critical";
            else if (moisture < 40f) healthStatus = "Warning";
            else healthStatus = "Healthy";
            return healthStatus;
        }

        public bool NeedsWater()
        {
            return moisture < 40f;
        }
        #endregion
    }
}
