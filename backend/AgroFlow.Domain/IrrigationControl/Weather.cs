namespace AgroFlow.Business
{
    public class Weather
    {
        #region Data Members
        private float temperature;
        private float humidity;
        private float pressure;
        private float windSpeed;
        private string condition;
        #endregion

        #region Property Methods
        public float Temperature { get { return temperature; } set { temperature = value; } }
        public float Humidity { get { return humidity; } set { humidity = value; } }
        public float Pressure { get { return pressure; } set { pressure = value; } }
        public float WindSpeed { get { return windSpeed; } set { windSpeed = value; } }
        public string Condition { get { return condition; } set { condition = value; } }
        #endregion

        #region Constructors
        public Weather()
        {
            condition = "";
        }

        public Weather(float pTemperature, float pHumidity, float pPressure, float pWindSpeed, string pCondition)
        {
            temperature = pTemperature;
            humidity = pHumidity;
            pressure = pPressure;
            windSpeed = pWindSpeed;
            condition = pCondition;
        }
        #endregion

        #region Methods
        public string GetForecast()
        {
            return condition + ", " + temperature + " deg C";
        }
        #endregion
    }
}
