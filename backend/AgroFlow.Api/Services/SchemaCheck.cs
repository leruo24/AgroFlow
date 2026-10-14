using Npgsql;

namespace AgroFlow.Api.Services;

/// One thing a migration created, and how to ask whether it is there.
internal sealed record SchemaObject(
    string Migration,
    string Kind,
    string Name,
    string Sql,
    string WhatBreaks);

/// What a schema probe found.
public sealed record SchemaCheckResult(
    IReadOnlyList<string> Missing,
    IReadOnlyList<string> Present,
    bool CouldNotCheck,
    string? Problem)
{
    public bool AllPresent => Missing.Count == 0 && !CouldNotCheck;
}

/// Checks whether the database has the migrations this build expects.
/// Migrations are applied by hand in the Supabase SQL editor, so "code deployed" and
/// "schema migrated" can drift apart, and a missing migration only showed up as a
/// failing report. This checks at boot and on demand and names the missing migration.
/// Read-only: it never applies anything, so a person applies migrations knowingly.
public sealed class SchemaCheck
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<SchemaCheck> _logger;

    public SchemaCheck(NpgsqlDataSource dataSource, ILogger<SchemaCheck> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    /// One cheap existence test per migration from 0027 (where hand-applied migrations
    /// start). Each file runs as one batch, so one object per file is enough to catch a
    /// skipped file.
    private static readonly SchemaObject[] Expected =
    {
        new("0027", "table", "zone_water_balance",
            "select to_regclass('public.zone_water_balance')",
            "The FAO-56 engine cannot store or read its water balance."),

        new("0028", "column", "hardware.device_token_hash",
            "select 1 from information_schema.columns where table_name = 'hardware' and column_name = 'device_token_hash'",
            "Per-device tokens: kits cannot authenticate individually."),

        new("0029", "table", "mqtt_credential_pool",
            "select to_regclass('public.mqtt_credential_pool')",
            "No MQTT logins can be issued to new kits."),

        new("0030", "constraint", "irrigation_commands accepts setup commands",
            "select 1 from pg_constraint where conname = 'irrigation_commands_command_check' and pg_get_constraintdef(oid) like '%change_wifi%'",
            "Nothing can be sent to a kit - no WiFi change and no setup mode."),

        new("0031", "policy", "zone_water_balance_all_admin",
            "select 1 from pg_policies where tablename = 'zone_water_balance' and policyname = 'zone_water_balance_all_admin'",
            "Admins cannot read the engine's water balance."),

        new("0032", "table", "service_request_notification",
            "select to_regclass('public.service_request_notification')",
            "Farmers get no Telegram message when a request changes, or get the same one twice."),

        new("0033", "column", "alert.read_at",
            "select 1 from information_schema.columns where table_name = 'alert' and column_name = 'read_at'",
            "Whether a farmer ever saw an alert is not recorded."),

        new("0034", "table", "report_request",
            "select to_regclass('public.report_request')",
            "\"Make me this report\" in the app fails outright - this is the one that caused the 500."),

        new("0035", "table", "report_schedule",
            "select to_regclass('public.report_schedule')",
            "Automatic weekly and monthly reports never run."),

        new("0036", "function", "archive_farm",
            "select to_regprocedure('public.archive_farm(bigint)')",
            "Farms cannot be archived, so test farms stay in every list and total."),

        new("0037", "table", "admin_audit_log",
            "select to_regclass('public.admin_audit_log')",
            "No administrator action is recorded - the Activity page stays empty."),

        // A grant, not an object, so we check the privilege itself. Without it every admin
        // action succeeds but nothing is recorded, which is very hard to trace.
        new("0038", "grant", "insert on admin_audit_log",
            "select 1 where has_table_privilege('service_role', 'public.admin_audit_log', 'INSERT')",
            "Admin actions are not recorded if the API does not connect as the table's owner."),

        new("0039", "table", "explanation",
            "select to_regclass('public.explanation')",
            "Telegram messages go out without a \"Why am I seeing this?\" button."),

        new("0040", "column", "report_schedule.per_zone_pdf",
            "select 1 from information_schema.columns where table_name = 'report_schedule' and column_name = 'per_zone_pdf'",
            "Automatic reports cannot be daily, on a chosen weekday or per zone; extra recipients are ignored."),

        new("0041", "column", "alert.handled_by_profile_id",
            "select 1 from information_schema.columns where table_name = 'alert' and column_name = 'handled_by_profile_id'",
            "Nobody can claim, take over, resolve or complete alerts, requests or maintenance on the record."),

        new("0042", "table", "soil_feel_check",
            "select to_regclass('public.soil_feel_check')",
            "Farmers cannot log \"I watered\" or \"How does the soil feel?\" - farms without a kit get weather-only advice."),

        new("0043", "function", "zone_farmer_edit_guard",
            "select to_regprocedure('public.zone_farmer_edit_guard()')",
            "A farmer's own login could change any zone column directly, including the watering thresholds."),

        new("0044", "table", "enquiry",
            "select to_regclass('public.enquiry')",
            "The public \"Get a call back\" form cannot take enquiries, and the Enquiries tab is empty."),

        new("0045", "table", "dismissal",
            "select to_regclass('public.dismissal')",
            "Notifications cannot be dismissed or restored, and there is no notification history."),

        new("0046", "table", "tank_refill",
            "select to_regclass('public.tank_refill')",
            "Tank estimates, refill logging and pH records are unavailable."),

        // Not a migration, but also applied by hand: the private storage bucket for report PDFs.
        new("storage", "bucket", "reports",
            "select 1 from storage.buckets where id = 'reports'",
            "Generated reports cannot be stored or re-downloaded."),
    };

    /// The migration numbers this check knows about. A test compares it with the files
    /// on disk, so adding a migration without a probe fails the build.
    public static IReadOnlySet<string> ProbedMigrations { get; } =
        Expected.Select(e => e.Migration).ToHashSet();

    public async Task<SchemaCheckResult> RunAsync(CancellationToken ct = default)
    {
        var missing = new List<string>();
        var present = new List<string>();

        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(ct);

            foreach (var expected in Expected)
            {
                bool found;

                try
                {
                    await using var cmd = new NpgsqlCommand(expected.Sql, connection);
                    var value = await cmd.ExecuteScalarAsync(ct);
                    found = value is not null && value is not DBNull;
                }
                catch (PostgresException ex)
                {
                    // A probe that cannot run counts as missing: storage.buckets does not exist at all
                    // where Storage was never enabled, which is worth reporting.
                    _logger.LogDebug(ex,
                        "Schema probe for {Migration} ({Name}) could not run.",
                        expected.Migration, expected.Name);
                    found = false;
                }

                if (found) present.Add(expected.Name);
                else missing.Add($"{expected.Migration}: {expected.Name}");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // An unreachable database is reported by its own health check; saying every
            // migration is missing would hide that.
            _logger.LogWarning(ex, "The schema check could not reach the database.");

            return new SchemaCheckResult(
                Array.Empty<string>(), Array.Empty<string>(),
                CouldNotCheck: true,
                Problem: ex.Message);
        }

        return new SchemaCheckResult(missing, present, CouldNotCheck: false, Problem: null);
    }

    /// One Warning line per missing object, naming the migration and what it breaks.
    /// Called once at boot.
    public async Task LogAtStartupAsync(CancellationToken ct = default)
    {
        var result = await RunAsync(ct);

        if (result.CouldNotCheck)
        {
            _logger.LogWarning(
                "Could not verify the database schema at startup: {Problem}. " +
                "The API will still serve requests; see GET /api/admin/health.",
                result.Problem);
            return;
        }

        if (result.AllPresent)
        {
            _logger.LogInformation(
                "Database schema check passed: all {Count} expected objects are present.",
                result.Present.Count);
            return;
        }

        foreach (var missing in result.Missing)
        {
            var parts = missing.Split(": ", 2);
            var expected = Expected.FirstOrDefault(e => e.Migration == parts[0]);

            _logger.LogWarning(
                "Migration {Migration} not applied: {Name} missing. {WhatBreaks}",
                parts[0],
                parts.Length > 1 ? parts[1] : "object",
                expected?.WhatBreaks ?? "Something that depends on it will fail.");
        }

        _logger.LogWarning(
            "{Count} expected database object(s) are missing. Apply the migrations in " +
            "supabase/migrations in order - see supabase/scripts/apply-migrations.ps1 - then restart. " +
            "Nothing is applied automatically.",
            result.Missing.Count);
    }

    /// Can this connection write an audit row?
    /// Checked apart from "does the table exist" because the fix is different. 0037 grants
    /// INSERT to nobody and relies on the API connecting as the table owner (`postgres`).
    /// With another role every admin action still succeeds but the Activity page stays empty.
    public async Task<(bool CanInsert, string Detail)> CheckAuditWritableAsync(
        CancellationToken ct = default)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(ct);

            await using var cmd = new NpgsqlCommand(
                """
                select current_user,
                       to_regclass('public.admin_audit_log') is not null,
                       coalesce(
                           has_table_privilege(current_user, 'public.admin_audit_log', 'INSERT'),
                           false)
                """,
                connection);

            await using var reader = await cmd.ExecuteReaderAsync(ct);

            if (!await reader.ReadAsync(ct))
            {
                return (false, "The privilege check returned nothing.");
            }

            var role = reader.GetString(0);
            var tableExists = reader.GetBoolean(1);
            var canInsert = !reader.IsDBNull(2) && reader.GetBoolean(2);

            if (!tableExists)
            {
                return (false, "admin_audit_log does not exist - migration 0037 has not been applied.");
            }

            return canInsert
                ? (true, $"Writable as \"{role}\".")
                : (false,
                   $"The API connects as \"{role}\", which may not INSERT into admin_audit_log. " +
                   "Admin actions will still work but nothing will be recorded. Apply migration 0038.");
        }
        catch (PostgresException ex) when (ex.SqlState == "42P01")
        {
            return (false, "admin_audit_log does not exist - migration 0037 has not been applied.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return (false, $"Could not check: {ex.Message}");
        }
    }
}
