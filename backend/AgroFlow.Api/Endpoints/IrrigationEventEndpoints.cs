using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public record IrrigationEventRequest(
    long ZoneId,
    int RuntimeSeconds,
    float EstimatedLitres,
    string TriggerSource,
    string SyncStatus,
    DateTimeOffset? StartedAt);

// EstimatedLitres is echoed back because the server may have recomputed it
// from the zone's configured flow rate rather than using what the device
// sent - see HandleAsync. IsMeasured is always false and is there to stop a
// caller rendering this as a meter reading: no flow meter exists anywhere in
// AgroFlow.
public record IrrigationEventResponse(float WaterUsedTotal, float EstimatedLitres, bool IsMeasured, string LitresBasis);

// Replaces the ESP32's direct POST to Supabase's irrigation_event REST
// endpoint, and replaces the removed Postgres water-usage trigger
// (update_zone_water_usage in the now-dropped 0006_backend_irrigation_logic.sql)
// with the equivalent increment done in C# via Zone.AddWaterUsage.
public static class IrrigationEventEndpoints
{
    public static void MapIrrigationEventEndpoints(this WebApplication app)
    {
        app.MapPost("/api/irrigation-events", HandleAsync);
    }

    private static async Task<IResult> HandleAsync(IrrigationEventRequest request, NpgsqlDataSource dataSource)
    {
        // Validate BEFORE opening a connection or a transaction.
        //
        // This used to check only zoneId/triggerSource/syncStatus, so a
        // negative runtime or a negative estimatedLitres was accepted and
        // silently SUBTRACTED from zone.water_used_total via Zone.AddWaterUsage
        // below. Nothing recomputes that running total from the event rows, so
        // the corruption never healed. The rules live in the domain layer
        // (IrrigationEventValidation) and are unit-tested there; the reason
        // string goes back in the 400 body so a device developer can see which
        // field was rejected instead of guessing.
        var validationError = IrrigationEventValidation.Validate(
            request.ZoneId, request.RuntimeSeconds, request.EstimatedLitres,
            request.TriggerSource, request.SyncStatus);

        if (validationError is not null)
        {
            return Results.BadRequest(validationError);
        }

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        // Prefer the zone's configured flow rate over whatever the device
        // sent.
        //
        // The firmware computes litres from PUMP_FLOW_LPS, a single hardcoded
        // constant compiled into every board (0.05 L/s, marked a placeholder
        // in the sketch). zone.flow_rate_lpm (migration 0018) is per zone and
        // server-side, so it can be corrected for a zone whose emitters or
        // line size differ WITHOUT reflashing anything. When it is set, it
        // wins; when it is not, the device's own estimate is used unchanged.
        //
        // Either way this is an ESTIMATE - there is no flow meter - which is
        // why the response says so explicitly.
        var flowRate = await FetchZoneFlowRateAsync(connection, transaction, request.ZoneId);
        var serverEstimate = WaterUsageEstimator.EstimateEventLitres(request.RuntimeSeconds, flowRate);

        var estimatedLitres = serverEstimate is not null
            ? (float)serverEstimate.Litres
            : request.EstimatedLitres;

        var litresBasis = serverEstimate is not null
            ? serverEstimate.Basis
            : "reported by the device from its compiled-in flow constant; zone.flow_rate_lpm is not configured for this zone";

        await InsertIrrigationEventAsync(connection, transaction, request, estimatedLitres);

        // Row lock so a concurrent request for the same zone can't read the same
        // starting total and clobber this update (lost-update race). The removed
        // Postgres trigger did this increment atomically in a single SQL
        // statement; locking the row for the duration of this transaction is the
        // equivalent guarantee now that the read/compute/write happens in
        // application code instead.
        var currentTotal = await FetchZoneWaterUsedTotalForUpdateAsync(connection, transaction, request.ZoneId);

        // The domain layer decides the new total - this endpoint's job is just
        // to lock, fetch, persist.
        var zone = new Zone { WaterUsedTotal = currentTotal };
        var newTotal = zone.AddWaterUsage(estimatedLitres);

        await UpdateZoneWaterUsedTotalAsync(connection, transaction, request.ZoneId, newTotal);

        await transaction.CommitAsync();

        return Results.Ok(new IrrigationEventResponse(newTotal, estimatedLitres, IsMeasured: false, litresBasis));
    }

    // Null when the zone has no flow rate configured. Read inside the same
    // transaction as the water-total update so it cannot change underneath
    // this event.
    private static async Task<double?> FetchZoneFlowRateAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select flow_rate_lpm from zone where id = $1", connection, transaction);
        cmd.Parameters.AddWithValue(zoneId);

        var result = await cmd.ExecuteScalarAsync();
        return result is float f ? f : result is double d ? d : (double?)null;
    }

    private static async Task InsertIrrigationEventAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, IrrigationEventRequest request,
        float estimatedLitres)
    {
        // started_at omitted entirely (falls back to Postgres's own now()
        // default) when the firmware didn't have a valid NTP-synced clock at
        // cycle start - same fallback behaviour as when it posted directly to
        // Supabase.
        var sql = request.StartedAt.HasValue
            ? "insert into irrigation_event (zone_id, runtime_seconds, estimated_litres, trigger_source, sync_status, started_at) values ($1, $2, $3, $4, $5, $6)"
            : "insert into irrigation_event (zone_id, runtime_seconds, estimated_litres, trigger_source, sync_status) values ($1, $2, $3, $4, $5)";

        await using var cmd = new NpgsqlCommand(sql, connection, transaction);
        cmd.Parameters.AddWithValue(request.ZoneId);
        cmd.Parameters.AddWithValue(request.RuntimeSeconds);
        cmd.Parameters.AddWithValue(estimatedLitres);
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
