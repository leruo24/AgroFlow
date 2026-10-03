#nullable enable
using System;
using System.Linq;

namespace AgroFlow.Business
{
    // The sensor types AgroFlow accepts, in one place.
    //
    // WHY THIS EXISTS
    // ---------------
    // sensor_reading.sensor_type has carried a CHECK constraint allowing
    // exactly SoilMoisture/Temperature/Humidity since
    // 0002_relationships.sql, and SensorReadingEndpoints has had the same
    // three in a private array since it was written. The MQTT subscriber had
    // no list at all: it passed whatever sensorType arrived in the payload
    // straight into the insert.
    //
    // That was survivable while the firmware only ever published
    // SoilMoisture. v1.3.0 publishes Temperature and Humidity from the DHT11
    // as well, on the same topic and in the same {"sensorType","value"}
    // shape, so the subscriber's behaviour on the other two values now
    // matters. Both are already allowed by the constraint, so no migration
    // is needed - but an unrecognised value would reach Postgres, violate
    // the CHECK, and surface as a logged exception per message rather than
    // as the "ignored one bad message" it actually is.
    //
    // Additive by design: this widens nothing and forbids nothing that the
    // database did not already forbid. It gives the two transports one list
    // to agree on, and gives the subscriber a cheap, clear rejection before
    // the insert.
    public static class SensorReadingTypes
    {
        // Soil moisture, as a percentage. The ONLY type that drives watering
        // decisions - see SensorReadingProcessor.
        public const string SoilMoisture = "SoilMoisture";

        // Air temperature in degrees Celsius, from the DHT11 on pin 27.
        public const string Temperature = "Temperature";

        // Relative humidity as a percentage, from the same DHT11.
        public const string Humidity = "Humidity";

        // Order matches the CHECK constraint in 0002_relationships.sql. If a
        // fourth type is ever added, the constraint has to be extended in the
        // same migration that extends this array.
        public static readonly string[] All = { SoilMoisture, Temperature, Humidity };

        // Case-sensitive on purpose. The constraint is case-sensitive, so
        // accepting "temperature" here would simply move the failure to
        // Postgres. The firmware sends the exact strings above.
        public static bool IsValid(string? sensorType)
        {
            return sensorType != null && All.Contains(sensorType);
        }

        // True for the one type that is allowed to start or stop a pump.
        // Temperature and Humidity are stored and feed zone health, the
        // FAO-56 engine and the Kit screen's sensor readout, but must never
        // reach the irrigation decision - a hot afternoon is not a reason to
        // open a valve.
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
