using System;

namespace AgroFlow.Business
{
    public class Sensor : Hardware
    {
        #region Data Member
        // Soil moisture stores BOTH a raw ADC integer (0-4095, ground truth) and a
        // normalized percentage; DHT11 temp/humidity sensors use only 'reading'.
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
        // override (Notes 2.4): a Sensor's "value" is its latest reading.
        public override float ReadValue()
        {
            return reading;
        }
        #endregion
    }
}
