using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Microsoft.AspNetCore.Http.HttpResults;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

// Item 4 added the last four fields. Optional, so an older admin build that
// sends only the first four still saves exactly what it did before.
public record ReportScheduleBody(
    bool Enabled,
    string? Frequency,
    string[]? ReportTypes,
    long[]? ZoneIds,
    int? DayOfWeek = null,
    bool? PerZonePdf = null,
    bool? SendToHandler = null,
    bool? AdminChatEnabled = null);

public record ReportScheduleResponse(
    long FarmId,
    bool Enabled,
    string Frequency,
    string[] ReportTypes,
    long[]? ZoneIds,
    string? LastRunAt,
    string Description,
    // ---- item 4, additive ----
    int DayOfWeek,
    bool PerZonePdf,
    bool SendToHandler,
    bool AdminChatEnabled,
    string? LastSentAt,
    string? NextSendAt,
    string? TurnedOffBy,
    string? TurnedOffAt,
    // False until migration 0040 is applied: daily, a chosen day, per-zone
    // PDFs and extra recipients cannot be saved yet, and the page says so.
    bool OptionsAvailable);

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
    // A test send is for checking the template, not for flooding an admin's
    // phone with one PDF per zone of a twenty-zone farm.
    public const int MaxTestPdfs = 5;

    public static void MapReportScheduleEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/farms/{farmId:long}/report-schedule")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapGet("/", GetForAdminAsync);
        admin.MapPut("/", SaveAsync);
        admin.MapPost("/test", SendTestAsync);

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
                ReportSchedulePolicy.Describe(false, ReportFrequency.Weekly, Array.Empty<string>()),
                ReportSchedulePolicy.DefaultIsoDay, false, false, false, null, null, null, null,
                await OptionsAvailableAsync(connection, cancellationToken)));
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
            .Where(ReportSchedulePolicy.IsScheduleType)
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

        if (request.DayOfWeek is { } d && (d < 1 || d > 7))
        {
            return Results.BadRequest(new { error = "Choose a day from Monday to Sunday." });
        }

        var frequency = ReportSchedulePolicy.ParseFrequency(request.Frequency);

        // The actor is always the token's subject, never something in the body.
        Guid? actor = Guid.TryParse(user.FindFirstValue("sub"), out var adminId) ? adminId : null;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var before = await LoadAsync(connection, farmId, cancellationToken);
        var optionsAvailable = await OptionsAvailableAsync(connection, cancellationToken);

        var asksForNewOptions = frequency == ReportFrequency.Daily
            || ReportSchedulePolicy.IsoDay(request.DayOfWeek) != ReportSchedulePolicy.DefaultIsoDay
            || request.PerZonePdf == true || request.SendToHandler == true || request.AdminChatEnabled == true;

        if (asksForNewOptions && !optionsAvailable)
        {
            return Results.BadRequest(new
            {
                error = "Daily reports, a chosen weekday, one PDF per zone and extra recipients need database migration 0040, which has not been applied yet.",
            });
        }

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
            cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)actor ?? DBNull.Value);

            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }

        if (optionsAvailable)
        {
            var turningOff = before is { Enabled: true } && !request.Enabled;

            await using var cmd = new NpgsqlCommand(
                """
                update report_schedule
                   set day_of_week = $2,
                       per_zone_pdf = $3,
                       send_to_handler = $4,
                       admin_chat_enabled = $5,
                       turned_off_by = case when $6 then $7 else turned_off_by end,
                       turned_off_at = case when $6 then now() else turned_off_at end
                 where farm_id = $1
                """,
                connection);
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Smallint,
                frequency == ReportFrequency.Weekly ? (object)(short)ReportSchedulePolicy.IsoDay(request.DayOfWeek) : DBNull.Value);
            cmd.Parameters.AddWithValue(request.PerZonePdf ?? before?.PerZonePdf ?? false);
            cmd.Parameters.AddWithValue(request.SendToHandler ?? before?.SendToHandler ?? false);
            cmd.Parameters.AddWithValue(request.AdminChatEnabled ?? before?.AdminChatEnabled ?? false);
            cmd.Parameters.AddWithValue(turningOff);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)actor ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }

        // Deliberately does NOT touch last_run_at. Enabling a schedule must
        // not make this period look already-done, and disabling and
        // re-enabling must not resend a period the farmer already got.
        var saved = await LoadAsync(connection, farmId, cancellationToken);

        await audit.WriteAsync(
            user, AgroFlow.Api.Services.AuditActions.ReportScheduleChanged,
            "report_schedule", farmId.ToString(), farmId: farmId,
            details: new
            {
                request.Enabled,
                frequency = ReportSchedulePolicy.ToDatabaseValue(frequency),
                reportTypes = types,
                dayOfWeek = request.DayOfWeek,
                request.PerZonePdf,
                request.SendToHandler,
                request.AdminChatEnabled,
            },
            cancellationToken: cancellationToken);

        return Results.Ok(saved);
    }

    // Item 4: "Send test now" - the schedule's reports for its current period,
    // sent ONLY to the calling admin's own Telegram. Never the farmer, never
    // the group chat: a test must not look like a real report to anyone else.
    private static async Task<IResult> SendTestAsync(
        long farmId,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        AgroFlow.Business.Fao56EngineController engine,
        TelegramClient telegram,
        AgroFlow.Api.Services.AuditLog audit,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(user.FindFirstValue("sub"), out var adminId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var schedule = await LoadAsync(connection, farmId, cancellationToken);
        if (schedule is null || schedule.ReportTypes.Length == 0)
        {
            return Results.BadRequest(new { error = "Save a schedule with at least one report first." });
        }

        long? adminChat;
        await using (var cmd = new NpgsqlCommand(
            "select telegram_chat_id from profile where id = $1 and telegram_chat_id is not null", connection))
        {
            cmd.Parameters.AddWithValue(adminId);
            adminChat = await cmd.ExecuteScalarAsync(cancellationToken) as long?;
        }

        if (adminChat is null)
        {
            return Results.BadRequest(new
            {
                error = "Your own Telegram is not connected, so there is nowhere to send a test. Connect it under My account.",
            });
        }

        if (!telegram.IsConfigured)
        {
            return Results.BadRequest(new { error = "The Telegram bot is not configured on this server." });
        }

        var zoneIds = schedule.ZoneIds is { Length: > 0 }
            ? schedule.ZoneIds.ToList()
            : await FarmZonesAsync(connection, farmId, cancellationToken);

        var frequency = ReportSchedulePolicy.ParseFrequency(schedule.Frequency);
        var (from, to) = ReportSchedulePolicy.PeriodFor(
            frequency, schedule.DayOfWeek, ReportSchedulePolicy.ToSast(DateTimeOffset.UtcNow));

        var planned = ReportSchedulePolicy.RequestsFor(schedule.ReportTypes, schedule.PerZonePdf, zoneIds);
        var sent = 0;
        var failed = 0;

        foreach (var (type, zoneId) in planned.Take(MaxTestPdfs))
        {
            IResult result = type switch
            {
                ReportKinds.Moisture => await ReportEndpoints.GetMoisturePdfAsync(user, dataSource, zoneId, from, to, engine),
                ReportKinds.Schedule => await ReportEndpoints.GetSchedulePdfAsync(user, dataSource, farmId, engine, zoneId),
                _ => await ReportEndpoints.GetWaterUsagePdfAsync(user, dataSource, farmId, from, to, engine, zoneId, cancellationToken),
            };

            if (result is not FileContentHttpResult file)
            {
                failed++;
                continue;
            }

            var ok = await telegram.SendDocumentAsync(
                adminChat.Value, file.FileContents.ToArray(), file.FileDownloadName ?? "agroflow-test.pdf",
                $"TEST - not sent to the farmer. {ReportKinds.DisplayName(type)} ({ReportPeriods.Describe(from, to)}).",
                cancellationToken);

            if (ok) sent++; else failed++;
        }

        await audit.WriteAsync(
            user, AgroFlow.Api.Services.AuditActions.ReportScheduleChanged,
            "report_schedule", farmId.ToString(), farmId: farmId,
            details: new { test = true, sent, failed }, cancellationToken: cancellationToken);

        var skipped = Math.Max(0, planned.Count - MaxTestPdfs);
        return Results.Ok(new
        {
            sent,
            failed,
            skipped,
            message = sent == 0
                ? "The test could not be sent. Check that the bot can message you."
                : $"Sent {sent} test PDF{(sent == 1 ? "" : "s")} to your own Telegram." +
                  (skipped > 0 ? $" {skipped} more were left out of the test." : ""),
        });
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
            types.Select(ReportSchedulePolicy.DisplayName).ToArray(),
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

        long? changed;
        await using (var cmd = new NpgsqlCommand(
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
            connection))
        {
            cmd.Parameters.AddWithValue(userId);
            changed = await cmd.ExecuteScalarAsync(cancellationToken) as long?;
        }

        // Item 4: record that the farmer turned it off. Skipped quietly until
        // migration 0040 is applied - the off switch itself must always work.
        if (changed is { } farmId && await OptionsAvailableAsync(connection, cancellationToken))
        {
            await using var who = new NpgsqlCommand(
                "update report_schedule set turned_off_by = $2, turned_off_at = now() where farm_id = $1", connection);
            who.Parameters.AddWithValue(farmId);
            who.Parameters.AddWithValue(userId);
            await who.ExecuteNonQueryAsync(cancellationToken);
        }

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
        // 0040's columns through jsonb: null before the migration, so this
        // still answers on a database that does not have them.
        await using var cmd = new NpgsqlCommand(
            """
            select s.farm_id, s.enabled, s.frequency, s.report_types, s.zone_ids, s.last_run_at,
                   (to_jsonb(s) ->> 'day_of_week')::int,
                   coalesce((to_jsonb(s) ->> 'per_zone_pdf')::boolean, false),
                   coalesce((to_jsonb(s) ->> 'send_to_handler')::boolean, false),
                   coalesce((to_jsonb(s) ->> 'admin_chat_enabled')::boolean, false),
                   (select coalesce(nullif(p.name, ''), p.email) from profile p
                     where p.id = (to_jsonb(s) ->> 'turned_off_by')::uuid),
                   (to_jsonb(s) ->> 'turned_off_at')::timestamptz,
                   (select max(r.completed_at) from report_request r
                     where r.farm_id = s.farm_id and r.requested_via = 'auto' and r.status = 'ready')
              from report_schedule s
             where s.farm_id = $1
            """,
            connection);
        cmd.Parameters.AddWithValue(farmId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        var enabled = reader.GetBoolean(1);
        var frequency = ReportSchedulePolicy.ParseFrequency(reader.GetString(2));
        var types = reader.IsDBNull(3) ? Array.Empty<string>() : reader.GetFieldValue<string[]>(3);
        DateTimeOffset? lastRun = reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5);
        int? dayOfWeek = reader.IsDBNull(6) ? null : reader.GetInt32(6);

        var next = ReportSchedulePolicy.NextSend(
            enabled, frequency, dayOfWeek, lastRun, ReportSchedulePolicy.ToSast(DateTimeOffset.UtcNow));

        var response = new ReportScheduleResponse(
            reader.GetInt64(0),
            enabled,
            ReportSchedulePolicy.ToDatabaseValue(frequency),
            types,
            reader.IsDBNull(4) ? null : reader.GetFieldValue<long[]>(4),
            lastRun?.ToString("o"),
            ReportSchedulePolicy.Describe(enabled, frequency, types),
            ReportSchedulePolicy.IsoDay(dayOfWeek),
            reader.GetBoolean(7),
            reader.GetBoolean(8),
            reader.GetBoolean(9),
            reader.IsDBNull(12) ? null : reader.GetFieldValue<DateTimeOffset>(12).ToString("o"),
            next?.ToString("o"),
            reader.IsDBNull(10) ? null : reader.GetString(10),
            reader.IsDBNull(11) ? null : reader.GetFieldValue<DateTimeOffset>(11).ToString("o"),
            false);

        await reader.DisposeAsync();
        return response with { OptionsAvailable = await OptionsAvailableAsync(connection, cancellationToken) };
    }

    private static async Task<bool> OptionsAvailableAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns " +
            "where table_name = 'report_schedule' and column_name = 'per_zone_pdf')", connection);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    private static async Task<List<long>> FarmZonesAsync(NpgsqlConnection connection, long farmId, CancellationToken ct)
    {
        var ids = new List<long>();
        await using var cmd = new NpgsqlCommand(
            "select id from zone where farm_id = $1 and lower(coalesce(status, 'active')) <> 'inactive' order by id", connection);
        cmd.Parameters.AddWithValue(farmId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) ids.Add(reader.GetInt64(0));
        return ids;
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);
}
