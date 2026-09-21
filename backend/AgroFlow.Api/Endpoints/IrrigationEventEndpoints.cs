using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// EstimatedLitres is accepted but IGNORED, and is nullable so current firmware
// can stop sending it altogether. It exists only so a board still running the
// old sketch keeps posting successfully during the window before it is
// reflashed. Nothing reads it: zone.flow_rate_lpm is the single source of
// truth for turning runtime into litres. Once every board is reflashed this
// field can be deleted outright.
public record IrrigationEventRequest(
    long ZoneId,
    int RuntimeSeconds,
    string TriggerSource,
    string SyncStatus,
    DateTimeOffset? StartedAt,
    float? EstimatedLitres = null);

// EstimatedLitres is null when the zone has no flow_rate_lpm configured - that
// is "no estimate can be made", which is the honest answer and is stored as
// NULL rather than a zero that would read as "no water used". IsMeasured is
// always false and is there to stop a caller rendering this as a meter
// reading: no flow meter exists anywhere in AgroFlow.
public record IrrigationEventResponse(float WaterUsedTotal, float? EstimatedLitres, bool IsMeasured, string LitresBasis);

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
        // Structural validation first, BEFORE opening a connection or a
        // transaction. Litres are passed as 0 here deliberately: the device no
        // longer supplies a volume, so there is nothing of its to validate yet.
        // Zero is always valid, so this call is exactly the zoneId / runtime /
        // triggerSource / syncStatus checks.
        var validationError = IrrigationEventValidation.Validate(
            request.ZoneId, request.RuntimeSeconds, 0f,
            request.TriggerSource, request.SyncStatus);

        if (validationError is not null)
        {
            return Results.BadRequest(validationError);
        }

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        // zone.flow_rate_lpm is THE source of truth for litres.
        //
        // This used to fall back to whatever the device sent when the zone had
        // no rate configured. That meant the same event could be valued two
        // ways - the board's compiled-in constant or the zone's column -
        // depending on a row nobody had filled in. The fallback is gone: with
        // no configured rate there is no estimate, and the event is stored with
        // estimated_litres NULL rather than a number derived from a guess.
        //
        // Correcting a zone's rate is now a database update, not a reflash.
        //
        // Either way this is an ESTIMATE - there is no flow meter anywhere in
        // AgroFlow - which is why the response says so explicitly.
        var flowRate = await FetchZoneFlowRateAsync(connection, transaction, request.ZoneId);
        var serverEstimate = WaterUsageEstimator.EstimateEventLitres(request.RuntimeSeconds, flowRate);

        float? estimatedLitres = serverEstimate is not null ? (float)serverEstimate.Litres : null;

        var litresBasis = serverEstimate is not null
            ? serverEstimate.Basis
            : "no estimate available: zone.flow_rate_lpm is not configured for this zone, and no flow meter exists to measure the volume";

        // Re-validate with the volume the server actually derived. The device's
        // number never reaches this point, but an absurd flow_rate_lpm typed
        // into the zone row could still produce an implausible volume, and that
        // should be rejected rather than persisted.
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

        await InsertIrrigationEventAsync(connection, transaction, request, estimatedLitres);

        // Row lock so a concurrent request for the same zone can't read the same
        // starting total and clobber this update (lost-update race). The removed
        // Postgres trigger did this increment atomically in a single SQL
        // statement; locking the row for the duration of this transaction is the
        // equivalent guarantee now that the read/compute/write happens in
        // application code instead.
        var currentTotal = await FetchZoneWaterUsedTotalForUpdateAsync(connection, transaction, request.ZoneId);

        // Only a real estimate moves the running total. An unconfigured zone
        // leaves water_used_total untouched rather than adding a zero that would
        // later be indistinguishable from a cycle that genuinely delivered
        // nothing.
        var newTotal = currentTotal;
        if (estimatedLitres is not null)
        {
            // The domain layer decides the new total - this endpoint's job is
            // just to lock, fetch, persist.
            var zone = new Zone { WaterUsedTotal = currentTotal };
            newTotal = zone.AddWaterUsage(estimatedLitres.Value);

            await UpdateZoneWaterUsedTotalAsync(connection, transaction, request.ZoneId, newTotal);
        }

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
        float? estimatedLitres)
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
