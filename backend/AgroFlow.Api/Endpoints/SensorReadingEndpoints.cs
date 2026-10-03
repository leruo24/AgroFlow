using AgroFlow.Api.Services;
using AgroFlow.Business;
using AgroFlow.Api.Services.Notifications;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public record SensorReadingRequest(long ZoneId, string SensorType, float Value);

public record SensorReadingResponse(string HealthStatus, string? CommandIssued);

// HTTP transport for sensor readings. The actual insert + health/
// auto-irrigation decision logic lives in SensorReadingProcessor, shared
// with the MQTT handler (MqttConnectionService) - this endpoint's only job
// is to validate the request and resolve which zone it's for (directly from
// the request body; MQTT resolves it from the topic's deviceId instead).
public static class SensorReadingEndpoints
{
    public static void MapSensorReadingEndpoints(this WebApplication app)
    {
        app.MapPost("/api/sensor-readings", HandleAsync);
    }

    private static async Task<IResult> HandleAsync(
        SensorReadingRequest request,
        NpgsqlDataSource dataSource,
        INotificationService notifications,
        CancellationToken cancellationToken)
    {
        // The same list the MQTT subscriber checks against, so the two
        // transports cannot drift apart - it used to be a private copy here
        // and nothing at all on the MQTT side.
        if (request.ZoneId <= 0 || !SensorReadingTypes.IsValid(request.SensorType))
        {
            return Results.BadRequest(
                $"zoneId must be positive and sensorType must be one of {SensorReadingTypes.Describe()}.");
        }

        await using var connection = await dataSource.OpenConnectionAsync();
        var result = await SensorReadingProcessor.ProcessAsync(
            connection, request.ZoneId, request.SensorType, request.Value, notifications, cancellationToken);

        return Results.Ok(new SensorReadingResponse(result.HealthStatus, result.CommandIssued));
    }
}
