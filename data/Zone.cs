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

        // Per-zone auto-irrigation thresholds (Postgres: zone.moisture_dry_threshold /
        // moisture_wet_threshold). Nullable to match the DB columns - a zone with no
        // threshold configured should never auto-trigger, not fall back to a guessed
        // default (see ShouldStartIrrigation/ShouldStopIrrigation below).
        private float? moistureDryThreshold;
        private float? moistureWetThreshold;

        // Running total (Postgres: zone.water_used_total). NOT the same column as
        // waterSaved above - see AddWaterUsage.
        private float waterUsedTotal;
        #endregion

        #region Health Status Thresholds
        // Same values the removed Postgres trigger used (calculate_zone_health() in
        // the now-dropped 0006_backend_irrigation_logic.sql) - named constants here
        // instead of magic numbers, so this is the one place to tune them.
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

        public float? MoistureDryThreshold
        {
            get { return moistureDryThreshold; }
            set { moistureDryThreshold = value; }
        }

        public float? MoistureWetThreshold
        {
            get { return moistureWetThreshold; }
            set { moistureWetThreshold = value; }
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
        // Original single-factor instance calculation (moisture only, reads/writes
        // this instance's own HealthStatus). Left as-is - CalculateHealthStatus below
        // is the multi-factor replacement used by the sensor-readings API endpoint,
        // added alongside rather than in place of this one.
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

        // Multi-factor health calculation, matching the logic the removed Postgres
        // trigger used (calculate_zone_health() in 0006_backend_irrigation_logic.sql,
        // dropped by 0007). Static and parameterised rather than reading instance
        // state, since the API endpoint calling this has readings for a zone_id, not
        // necessarily a fully-hydrated Zone instance. Moisture is the primary signal;
        // temperature/humidity only ever escalate severity, never override a healthy
        // moisture reading into Critical on their own.
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

        // True only when a dry threshold is actually configured for this zone - an
        // unset threshold must never fall back to a guessed default and silently
        // start irrigating.
        public bool ShouldStartIrrigation(float moisture)
        {
            return moistureDryThreshold.HasValue && moisture < moistureDryThreshold.Value;
        }

        public bool ShouldStopIrrigation(float moisture)
        {
            return moistureWetThreshold.HasValue && moisture > moistureWetThreshold.Value;
        }

        // Adds to the running water-usage total and returns the new total. The
        // actual persisted increment in the API endpoint is still done as an atomic
        // SQL UPDATE under a row lock (see IrrigationEventEndpoints) to avoid a
        // lost-update race if two requests for the same zone overlap - this method
        // is the domain-layer computation that decides the new value, not the
        // concurrency control.
        public float AddWaterUsage(float estimatedLitres)
        {
            waterUsedTotal += estimatedLitres;
            return waterUsedTotal;
        }
        #endregion
    }
}
