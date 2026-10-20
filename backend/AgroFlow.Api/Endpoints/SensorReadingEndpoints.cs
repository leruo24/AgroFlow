using AgroFlow.Api.Services;
using AgroFlow.Business;
using AgroFlow.Api.Services.Notifications;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// RecordedAt: the kit's own time for a reading it kept while offline (see ReadingAge).
public record SensorReadingRequest(long ZoneId, string SensorType, float Value, DateTimeOffset? RecordedAt = null);

// Timing: "Live" (acted on), "Late" (stored only) or "Rejected" (too old or in the future).
public record SensorReadingResponse(string HealthStatus, string? CommandIssued, string Timing = "Live");

// HTTP route for sensor readings. The insert, health and auto-irrigation logic is
// in SensorReadingProcessor, shared with the MQTT handler; this endpoint only
// validates the request and takes the zone from the body.
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
        // The same list the MQTT subscriber checks, so both routes accept the same types.
        if (request.ZoneId <= 0 || !SensorReadingTypes.IsValid(request.SensorType))
        {
            return Results.BadRequest(
                $"zoneId must be positive and sensorType must be one of {SensorReadingTypes.Describe()}.");
        }

        await using var connection = await dataSource.OpenConnectionAsync();
        var result = await SensorReadingProcessor.ProcessAsync(
            connection, request.ZoneId, request.SensorType, request.Value, notifications, cancellationToken,
            recordedAt: request.RecordedAt);

        return Results.Ok(new SensorReadingResponse(result.HealthStatus, result.CommandIssued, result.Timing.ToString()));
    }
}
