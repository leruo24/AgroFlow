using AgroFlow.Api.Services;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// DeviceId is still accepted so a v1.1.0 board's ACK still parses, but on a
// token-authenticated call it is IGNORED: the device is resolved from the
// credential instead. Nullable because the identity no longer has to come
// from the body at all.
public record CommandExecutedRequest(string? DeviceId, DateTimeOffset? ExecutedAt);

public record CommandExecutedResponse(Guid CommandId, string Status, DateTimeOffset ExecutedAt);

// Device-side acknowledgement that an irrigation command was carried out.
//
// WHY THIS EXISTS
// ---------------
// The ESP32 used to mark a command executed by PATCHing Supabase's REST API
// directly (applySupabaseHeaders / markCommandExecuted in
// AgroFlowIrrigationNode.ino). That path was dead in two separate ways:
//
//   1. It used placeholder credentials - SUPABASE_URL and SUPABASE_ANON_KEY
//      were still "YOUR_PROJECT_REF" and "YOUR_SUPABASE_ANON_KEY" in the
//      committed sketch.
//   2. Even fully configured it would have failed. Migration 0011 turned RLS
//      on for irrigation_commands and deliberately granted the anon/
//      authenticated roles SELECT only - there is no UPDATE policy, by
//      design, because an anon INSERT or UPDATE there drives a physical
//      valve. A firmware PATCH with an anon key would be silently refused.
//
// So acknowledgements never landed, every executed command stayed 'pending'
// forever, and the manual-override cooldown in SensorReadingProcessor - which
// keys off status = 'pending' - treated every past manual command as still
// outstanding.
//
// The fix is to route the ACK through AgroFlow.Api like every other device
// call: X-Api-Key gated, written with Npgsql as the `postgres` role, which
// owns the table and so bypasses RLS (0011's header explains why ENABLE and
// not FORCE). The firmware no longer holds any Supabase credential at all.
//
// FILE OWNERSHIP: this deliberately lives in its own file rather than in
// DeviceEnrollmentEndpoints.cs, which is being worked on elsewhere. Nothing
// here touches enrollment or claim.
public static class DeviceCommandEndpoints
{
    public static void MapDeviceCommandEndpoints(this WebApplication app)
    {
        // Gated by the X-Api-Key middleware in Program.cs: the path does not
        // start with /api/devices/enroll, /api/farmers or /api/farmer, so the
        // shared device secret is required, exactly like /api/devices/claim
        // and /api/irrigation-events.
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

        // v1.3.0: the identity comes out of the credential.
        //
        // This used to read a deviceId out of the REQUEST BODY and compare it
        // to the zone's hardware row. That check was only ever as strong as
        // the shared X-Api-Key behind it: any board holding the fleet key
        // could claim to be any other board and acknowledge its commands -
        // including marking executed a command its own zone never ran, which
        // suppresses the replay sweep for a pump run that never physically
        // happened.
        //
        // Now the token resolves the board, and the body's deviceId is
        // ignored. A legacy shared-key board keeps the old behaviour, because
        // it cannot be resolved any other way.
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

        // The ownership check the task calls for: this device must own the
        // zone the command was issued for. On a token call both sides of this
        // comparison are now server-derived - the left from the command's
        // zone, the right from the credential - so a board genuinely cannot
        // acknowledge another zone's command.
        if (!string.Equals(ownership.DeviceId, callerDeviceId, StringComparison.OrdinalIgnoreCase))
        {
            // Deliberately 404, not 403: a device that is not on this zone
            // should not be able to probe which command ids exist.
            return Results.NotFound($"No irrigation command with id {commandId} for this device.");
        }

        // Idempotent by design. The firmware retries on a failed ACK, and the
        // replay sweep can redeliver a command the device already ran, so the
        // same ACK legitimately arrives more than once. The first one wins and
        // its executed_at is preserved - overwriting it with a later retry's
        // timestamp would misreport when the pump actually ran.
        if (ownership.Status == "executed")
        {
            return Results.Ok(new CommandExecutedResponse(
                commandId, "executed", ownership.ExecutedAt ?? executedAt));
        }

        var updated = await MarkExecutedAsync(connection, commandId, executedAt);
        if (!updated)
        {
            // Lost a race with a concurrent ACK, or the row moved to 'failed'
            // (the replay sweep expires stale commands). Either way the device
            // did run the pump, so report what the row says now rather than
            // returning an error the firmware would retry forever.
            var current = await ResolveCommandOwnershipAsync(connection, commandId);
            return Results.Ok(new CommandExecutedResponse(
                commandId, current?.Status ?? "unknown", current?.ExecutedAt ?? executedAt));
        }

        return Results.Ok(new CommandExecutedResponse(commandId, "executed", executedAt));
    }

    private sealed record CommandOwnership(string? DeviceId, string Status, DateTimeOffset? ExecutedAt);

    // Resolves which device is expected to run this command, via
    // irrigation_commands -> zone -> hardware. Returns null when the command
    // does not exist; returns a row with a null DeviceId when the command
    // exists but its zone has no active claimed device.
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
        // The status = 'pending' guard makes this a compare-and-set, so two
        // concurrent ACKs cannot both claim to have been the one that landed.
        await using var cmd = new NpgsqlCommand(
            "update irrigation_commands set status = 'executed', executed_at = $2 " +
            "where id = $1 and status = 'pending'", connection);
        cmd.Parameters.AddWithValue(commandId);
        cmd.Parameters.AddWithValue(executedAt);

        return await cmd.ExecuteNonQueryAsync() > 0;
    }
}
