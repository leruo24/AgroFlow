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

        // Per-zone auto-irrigation thresholds (zone.moisture_threshold / desired_moisture,
        // named in 0010 to match the app's zone settings). Nullable like the columns: a zone
        // with no threshold never auto-triggers (see ShouldStartIrrigation/ShouldStopIrrigation).
        private float? moistureThreshold;
        private float? desiredMoisture;

        // Running total (zone.water_used_total). Not the same as waterSaved above; see
        // AddWaterUsage.
        private float waterUsedTotal;
        #endregion

        #region Health Status Thresholds
        // Zone health thresholds as named constants, so this is the one place to tune them.
        public const float MoistureCriticalMax = 20f;
        public const float MoistureWarningMax = 40f;
        public const float TemperatureCriticalMin = 38f;
        public const float TemperatureWarningMin = 33f;
        public const float HumidityWarningMax = 20f;
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

        public float? MoistureThreshold
        {
            get { return moistureThreshold; }
            set { moistureThreshold = value; }
        }

        public float? DesiredMoisture
        {
            get { return desiredMoisture; }
            set { desiredMoisture = value; }
        }

        public float WaterUsedTotal
        {
            get { return waterUsedTotal; }
            set { waterUsedTotal = value; }
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
        // The simple moisture-only calculation on this instance. CalculateHealthStatus below
        // is the multi-factor version the sensor-readings endpoint uses.
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

        // Multi-factor health calculation. Static with parameters because the endpoint has
        // readings for a zone_id, not a full Zone object. Moisture is the main signal;
        // temperature and humidity can only raise the severity, never turn a healthy moisture
        // reading into Critical on their own.
        public static string CalculateHealthStatus(float? moisture, float? temperature, float? humidity)
        {
            if (!moisture.HasValue)
            {
                return "Unknown"; // no soil moisture reading yet - can't assess
            }

            if (moisture.Value < MoistureCriticalMax ||
                (temperature.HasValue && temperature.Value >= TemperatureCriticalMin))
            {
                return "Critical";
            }

            if (moisture.Value < MoistureWarningMax ||
                (temperature.HasValue && temperature.Value >= TemperatureWarningMin) ||
                (humidity.HasValue && humidity.Value < HumidityWarningMax))
            {
                return "Warning";
            }

            return "Healthy";
        }

        // True only when a dry threshold is set for this zone: an unset threshold never
        // falls back to a guessed default and starts irrigating.
        public bool ShouldStartIrrigation(float moisture)
        {
            return moistureThreshold.HasValue && moisture < moistureThreshold.Value;
        }

        public bool ShouldStopIrrigation(float moisture)
        {
            return desiredMoisture.HasValue && moisture > desiredMoisture.Value;
        }

        // Adds to the running water total and returns the new total. The saved increment
        // still happens under a row lock in IrrigationEventEndpoints to avoid a lost-update
        // race; this method only works out the value.
        public float AddWaterUsage(float estimatedLitres)
        {
            waterUsedTotal += estimatedLitres;
            return waterUsedTotal;
        }
        #endregion
    }
}
