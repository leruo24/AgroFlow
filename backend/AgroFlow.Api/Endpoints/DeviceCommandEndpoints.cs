using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// DeviceId is still accepted so old boards' ACKs parse, but on a token call it
// is ignored: the device comes from the credential.
public record CommandExecutedRequest(string? DeviceId, DateTimeOffset? ExecutedAt);

public record CommandExecutedResponse(Guid CommandId, string Status, DateTimeOffset ExecutedAt);

// The board confirms here that it carried out an irrigation command.
// It goes through the API like every other device call and is written as the
// `postgres` role, which owns the table and so bypasses RLS. Clients only have
// SELECT on irrigation_commands (0011), because writes there drive a real valve.
// The firmware holds no Supabase credentials.
public static class DeviceCommandEndpoints
{
    public static void MapDeviceCommandEndpoints(this WebApplication app)
    {
        // Security: protected by the device-key middleware in Program.cs, like
        // /api/devices/claim and /api/irrigation-events.
        app.MapPost("/api/devices/commands/{id}/executed", HandleAsync);
    }

    private static async Task<IResult> HandleAsync(
        string id,
        CommandExecutedRequest request,
        HttpContext context,
        DeviceAuthService deviceAuth,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(id, out var commandId))
        {
            return Results.BadRequest("Command id must be a UUID.");
        }

        // Security: the board's identity comes from its token, not the request body.
        // Otherwise any board with the shared key could confirm another board's
        // commands and stop the replay sweep for a run that never happened.
        // A legacy shared-key board can only be checked the old way.
        var device = await deviceAuth.AuthenticateAsync(context, cancellationToken);

        if (device is null)
        {
            return Results.Json(
                new { error = "A valid X-Device-Token is required." },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var callerDeviceId = device.IsLegacyApiKey ? request.DeviceId : device.DeviceId;

        if (string.IsNullOrWhiteSpace(callerDeviceId))
        {
            return Results.BadRequest("deviceId is required.");
        }

        var executedAt = request.ExecutedAt ?? DateTimeOffset.UtcNow;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var ownership = await ResolveCommandOwnershipAsync(connection, commandId);
        if (ownership is null)
        {
            return Results.NotFound($"No irrigation command with id {commandId}.");
        }

        // This device must own the zone the command was for. On a token call both
        // sides come from the server, so a board cannot confirm another zone's command.
        if (!DeviceCommandOwnership.MayAcknowledge(ownership.DeviceId, callerDeviceId))
        {
            // 404, not 403, so a device cannot probe which command ids exist.
            return Results.NotFound($"No irrigation command with id {commandId} for this device.");
        }

        // Idempotent: the firmware retries and the sweep can resend, so the same ACK
        // can arrive twice. The first one wins and keeps its executed_at.
        if (ownership.Status == "executed")
        {
            return Results.Ok(new CommandExecutedResponse(
                commandId, "executed", ownership.ExecutedAt ?? executedAt));
        }

        var updated = await MarkExecutedAsync(connection, commandId, executedAt);
        if (!updated)
        {
            // Lost a race with another ACK, or the sweep marked it 'failed'. The pump did
            // run, so report the current row instead of an error the board would retry forever.
            var current = await ResolveCommandOwnershipAsync(connection, commandId);
            return Results.Ok(new CommandExecutedResponse(
                commandId, current?.Status ?? "unknown", current?.ExecutedAt ?? executedAt));
        }

        return Results.Ok(new CommandExecutedResponse(commandId, "executed", executedAt));
    }

    private sealed record CommandOwnership(string? DeviceId, string Status, DateTimeOffset? ExecutedAt);

    // Finds which device should run this command (irrigation_commands -> zone ->
    // hardware). Null when the command does not exist; a null DeviceId when its zone
    // has no active device.
    private static async Task<CommandOwnership?> ResolveCommandOwnershipAsync(
        NpgsqlConnection connection, Guid commandId)
    {
        await using var cmd = new NpgsqlCommand(
            "select c.status, c.executed_at, h.device_id " +
            "from irrigation_commands c " +
            "left join hardware h on h.zone_id = c.zone_id and h.enrollment_status = 'active' " +
            "where c.id = $1", connection);
        cmd.Parameters.AddWithValue(commandId);

        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;

        return new CommandOwnership(
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1));
    }

    private static async Task<bool> MarkExecutedAsync(
        NpgsqlConnection connection, Guid commandId, DateTimeOffset executedAt)
    {
        // The status = 'pending' check makes this compare-and-set, so two ACKs cannot
        // both win.
        await using var cmd = new NpgsqlCommand(
            "update irrigation_commands set status = 'executed', executed_at = $2 " +
            "where id = $1 and status = 'pending'", connection);
        cmd.Parameters.AddWithValue(commandId);
        cmd.Parameters.AddWithValue(executedAt);

        return await cmd.ExecuteNonQueryAsync() > 0;
    }
}
