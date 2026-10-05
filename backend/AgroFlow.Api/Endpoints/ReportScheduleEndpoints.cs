using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

public record ReportScheduleBody(
    bool Enabled,
    string? Frequency,
    string[]? ReportTypes,
    long[]? ZoneIds);

public record ReportScheduleResponse(
    long FarmId,
    bool Enabled,
    string Frequency,
    string[] ReportTypes,
    long[]? ZoneIds,
    string? LastRunAt,
    string Description);

public record AutoReportSummaryResponse(
    bool Enabled,
    string? Frequency,
    string[] ReportTypes,
    string[] ReportTypeLabels,
    string Description);

// Who gets automatic reports, and the farmer's own off switch.
//
// The asymmetry is deliberate: an ADMIN decides what a farm is signed up for,
// because they are the ones who agreed it with the farmer and who will be
// asked why a PDF arrived. A FARMER can always stop it, without asking
// anybody, because the alternative is them muting the bot - and the bot also
// carries the frost warnings.
public static class ReportScheduleEndpoints
{
    public static void MapReportScheduleEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/farms/{farmId:long}/report-schedule")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapGet("/", GetForAdminAsync);
        admin.MapPut("/", SaveAsync);

        var farmer = app.MapGroup("/api/farmer/auto-reports").RequireAuthorization();

        farmer.MapGet("/", GetForFarmerAsync);
        farmer.MapPost("/stop", StopAsync);
    }

    // ------------------------------------------------------------------
    // ADMIN
    // ------------------------------------------------------------------

    private static async Task<IResult> GetForAdminAsync(
        long farmId, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var row = await LoadAsync(connection, farmId, cancellationToken);

        // No row yet is the normal state, not a 404 - the admin page needs
        // something to render the "off" form against.
        if (row is null)
        {
            return Results.Ok(new ReportScheduleResponse(
                farmId, false, "weekly", new[] { ReportKinds.WaterUsage }, null, null,
                ReportSchedulePolicy.Describe(false, ReportFrequency.Weekly, Array.Empty<string>())));
        }

        return Results.Ok(row);
    }

    private static async Task<IResult> SaveAsync(
        long farmId,
        ReportScheduleBody request,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        AgroFlow.Api.Services.AuditLog audit,
        CancellationToken cancellationToken)
    {
        var types = (request.ReportTypes ?? Array.Empty<string>())
            .Select(t => t?.Trim().ToLowerInvariant() ?? string.Empty)
            .Where(ReportKinds.IsValid)
            .Distinct()
            .ToArray();

        // Refused rather than saved as a schedule that would wake the service
        // every hour to produce nothing. Constrained in the database too
        // (0035), so a direct write cannot create one either.
        if (request.Enabled && types.Length == 0)
        {
            return Results.BadRequest(new
            {
                error = "Choose at least one report to send.",
            });
        }

        var frequency = ReportSchedulePolicy.ParseFrequency(request.Frequency);

        Guid? createdBy = Guid.TryParse(user.FindFirstValue("sub"), out var adminId) ? adminId : null;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        await using (var cmd = new NpgsqlCommand(
            """
            insert into report_schedule (farm_id, enabled, frequency, report_types, zone_ids, created_by)
            values ($1, $2, $3, $4, $5, $6)
            on conflict (farm_id) do update
               set enabled = excluded.enabled,
                   frequency = excluded.frequency,
                   report_types = excluded.report_types,
                   zone_ids = excluded.zone_ids,
                   updated_at = now()
            """,
            connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(request.Enabled);
            cmd.Parameters.AddWithValue(ReportSchedulePolicy.ToDatabaseValue(frequency));
            cmd.Parameters.AddWithValue(types.Length == 0 ? new[] { ReportKinds.WaterUsage } : types);
            // An empty list means "all zones", which is null - never an empty
            // array, which would mean "no zones" and silently send nothing.
            cmd.Parameters.AddWithValue(
                NpgsqlDbType.Array | NpgsqlDbType.Bigint,
                request.ZoneIds is { Length: > 0 } ? request.ZoneIds : (object)DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)createdBy ?? DBNull.Value);

            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }

        // Deliberately does NOT touch last_run_at. Enabling a schedule must
        // not make this period look already-done, and disabling and
        // re-enabling must not resend a period the farmer already got.
        var saved = await LoadAsync(connection, farmId, cancellationToken);

        await audit.WriteAsync(
            user, AgroFlow.Api.Services.AuditActions.ReportScheduleChanged,
            "report_schedule", farmId.ToString(), farmId: farmId,
            details: new { request.Enabled, frequency = ReportSchedulePolicy.ToDatabaseValue(frequency), reportTypes = types },
            cancellationToken: cancellationToken);

        return Results.Ok(saved);
    }

    // ------------------------------------------------------------------
    // FARMER
    // ------------------------------------------------------------------

    private static async Task<IResult> GetForFarmerAsync(
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        try
        {
            return await GetForFarmerInnerAsync(userId, dataSource, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // "No automatic reports" is the honest answer when the table is
            // not there yet, and it is also the right one: nothing IS being
            // sent. A 500 here would break the whole Reports screen for a
            // card that is hidden anyway when disabled.
            loggerFactory
                .CreateLogger("AgroFlow.Api.ReportSchedule")
                .LogError(ex, "Could not read the auto-report schedule for {ProfileId}.", userId);

            return Results.Ok(new AutoReportSummaryResponse(
                false, null, Array.Empty<string>(), Array.Empty<string>(),
                ReportSchedulePolicy.Describe(false, ReportFrequency.Weekly, Array.Empty<string>())));
        }
    }

    private static async Task<IResult> GetForFarmerInnerAsync(
        Guid userId, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        await using var cmd = new NpgsqlCommand(
            """
            select s.enabled, s.frequency, s.report_types
              from report_schedule s
              join farm f on f.farm_id = s.farm_id
             where lower(coalesce(f.status, 'active')) <> 'inactive'
               and (f.owner_id = $1 or exists (
                    select 1 from farm_member fm
                     where fm.farm_id = s.farm_id and fm.profile_id = $1))
             order by s.farm_id
             limit 1
            """,
            connection);
        cmd.Parameters.AddWithValue(userId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken))
        {
            // No schedule is an ordinary answer - most farms have none. The
            // Reports screen hides the card on `enabled: false`.
            return Results.Ok(new AutoReportSummaryResponse(
                false, null, Array.Empty<string>(), Array.Empty<string>(),
                ReportSchedulePolicy.Describe(false, ReportFrequency.Weekly, Array.Empty<string>())));
        }

        var enabled = reader.GetBoolean(0);
        var frequency = ReportSchedulePolicy.ParseFrequency(reader.GetString(1));
        var types = reader.IsDBNull(2) ? Array.Empty<string>() : reader.GetFieldValue<string[]>(2);

        return Results.Ok(new AutoReportSummaryResponse(
            enabled,
            ReportSchedulePolicy.ToDatabaseValue(frequency),
            types,
            types.Select(ReportKinds.DisplayName).ToArray(),
            ReportSchedulePolicy.Describe(enabled, frequency, types)));
    }

    // The farmer's own off switch.
    //
    // Scoped by the farm-access check in the WHERE clause, so it can only ever
    // turn off a schedule on a farm this farmer is actually on - naming
    // somebody else's farm is impossible because no farm id is accepted at
    // all. There is deliberately no matching "on": an admin sets up what a
    // farmer receives, and a farmer can always stop it.
    private static async Task<IResult> StopAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        await using var cmd = new NpgsqlCommand(
            """
            update report_schedule s
               set enabled = false, updated_at = now()
              from farm f
             where f.farm_id = s.farm_id
               and s.enabled
               and (f.owner_id = $1 or exists (
                    select 1 from farm_member fm
                     where fm.farm_id = s.farm_id and fm.profile_id = $1))
            returning s.farm_id
            """,
            connection);
        cmd.Parameters.AddWithValue(userId);

        var changed = await cmd.ExecuteScalarAsync(cancellationToken);

        return Results.Ok(new
        {
            message = changed is null
                ? "Automatic reports were already off."
                : "Automatic reports are off. You can still ask for a report any time.",
        });
    }

    // ------------------------------------------------------------------

    private static async Task<ReportScheduleResponse?> LoadAsync(
        NpgsqlConnection connection, long farmId, CancellationToken cancellationToken)
    {
        await using var cmd = new NpgsqlCommand(
            "select farm_id, enabled, frequency, report_types, zone_ids, last_run_at " +
            "from report_schedule where farm_id = $1", connection);
        cmd.Parameters.AddWithValue(farmId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        var enabled = reader.GetBoolean(1);
        var frequency = ReportSchedulePolicy.ParseFrequency(reader.GetString(2));
        var types = reader.IsDBNull(3) ? Array.Empty<string>() : reader.GetFieldValue<string[]>(3);

        return new ReportScheduleResponse(
            reader.GetInt64(0),
            enabled,
            ReportSchedulePolicy.ToDatabaseValue(frequency),
            types,
            reader.IsDBNull(4) ? null : reader.GetFieldValue<long[]>(4),
            reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5).ToString("o"),
            ReportSchedulePolicy.Describe(enabled, frequency, types));
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);
}
