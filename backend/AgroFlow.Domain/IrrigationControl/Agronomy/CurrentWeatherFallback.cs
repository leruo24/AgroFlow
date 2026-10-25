#nullable enable
using System;
using AgroFlow.Business.Agronomy.RuleBook;

namespace AgroFlow.Business.Agronomy
{
    public enum CurrentWeatherSource
    {
        Unavailable,
        FieldSensor,
        LocalWeather,
    }

    public sealed record CurrentWeatherValue(double? Value, CurrentWeatherSource Source, DateTimeOffset? ObservedAt)
    {
        public string SourceCode => Source switch
        {
            CurrentWeatherSource.FieldSensor => "field_sensor",
            CurrentWeatherSource.LocalWeather => "local_weather",
            _ => "unavailable",
        };
    }

    // Chooses each climate value independently. Sensor telemetry remains in sensor_reading;
    // this only selects what the current-weather response displays and never writes fallback
    // values back as if they came from the DHT11.
    public static class CurrentWeatherFallback
    {
        public static readonly TimeSpan SensorFreshness = TimeSpan.FromHours(KitRules.DhtOfflineWindowHours);
        public static readonly TimeSpan MaximumFutureSkew = TimeSpan.FromMinutes(5);

        public static CurrentWeatherValue Select(
            string sensorType,
            double? sensorValue,
            DateTimeOffset? sensorAt,
            double? localWeatherValue,
            DateTimeOffset now)
        {
            if (sensorValue.HasValue && sensorAt.HasValue &&
                IsFresh(sensorAt.Value, now) && KitRules.IsValidDhtValue(sensorType, sensorValue.Value))
            {
                return new CurrentWeatherValue(sensorValue, CurrentWeatherSource.FieldSensor, sensorAt);
            }

            if (localWeatherValue.HasValue && KitRules.IsValidDhtValue(sensorType, localWeatherValue.Value))
            {
                return new CurrentWeatherValue(localWeatherValue, CurrentWeatherSource.LocalWeather, null);
            }

            return new CurrentWeatherValue(null, CurrentWeatherSource.Unavailable, null);
        }

        public static bool IsFresh(DateTimeOffset observedAt, DateTimeOffset now) =>
            observedAt >= now - SensorFreshness && observedAt <= now + MaximumFutureSkew;
    }
}
