#nullable enable
using System;
using System.Linq;

namespace AgroFlow.Business
{
    // The sensor types AgroFlow accepts, in one place.
    // sensor_reading.sensor_type has a CHECK constraint allowing exactly
    // SoilMoisture/Temperature/Humidity (0002). The HTTP endpoint and the MQTT subscriber
    // both check against this list, so an unknown type is rejected cleanly before the
    // insert instead of failing the CHECK and logging an exception per message.
    // It allows nothing the database does not already allow.
    public static class SensorReadingTypes
    {
        // Soil moisture as a percentage: the only type that drives watering decisions (see
        // SensorReadingProcessor).
        public const string SoilMoisture = "SoilMoisture";

        // Air temperature in degrees Celsius, from the DHT11 on pin 27.
        public const string Temperature = "Temperature";

        // Relative humidity as a percentage, from the same DHT11.
        public const string Humidity = "Humidity";

        // Same order as the CHECK constraint in 0002. Adding a fourth type means extending the
        // constraint in the same migration.
        public static readonly string[] All = { SoilMoisture, Temperature, Humidity };

        // Case-sensitive, like the constraint; accepting "temperature" here would only move
        // the failure to Postgres. The firmware sends the exact strings above.
        public static bool IsValid(string? sensorType)
        {
            return sensorType != null && All.Contains(sensorType);
        }

        // True for the one type allowed to start or stop a pump. Temperature and Humidity
        // feed zone health, the engine and the Kit screen, but never the irrigation decision:
        // a hot afternoon is no reason to open a valve.
        public static bool DrivesIrrigation(string? sensorType)
        {
            return sensorType == SoilMoisture;
        }

        public static string Describe()
        {
            return string.Join("/", All);
        }
    }
}
