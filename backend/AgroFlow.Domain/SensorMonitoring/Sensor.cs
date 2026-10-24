using System;

namespace AgroFlow.Business
{
    public class Sensor : Hardware
    {
        #region Data Member
        // Soil moisture keeps both the raw ADC value (0-4095) and a percentage;
        // DHT11 temperature and humidity sensors only use 'reading'.
        private string sensorType; // "SoilMoisture" | "Temperature" | "Humidity"
        private int rawValue;
        private float reading;
        private DateTime recordedAt;
        #endregion

        #region Property Methods
        public string SensorTypeName
        {
            get { return sensorType; }
            set { sensorType = value; }
        }

        public int RawValue
        {
            get { return rawValue; }
            set { rawValue = value; }
        }

        public float Reading
        {
            get { return reading; }
            set { reading = value; }
        }

        public DateTime RecordedAt
        {
            get { return recordedAt; }
            set { recordedAt = value; }
        }
        #endregion

        #region Constructor
        public Sensor() : base()
        {
            GetHardwareType = HardwareType.Sensor;
            status = "Offline";
            rawValue = 0;
            reading = 0f;
        }
        #endregion

        #region Methods
        // override (Notes 2.4): a sensor's value is its latest reading.
        public override float ReadValue()
        {
            return reading;
        }
        #endregion
    }
}
