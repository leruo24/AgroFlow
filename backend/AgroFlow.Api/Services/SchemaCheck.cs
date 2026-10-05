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

/// Is the database actually running the migrations this build expects?
///
/// WHY THIS EXISTS
/// Migrations 0033 to 0036 were missed. Nothing said so. The first anybody
/// knew was a farmer's report failing with a bare 500, and the real cause -
/// `relation "report_request" does not exist` - was four layers down in a
/// Railway log nobody was reading. Every endpoint that touched those tables
/// had been quietly broken for days.
///
/// The gap is structural: migrations are applied by hand in the Supabase SQL
/// editor, so "the code is deployed" and "the schema is migrated" are two
/// separate events that nothing reconciles. This reconciles them, at boot and
/// on demand, and says which migration is missing rather than which relation.
///
/// STRICTLY READ-ONLY. It never applies anything. A self-healing migration
/// runner is the kind of thing that works for a year and then rewrites a
/// production table during an incident; the whole point here is to make the
/// human apply it knowingly.
public sealed class SchemaCheck
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<SchemaCheck> _logger;

    public SchemaCheck(NpgsqlDataSource dataSource, ILogger<SchemaCheck> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    /// The objects worth checking: one cheap existence test per migration from
    /// 0027, which is where the hand-applied range begins.
    ///
    /// Deliberately NOT every object each migration creates. This is a smoke
    /// test - if a migration ran at all, it ran to the end, because each file
    /// is a single statement batch. One well-chosen object per file catches a
    /// skipped file, which is the failure that actually happened.
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

        // A grant, not an object. Probed by asking whether the privilege is
        // there rather than whether something exists, because that IS what
        // the migration does - and because the symptom of its absence (every
        // admin action succeeds, nothing is recorded) is the hardest in this
        // list to trace back to a cause.
        new("0038", "grant", "insert on admin_audit_log",
            "select 1 where has_table_privilege('service_role', 'public.admin_audit_log', 'INSERT')",
            "Admin actions are not recorded if the API does not connect as the table's owner."),

        // Not a migration, but applied by hand in the same way and just as
        // invisible when missed: the private bucket report PDFs are stored in.
        new("storage", "bucket", "reports",
            "select 1 from storage.buckets where id = 'reports'",
            "Generated reports cannot be stored or re-downloaded."),
    };

    /// The migration numbers this check knows about.
    ///
    /// Exposed so a test can hold it against the files on disk: adding a
    /// migration without adding a probe here is the same mistake that let
    /// 0033-0036 go unnoticed, and it should fail the build rather than wait
    /// to be discovered by a farmer.
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
                    // A probe that cannot run is a missing object as far as
                    // this is concerned - storage.buckets does not exist at
                    // all on a database where Storage was never enabled, and
                    // that is exactly the thing worth reporting.
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
            // The database being unreachable is a different problem, already
            // reported by its own health check. Saying "every migration is
            // missing" here would bury it.
            _logger.LogWarning(ex, "The schema check could not reach the database.");

            return new SchemaCheckResult(
                Array.Empty<string>(), Array.Empty<string>(),
                CouldNotCheck: true,
                Problem: ex.Message);
        }

        return new SchemaCheckResult(missing, present, CouldNotCheck: false, Problem: null);
    }

    /// One line per missing object, at Warning, naming the migration and what
    /// it breaks. Called once at boot.
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
            "supabase/migrations in order - see scripts/apply-migrations.ps1 - then restart. " +
            "Nothing is applied automatically.",
            result.Missing.Count);
    }

    /// Can this connection actually write an audit row?
    ///
    /// Asked separately from "does the table exist", because the two fail for
    /// completely different reasons and the fix is different. 0037 grants
    /// INSERT to nobody: it relies on the API connecting as the table's owner,
    /// which is true for a connection string using the `postgres` role and not
    /// true for every other role somebody might reasonably configure. When it
    /// is not true, every admin action still succeeds and the Activity page
    /// stays empty - which is precisely the symptom that is hard to diagnose
    /// without being told.
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
