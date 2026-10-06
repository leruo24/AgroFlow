using System.Globalization;
using System.Security.Claims;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

// Item 6: what was done - never who did it. The person is the login's subject.
public record ManualWateringBody(double? Minutes, double? Litres, DateTimeOffset? At);
public record SoilFeelBody(string? Feel, DateTimeOffset? At);

// "I watered" and "How does the soil feel?" - for farms without a kit, or a
// kit that is offline (item 6). Both feed the water balance, both are labelled
// as entered by hand, and both appear in reports and the history.
//
// Not a device route: the kit's own POST /api/irrigation-events is untouched.
public static class ManualLogEndpoints
{
    // DATA RULES: limits that catch a slip of the thumb, not real waterings.
    public const double MaxMinutes = 600;     // ten hours
    public const double MaxLitres = 10_000;   // a large bed, hosed for a long time
    public const int MaxDaysBack = 7;         // older than a week no longer changes today's advice

    public static void MapManualLogEndpoints(this WebApplication app)
    {
        var farmer = app.MapGroup("/api/farmer/zones/{zoneId:long}").RequireAuthorization();
        farmer.MapPost("/manual-watering", LogWateringAsync);
        farmer.MapPost("/soil-feel", LogSoilFeelAsync);
    }

    /// The checks both routes share, pure so they can be tested. Null = fine.
    public static string? CheckWatering(ManualWateringBody body, DateTimeOffset now)
    {
        if (body.Minutes is null && body.Litres is null) return "Say how long you watered, or roughly how many litres.";
        if (body.Minutes is { } m && (m <= 0 || m > MaxMinutes)) return $"Minutes must be between 1 and {MaxMinutes:0}.";
        if (body.Litres is { } l && (l <= 0 || l > MaxLitres)) return $"Litres must be between 0.1 and {MaxLitres:0}.";
        return CheckWhen(body.At, now);
    }

    public static string? CheckFeel(SoilFeelBody body, DateTimeOffset now)
    {
        if (body.Feel?.Trim().ToLowerInvariant() is not ("dry" or "moist" or "wet")) return "Choose dry, moist or wet.";
        return CheckWhen(body.At, now);
    }

    private static string? CheckWhen(DateTimeOffset? at, DateTimeOffset now)
    {
        if (at is null) return null;
        if (at.Value > now.AddMinutes(5)) return "That time is in the future.";
        if (at.Value < now.AddDays(-MaxDaysBack)) return $"You can log up to {MaxDaysBack} days back.";
        return null;
    }

    private static async Task<IResult> LogWateringAsync(
        long zoneId, ManualWateringBody body, ClaimsPrincipal user,
        NpgsqlDataSource dataSource, Fao56EngineController engine, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        var now = DateTimeOffset.UtcNow;
        if (CheckWatering(body, now) is { } problem) return Results.BadRequest(new { error = problem });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await ColumnExistsAsync(connection, "irrigation_event", "logged_by_profile_id", ct))
        {
            return Results.Conflict(new { error = "Logging by hand needs database migration 0042, which has not been applied yet." });
        }

        // Litres: what the farmer said, else minutes x the zone's flow rate
        // (the 0018 formula), else unknown - never a made-up 0.
        await using var cmd = new NpgsqlCommand(
            """
            insert into irrigation_event
                (zone_id, started_at, runtime_seconds, estimated_litres, trigger_source, sync_status, logged_by_profile_id)
            select $1, $2, $3,
                   coalesce($4, case when $3 > 0 and z.flow_rate_lpm > 0 then round(($3 / 60.0 * z.flow_rate_lpm)::numeric, 2) end),
                   'manual', 'synced', $5
              from zone z where z.id = $1
            returning id
            """,
            connection);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, (body.At ?? now).ToUniversalTime());
        cmd.Parameters.AddWithValue(NpgsqlDbType.Integer, (int)Math.Round((body.Minutes ?? 0) * 60));
        cmd.Parameters.AddWithValue(NpgsqlDbType.Numeric, body.Litres is { } l ? (object)Math.Round((decimal)l, 2) : DBNull.Value);
        cmd.Parameters.AddWithValue(userId);
        var id = await cmd.ExecuteScalarAsync(ct);

        return Results.Ok(new
        {
            id,
            message = "Watering logged. Today's advice now counts it.",
        });
    }

    private static async Task<IResult> LogSoilFeelAsync(
        long zoneId, SoilFeelBody body, ClaimsPrincipal user,
        NpgsqlDataSource dataSource, Fao56EngineController engine, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        var now = DateTimeOffset.UtcNow;
        if (CheckFeel(body, now) is { } problem) return Results.BadRequest(new { error = problem });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await ColumnExistsAsync(connection, "soil_feel_check", "feel", ct))
        {
            return Results.Conflict(new { error = "Soil checks need database migration 0042, which has not been applied yet." });
        }

        await using var cmd = new NpgsqlCommand(
            "insert into soil_feel_check (zone_id, feel, checked_at, profile_id) values ($1, $2, $3, $4) returning id", connection);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(body.Feel!.Trim().ToLowerInvariant());
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, (body.At ?? now).ToUniversalTime());
        cmd.Parameters.AddWithValue(userId);
        var id = await cmd.ExecuteScalarAsync(ct);

        return Results.Ok(new
        {
            id,
            message = "Thanks - today's advice now uses your soil check.",
        });
    }

    private static async Task<bool> ColumnExistsAsync(NpgsqlConnection connection, string table, string column, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = $1 and column_name = $2)", connection);
        cmd.Parameters.AddWithValue(table);
        cmd.Parameters.AddWithValue(column);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out userId);
}
