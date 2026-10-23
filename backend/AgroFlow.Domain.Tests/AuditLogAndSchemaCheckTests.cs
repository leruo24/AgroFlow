using System.Security.Claims;
using System.Text.RegularExpressions;
using AgroFlow.Api.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace AgroFlow.Domain.Tests;

// The audit log's two contracts, and the schema check that exists so missed
// migrations cannot go unnoticed again.
//
// WHAT IS AND IS NOT COVERED HERE, PLAINLY
// There is no test database in this project - the one other test that touches
// Npgsql points at an unreachable port on purpose, to prove resilience. So
// "an audit row lands in the table when the endpoint runs" is NOT asserted
// here; that needs a live Postgres and is checked by hand against the running
// API (GET /api/admin/health reports whether the write is even permitted).
//
// What IS asserted is the part that silently breaks: the writer must never
// take the action down with it, must never let a caller name somebody else as
// the actor, and the schema check must grow a probe whenever a migration is
// added. The last one is the whole point - 0033 to 0036 were missed and
// nothing said so.
public class AuditLogAndSchemaCheckTests
{
    // Port 1, one-second timeout: nothing listens, so every command fails
    // fast rather than making the suite wait. Same trick as
    // FarmRequestNotifierResilienceTests.
    private static NpgsqlDataSource UnreachableDatabase() =>
        NpgsqlDataSource.Create(
            "Host=127.0.0.1;Port=1;Database=nope;Username=nope;Password=nope;" +
            "Timeout=1;Command Timeout=1");

    /// Captures what was logged, so a test can assert that a failure was
    /// reported rather than swallowed.
    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            Entries.Add((logLevel, formatter(state, exception)));
        }
    }

    /* ------------------------------------------------------------------ *
     * The writer
     * ------------------------------------------------------------------ */

    [Fact]
    public async Task AFailedAuditWrite_DoesNotThrow()
    {
        // THE contract. An audit row must never be the reason an admin action
        // fails: revoking a stolen kit has to work during the one incident
        // the log exists to record.
        await using var database = UnreachableDatabase();
        var audit = new AuditLog(database, NullLogger<AuditLog>.Instance);

        var exception = await Record.ExceptionAsync(() => audit.WriteAsync(
            actorProfileId: Guid.NewGuid(),
            action: AuditActions.RequestStatusChanged,
            entityType: "service_request",
            entityId: "1"));

        Assert.Null(exception);
    }

    [Fact]
    public async Task AFailedAuditWrite_IsLoggedWithAReason()
    {
        // Swallowing it quietly is how "the Activity page is empty" became
        // impossible to diagnose: every admin action succeeded and nothing
        // anywhere said why nothing was recorded.
        await using var database = UnreachableDatabase();
        var logger = new CapturingLogger<AuditLog>();
        var audit = new AuditLog(database, logger);

        await audit.WriteAsync(
            actorProfileId: Guid.NewGuid(),
            action: AuditActions.AlertAssigned,
            entityType: "alert",
            entityId: "ALT-1");

        var entry = Assert.Single(logger.Entries);

        Assert.True(entry.Level >= LogLevel.Warning, "a dropped audit row must not be logged below Warning");
        Assert.Contains("alert", entry.Message, StringComparison.OrdinalIgnoreCase);

        // The message has to carry the action AND say the action itself still
        // happened, or whoever reads it will assume the admin's work was lost.
        Assert.Contains(AuditActions.AlertAssigned, entry.Message, StringComparison.Ordinal);
        Assert.Contains("succeeded", entry.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TheActorComesFromTheJwtOnly()
    {
        // There is no overload that takes an actor NAME, and the
        // ClaimsPrincipal overload reads "sub" and nothing else. If somebody
        // later adds a parameter for it, this stops compiling - which is the
        // point. A caller that could name the actor could write anybody's
        // name into a permanent record.
        await using var database = UnreachableDatabase();
        var audit = new AuditLog(database, NullLogger<AuditLog>.Instance);

        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("sub", Guid.NewGuid().ToString()),

            // Deliberately contradictory. None of these may be read.
            new Claim("name", "Somebody Else"),
            new Claim(ClaimTypes.Name, "Also Not This"),
        }, "test"));

        var exception = await Record.ExceptionAsync(() => audit.WriteAsync(
            principal, AuditActions.FarmArchived, "farm", "1"));

        Assert.Null(exception);
    }

    [Fact]
    public async Task AnUnauthenticatedPrincipal_StillWritesRatherThanThrowing()
    {
        // A background job or a token without `sub` must still produce a row -
        // with an unknown actor - rather than an exception that takes the
        // action down. "We do not know who" is a fact worth recording.
        await using var database = UnreachableDatabase();
        var audit = new AuditLog(database, NullLogger<AuditLog>.Instance);

        var exception = await Record.ExceptionAsync(() => audit.WriteAsync(
            new ClaimsPrincipal(new ClaimsIdentity()),
            AuditActions.ReportScheduleChanged, "report_schedule", "1"));

        Assert.Null(exception);
    }

    /* ------------------------------------------------------------------ *
     * The schema check
     * ------------------------------------------------------------------ */

    [Fact]
    public async Task AnUnreachableDatabase_IsNotReportedAsEveryMigrationMissing()
    {
        // If it were, a database outage would print twelve "migration not
        // applied" warnings and bury the one line that matters. The database
        // has its own health check; this one steps aside.
        await using var database = UnreachableDatabase();
        var check = new SchemaCheck(database, NullLogger<SchemaCheck>.Instance);

        var result = await check.RunAsync();

        Assert.True(result.CouldNotCheck);
        Assert.Empty(result.Missing);
        Assert.False(result.AllPresent);
        Assert.NotNull(result.Problem);
    }

    [Fact]
    public async Task AnUnreachableDatabase_ReportsTheAuditLogAsNotWritable()
    {
        // Not writable, and it says why rather than claiming a permission
        // problem it has not established.
        await using var database = UnreachableDatabase();
        var check = new SchemaCheck(database, NullLogger<SchemaCheck>.Instance);

        var (canInsert, detail) = await check.CheckAuditWritableAsync();

        Assert.False(canInsert);
        Assert.NotEmpty(detail);
    }

    [Fact]
    public async Task StartupLogging_SaysItCouldNotCheck_RatherThanSayingNothing()
    {
        await using var database = UnreachableDatabase();
        var logger = new CapturingLogger<SchemaCheck>();
        var check = new SchemaCheck(database, logger);

        await check.LogAtStartupAsync();

        Assert.Contains(logger.Entries, e =>
            e.Level >= LogLevel.Warning &&
            e.Message.Contains("could not verify", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void EveryMigrationFromApplyingByHandHasAProbe()
    {
        // THE TEST THIS FILE EXISTS FOR.
        //
        // Migrations are applied by hand in the Supabase SQL editor, so "the
        // code is deployed" and "the schema is migrated" are separate events
        // that nothing reconciles. SchemaCheck reconciles them - but only for
        // the migrations somebody remembered to add a probe for, which is the
        // same class of mistake all over again.
        //
        // So: the probe list is checked against the files on disk. Add
        // migration 0039 and this fails until SchemaCheck knows about it.
        var repoRoot = FindRepoRoot();
        var migrations = Path.Combine(repoRoot, "supabase", "migrations");

        Assert.True(Directory.Exists(migrations), $"migrations folder not found at {migrations}");

        var numbers = Directory.GetFiles(migrations, "*.sql")
            .Select(Path.GetFileName)
            .Select(name => Regex.Match(name!, @"^(\d{4})_"))
            .Where(m => m.Success)
            .Select(m => m.Groups[1].Value)
            // 0027 is where the hand-applied range begins; everything before
            // it was in place long before this project's current work.
            .Where(n => string.CompareOrdinal(n, "0027") >= 0)
            .Distinct()
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

        Assert.NotEmpty(numbers);

        var probed = SchemaCheck.ProbedMigrations;

        var unprobed = numbers.Where(n => !probed.Contains(n)).ToList();

        Assert.True(
            unprobed.Count == 0,
            $"Migration(s) {string.Join(", ", unprobed)} have no probe in SchemaCheck. " +
            "Add one, or a missed migration will go unnoticed exactly as 0033-0036 did.");
    }

    [Fact]
    public void EveryRegclassOrRegprocedureProbeIsReadAsText()
    {
        // Production (2026-10-23): two probes returned regprocedure, which Npgsql cannot read,
        // and the whole schema check reported "could not be checked". A probe that selects a
        // to_regclass / to_regprocedure / to_regtype value must cast it to text. (Used inside a
        // condition, "... is null", the answer is a boolean and needs no cast.)
        var source = File.ReadAllText(Path.Combine(FindRepoRoot(), "backend", "AgroFlow.Api", "Services", "SchemaCheck.cs"));
        var probes = Regex.Matches(source, @"select\s+to_reg(class|procedure|proc|type|namespace)\('[^']*'\)(::text)?");
        Assert.NotEmpty(probes);
        var uncast = probes.Where(m => !m.Groups[2].Success).Select(m => m.Value).ToList();
        Assert.True(uncast.Count == 0, $"Read these as text (add ::text): {string.Join(", ", uncast)}");
    }

    /// Walks up from the test assembly until the repo root is found. The test
    /// host's working directory is bin/Debug/net8.0, which is three levels
    /// below the project and five below the root.
    private static string FindRepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "supabase", "migrations")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException(
            "Could not find the repo root (looked for supabase/migrations above " +
            AppContext.BaseDirectory + ").");
    }
}
