using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// EstimatedLitres is accepted but ignored, and nullable so firmware can stop
// sending it. zone.flow_rate_lpm is the only source for litres.
public record IrrigationEventRequest(
    long ZoneId,
    int RuntimeSeconds,
    string TriggerSource,
    string SyncStatus,
    DateTimeOffset? StartedAt,
    float? EstimatedLitres = null);

// EstimatedLitres is null when the zone has no flow rate (no estimate possible),
// not 0, which would mean no water was used. IsMeasured is always false: there is
// no flow meter in AgroFlow.
public record IrrigationEventResponse(float WaterUsedTotal, float? EstimatedLitres, bool IsMeasured, string LitresBasis);

// Where the board logs a pump run. The water-usage total is updated in C#
// (Zone.AddWaterUsage) instead of a database trigger.
public static class IrrigationEventEndpoints
{
    public static void MapIrrigationEventEndpoints(this WebApplication app)
    {
        app.MapPost("/api/irrigation-events", HandleAsync);
    }

    private static async Task<IResult> HandleAsync(
        IrrigationEventRequest request,
        HttpContext context,
        AgroFlow.Api.Services.DeviceAuthService deviceAuth,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        // Security: X-Device-Token tells us which board is posting, and a token board may
        // only log runs for its own zone. A legacy shared-key board cannot be identified,
        // so its body is trusted while Devices:LegacyApiKeyEnabled allows it.
        var device = await deviceAuth.AuthenticateAsync(context, cancellationToken);

        if (device is null)
        {
            return Results.Json(
                new { error = "A valid X-Device-Token is required." },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!device.IsLegacyApiKey && device.ZoneId != request.ZoneId)
        {
            // 404, not 403, so a board cannot probe which zone ids exist (like the command ACK).
            return Results.NotFound("No such zone for this device.");
        }

        // Validate before opening a connection. A negative runtime would otherwise be
        // subtracted from zone.water_used_total, which nothing recomputes. The rules are in
        // IrrigationEventValidation (unit-tested) and the reason goes back in the 400.
        // Litres are 0 here because the device no longer sends a volume.
        var validationError = IrrigationEventValidation.Validate(
            request.ZoneId, request.RuntimeSeconds, 0f,
            request.TriggerSource, request.SyncStatus);

        if (validationError is not null)
        {
            return Results.BadRequest(validationError);
        }

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        // zone.flow_rate_lpm is the only source for litres. With no rate there is no
        // estimate and estimated_litres is stored as NULL. Fixing a zone's rate is a
        // database update, not a reflash. It is always an estimate: there is no flow meter.
        var flowRate = await FetchZoneFlowRateAsync(connection, transaction, request.ZoneId);
        var serverEstimate = WaterUsageEstimator.EstimateEventLitres(request.RuntimeSeconds, flowRate);

        float? estimatedLitres = serverEstimate is not null ? (float)serverEstimate.Litres : null;

        var litresBasis = serverEstimate is not null
            ? serverEstimate.Basis
            : "no estimate available: zone.flow_rate_lpm is not configured for this zone, and no flow meter exists to measure the volume";

        // Re-check with the volume the server worked out, so a wrong flow_rate_lpm on
        // the zone cannot store an impossible volume.
        if (estimatedLitres is not null)
        {
            var derivedError = IrrigationEventValidation.Validate(
                request.ZoneId, request.RuntimeSeconds, estimatedLitres.Value,
                request.TriggerSource, request.SyncStatus);

            if (derivedError is not null)
            {
                return Results.BadRequest(
                    "Derived from zone.flow_rate_lpm: " + derivedError);
            }
        }

        // A kit uploading its kept runs (firmware v1.5.0) may send one twice if the power
        // goes before it removes it. Same zone, start, runtime and source is the same run:
        // stored and counted once.
        if (request.StartedAt.HasValue &&
            await RunAlreadyLoggedAsync(connection, transaction, request))
        {
            var unchanged = await FetchZoneWaterUsedTotalForUpdateAsync(connection, transaction, request.ZoneId);
            await transaction.CommitAsync();
            return Results.Ok(new IrrigationEventResponse(unchanged, estimatedLitres, IsMeasured: false, litresBasis));
        }

        await InsertIrrigationEventAsync(connection, transaction, request, estimatedLitres);

        // Row lock so a second request for the same zone cannot read the same starting
        // total and overwrite this update (lost-update race).
        var currentTotal = await FetchZoneWaterUsedTotalForUpdateAsync(connection, transaction, request.ZoneId);

        // Only a real estimate changes the running total; an unconfigured zone leaves it
        // untouched instead of adding 0.
        var newTotal = currentTotal;
        if (estimatedLitres is not null)
        {
            // The domain class works out the new total; this endpoint only locks, reads and saves.
            var zone = new Zone { WaterUsedTotal = currentTotal };
            newTotal = zone.AddWaterUsage(estimatedLitres.Value);

            await UpdateZoneWaterUsedTotalAsync(connection, transaction, request.ZoneId, newTotal);
        }

        await transaction.CommitAsync();

        return Results.Ok(new IrrigationEventResponse(newTotal, estimatedLitres, IsMeasured: false, litresBasis));
    }

    // Null when the zone has no flow rate. Read in the same transaction as the
    // total update so it cannot change underneath this event.
    private static async Task<double?> FetchZoneFlowRateAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select flow_rate_lpm from zone where id = $1", connection, transaction);
        cmd.Parameters.AddWithValue(zoneId);

        var result = await cmd.ExecuteScalarAsync();
        return result is float f ? f : result is double d ? d : (double?)null;
    }

    private static async Task<bool> RunAlreadyLoggedAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, IrrigationEventRequest request)
    {
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from irrigation_event where zone_id = $1 and started_at = $2 " +
            "and runtime_seconds = $3 and trigger_source = $4)", connection, transaction);
        cmd.Parameters.AddWithValue(request.ZoneId);
        cmd.Parameters.AddWithValue(request.StartedAt!.Value);
        cmd.Parameters.AddWithValue(request.RuntimeSeconds);
        cmd.Parameters.AddWithValue(request.TriggerSource);
        return (bool)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task InsertIrrigationEventAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, IrrigationEventRequest request,
        float? estimatedLitres)
    {
        // started_at is left out (Postgres uses now()) when the board had no valid NTP
        // time at the start of the run.
        var sql = request.StartedAt.HasValue
            ? "insert into irrigation_event (zone_id, runtime_seconds, estimated_litres, trigger_source, sync_status, started_at) values ($1, $2, $3, $4, $5, $6)"
            : "insert into irrigation_event (zone_id, runtime_seconds, estimated_litres, trigger_source, sync_status) values ($1, $2, $3, $4, $5)";

        await using var cmd = new NpgsqlCommand(sql, connection, transaction);
        cmd.Parameters.AddWithValue(request.ZoneId);
        cmd.Parameters.AddWithValue(request.RuntimeSeconds);
        cmd.Parameters.AddWithValue((object?)estimatedLitres ?? DBNull.Value);
        cmd.Parameters.AddWithValue(request.TriggerSource);
        cmd.Parameters.AddWithValue(request.SyncStatus);
        if (request.StartedAt.HasValue)
        {
            cmd.Parameters.AddWithValue(request.StartedAt.Value);
        }
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<float> FetchZoneWaterUsedTotalForUpdateAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select water_used_total from zone where id = $1 for update", connection, transaction);
        cmd.Parameters.AddWithValue(zoneId);
        var result = await cmd.ExecuteScalarAsync();
        return result is float f ? f : 0f;
    }

    private static async Task UpdateZoneWaterUsedTotalAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, long zoneId, float newTotal)
    {
        await using var cmd = new NpgsqlCommand(
            "update zone set water_used_total = $1 where id = $2", connection, transaction);
        cmd.Parameters.AddWithValue(newTotal);
        cmd.Parameters.AddWithValue(zoneId);
        await cmd.ExecuteNonQueryAsync();
    }
}
