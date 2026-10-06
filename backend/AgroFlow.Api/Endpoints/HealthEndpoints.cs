using System.Diagnostics;
using System.Reflection;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Mqtt;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

/// One service, its traffic light, and a sentence a person can act on.
///
/// Status is deliberately three-valued and not a boolean. "Down" and
/// "degraded" need different reactions - a broker that is reconnecting is
/// not the same emergency as a database that cannot be reached - and the
/// console's amber state exists precisely so the second does not get the
/// same red treatment as the first.
public record HealthCheck(
    string Key,
    string Name,
    string Status,
    string Detail,
    double? ResponseMs = null);

public record HealthResponse(
    string Overall,
    string CheckedAt,
    IReadOnlyList<HealthCheck> Checks);

// GET /api/admin/health.
//
// WHY THIS EXISTS
// The console said "Monitoring not yet implemented" in three places - the
// header chip, the sidebar footer and the System Health card. That was
// honest, which is why it had survived, but it is not something to ship: an
// admin looking at a farm that is not reporting had no way to tell whether
// the problem was the kit, the broker or the API.
//
// Every check here answers a question somebody actually asks during an
// incident, and each one degrades on its own - a dead Telegram cannot stop
// the page reporting that the database is fine.
public static class HealthEndpoints
{
    // Statuses, as the console's badge tones.
    private const string Ok = "ok";
    private const string Warning = "warning";
    private const string Down = "down";

    public static void MapHealthEndpoints(this WebApplication app)
    {
        app.MapGet("/api/admin/health", GetHealthAsync)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();
    }

    private static async Task<IResult> GetHealthAsync(
        NpgsqlDataSource dataSource,
        MqttConnectionService mqtt,
        IOptions<TelegramOptions> telegram,
        TelegramPollingService poller,
        IConfiguration configuration,
        SchemaCheck schema,
        CancellationToken cancellationToken)
    {
        var checks = new List<HealthCheck>
        {
            CheckApi(),
            CheckDeployment(),
            await CheckDatabaseAsync(dataSource, cancellationToken),
            await CheckSchemaAsync(schema, cancellationToken),
            CheckMqtt(mqtt),
            CheckTelegram(telegram.Value, poller),
            await CheckWeatherAsync(dataSource, cancellationToken),
            await CheckDevicesAsync(dataSource, cancellationToken),
        };

        // The worst single check decides the overall light. An admin glancing
        // at the sidebar needs to know whether to look, not an average.
        var overall =
            checks.Any(c => c.Status == Down) ? Down :
            checks.Any(c => c.Status == Warning) ? Warning : Ok;

        return Results.Ok(new HealthResponse(
            overall,
            DateTimeOffset.UtcNow.ToString("o"),
            checks));
    }

    // ------------------------------------------------------------------

    private static HealthCheck CheckApi()
    {
        // The informational version carries the commit when the build set
        // one (Directory.Build.props / CI), and falls back to the assembly
        // version otherwise. Never throws: a missing attribute is not an
        // outage.
        var assembly = Assembly.GetEntryAssembly();

        var version =
            assembly?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? assembly?.GetName().Version?.ToString()
            ?? "unknown";

        // Trim the +sourcerevision suffix the SDK appends, which is noise in
        // a UI but useful enough to keep the short hash from.
        var plus = version.IndexOf('+');
        if (plus > 0 && version.Length > plus + 8)
        {
            version = version[..plus] + " (" + version.Substring(plus + 1, 7) + ")";
        }

        var uptime = DateTime.UtcNow - Process.GetCurrentProcess().StartTime.ToUniversalTime();

        return new HealthCheck(
            "api", "API", Ok,
            $"Version {version}. Running for {DescribeSpan(uptime)}.");
    }

    /// Which commit is actually running.
    ///
    /// WHY THIS IS A HEALTH CHECK AND NOT A FOOTNOTE
    /// "The code is pushed" and "the code is deployed" are two separate
    /// events, and nothing in this project reconciled them. An admin audit
    /// log that records nothing looks identical whether the feature is broken
    /// or simply not deployed yet, and the second is far more likely - but
    /// answering it meant opening the Railway dashboard and comparing a
    /// deployment id against a git log by eye.
    ///
    /// Railway injects these three on every deployment. Running anywhere
    /// else - a laptop, a different host - they are simply absent, which is
    /// reported as "not a Railway deployment" rather than as a fault.
    private static HealthCheck CheckDeployment()
    {
        var sha = Environment.GetEnvironmentVariable("RAILWAY_GIT_COMMIT_SHA");
        var branch = Environment.GetEnvironmentVariable("RAILWAY_GIT_BRANCH");
        var deployment = Environment.GetEnvironmentVariable("RAILWAY_DEPLOYMENT_ID");

        if (string.IsNullOrWhiteSpace(sha) && string.IsNullOrWhiteSpace(deployment))
        {
            return new HealthCheck(
                "deployment", "Deployment", Ok,
                "Running outside Railway (local or another host), so there is no deployment to report.");
        }

        var shortSha = string.IsNullOrWhiteSpace(sha) ? "unknown" : sha[..Math.Min(7, sha.Length)];
        var where = string.IsNullOrWhiteSpace(branch) ? "an unnamed branch" : branch;

        // A deployment built from anything but dev is worth an amber light:
        // dev is where this project's work lands, and main has sat far behind
        // it for months. Not red - deploying a release branch on purpose is
        // legitimate - but it should never be a surprise.
        var status = string.Equals(branch, "dev", StringComparison.OrdinalIgnoreCase) ? Ok : Warning;

        var detail = $"Commit {shortSha} from {where}."
            + (string.IsNullOrWhiteSpace(deployment) ? "" : $" Deployment {deployment[..Math.Min(8, deployment.Length)]}.")
            + (status == Warning ? " Work lands on dev - check this is the branch you meant to deploy." : "");

        return new HealthCheck("deployment", "Deployment", status, detail);
    }

    /// Have the migrations this build expects actually been applied?
    ///
    /// Migrations 0033 to 0036 were missed once already and nothing said so
    /// until a farmer's report failed with a bare 500. See Services/SchemaCheck.
    private static async Task<HealthCheck> CheckSchemaAsync(SchemaCheck schema, CancellationToken ct)
    {
        var result = await schema.RunAsync(ct);

        if (result.CouldNotCheck)
        {
            return new HealthCheck(
                "schema", "Database schema", Warning,
                "Could not be checked - see the database check above.");
        }

        var audit = await schema.CheckAuditWritableAsync(ct);

        if (result.AllPresent && audit.CanInsert)
        {
            return new HealthCheck(
                "schema", "Database schema", Ok,
                $"All {result.Present.Count} expected objects are present. {audit.Detail}");
        }

        // Down, not warning, when something is missing. A missing table is not
        // a degraded service - every endpoint that touches it returns an error
        // every single time, and that is what the sidebar light is for.
        var problems = new List<string>();

        if (result.Missing.Count > 0)
        {
            problems.Add($"Missing: {string.Join(", ", result.Missing)}.");
        }

        if (!audit.CanInsert) problems.Add(audit.Detail);

        return new HealthCheck(
            "schema", "Database schema",
            result.Missing.Count > 0 ? Down : Warning,
            string.Join(" ", problems) + " Nothing is applied automatically.");
    }

    private static async Task<HealthCheck> CheckDatabaseAsync(
        NpgsqlDataSource dataSource, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();

        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand("select 1", connection);
            await cmd.ExecuteScalarAsync(ct);

            sw.Stop();

            // A reachable but slow database is the shape of an incident
            // about to happen, and is worth amber before anything fails.
            var status = sw.ElapsedMilliseconds > 1500 ? Warning : Ok;

            return new HealthCheck(
                "database", "Database", status,
                status == Ok
                    ? $"Responding in {sw.ElapsedMilliseconds} ms."
                    : $"Responding slowly ({sw.ElapsedMilliseconds} ms). Supabase may be under load.",
                sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            return new HealthCheck(
                "database", "Database", Down,
                $"Could not be reached: {ex.Message}");
        }
    }

    private static HealthCheck CheckMqtt(MqttConnectionService mqtt) =>
        MqttCheck(mqtt.IsConnected, mqtt.DisconnectedSinceUtc, DateTimeOffset.UtcNow);

    /// DATA RULE: how long a broker may be out of reach before it is "down".
    public static readonly TimeSpan MqttDownAfter = TimeSpan.FromMinutes(2);

    // A short drop is amber: the loop retries every 10 s and usually
    // recovers. Out of reach for longer than MqttDownAfter is red (Part 2:
    // an unreachable broker must show as down, not as a blip).
    public static HealthCheck MqttCheck(bool connected, DateTimeOffset? disconnectedSinceUtc, DateTimeOffset nowUtc)
    {
        if (connected)
            return new HealthCheck("mqtt", "MQTT broker", Ok, "Connected. Readings and commands are flowing.");

        var gone = disconnectedSinceUtc is { } since ? nowUtc - since : TimeSpan.Zero;
        if (gone >= MqttDownAfter)
            return new HealthCheck("mqtt", "MQTT broker", Down,
                $"Could not be reached for {(int)gone.TotalMinutes} minutes. Kits cannot send readings or receive commands; retrying every 10 seconds.");

        return new HealthCheck("mqtt", "MQTT broker", Warning,
            "Not connected. Retrying every 10 seconds. Kits cannot send readings or receive commands.");
    }

    private static HealthCheck CheckTelegram(TelegramOptions options, TelegramPollingService poller)
    {
        if (!options.IsConfigured)
        {
            return new HealthCheck("telegram", "Telegram", Warning,
                "No bot token set, so no farmer alerts can be delivered.");
        }

        if (!options.EnablePolling)
        {
            // Correct on every instance but one. Said plainly so nobody
            // "fixes" it on a second container and starts stealing updates.
            return new HealthCheck("telegram", "Telegram", Ok,
                "Configured. Inbound polling is off on this instance, which is correct unless this is the only one.");
        }

        var last = poller.LastSuccessfulPollUtc;

        if (last is null)
        {
            return new HealthCheck("telegram", "Telegram", Warning,
                "Polling is on but has not completed a poll yet.");
        }

        var age = DateTimeOffset.UtcNow - last.Value;

        // getUpdates long-polls for 30 s, so a gap over about two minutes
        // means it is not coming back on its own.
        return age > TimeSpan.FromMinutes(2)
            ? new HealthCheck("telegram", "Telegram", Warning,
                $"Last poll {DescribeSpan(age)} ago. Inbound messages may not be arriving.")
            : new HealthCheck("telegram", "Telegram", Ok,
                $"Polling. Last update {DescribeSpan(age)} ago.");
    }

    private static async Task<HealthCheck> CheckWeatherAsync(
        NpgsqlDataSource dataSource, CancellationToken ct)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(ct);

            await using var cmd = new NpgsqlCommand(
                "select max(updated_at) from weather_daily", connection);

            var value = await cmd.ExecuteScalarAsync(ct);

            if (value is null || value is DBNull)
            {
                return new HealthCheck("weather", "Weather", Warning,
                    "No weather has been collected yet. Farms need coordinates before it can run.");
            }

            var last = (DateTimeOffset)value;
            var age = DateTimeOffset.UtcNow - last;

            // Collection runs every 6 hours; 12 is two missed cycles.
            return age > TimeSpan.FromHours(12)
                ? new HealthCheck("weather", "Weather", Warning,
                    $"Last refreshed {DescribeSpan(age)} ago. Advice is running on stale forecasts.")
                : new HealthCheck("weather", "Weather", Ok,
                    $"Last refreshed {DescribeSpan(age)} ago.");
        }
        catch (Exception ex)
        {
            return new HealthCheck("weather", "Weather", Warning,
                $"Could not be checked: {ex.Message}");
        }
    }

    private static async Task<HealthCheck> CheckDevicesAsync(
        NpgsqlDataSource dataSource, CancellationToken ct)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(ct);

            await using var cmd = new NpgsqlCommand(
                """
                select
                    count(*) filter (where h.enrollment_status = 'active')                  as total,
                    count(*) filter (where h.enrollment_status = 'active'
                                       and h.status = 'Online')                             as online,
                    (select max(recorded_at) from sensor_reading)                           as last_reading
                  from hardware h
                """,
                connection);

            await using var reader = await cmd.ExecuteReaderAsync(ct);

            if (!await reader.ReadAsync(ct))
            {
                return new HealthCheck("devices", "Kits", Warning, "Could not be counted.");
            }

            var total = reader.GetInt64(0);
            var online = reader.GetInt64(1);
            var lastReading = reader.IsDBNull(2)
                ? (DateTimeOffset?)null
                : reader.GetFieldValue<DateTimeOffset>(2);

            if (total == 0)
            {
                return new HealthCheck("devices", "Kits", Warning,
                    "No kits are enrolled yet.");
            }

            var detail = lastReading is null
                ? $"{online} of {total} online. No readings recorded yet."
                : $"{online} of {total} online. Last reading {DescribeSpan(DateTimeOffset.UtcNow - lastReading.Value)} ago.";

            // Every kit offline is a platform problem, not a farm problem -
            // that is the shape of a broker or API outage, so it is red.
            var status = online == 0 ? Down : online < total ? Warning : Ok;

            return new HealthCheck("devices", "Kits", status, detail);
        }
        catch (Exception ex)
        {
            return new HealthCheck("devices", "Kits", Warning,
                $"Could not be checked: {ex.Message}");
        }
    }

    // "4 minutes", "2 days" - the gap, not a timestamp, because every caller
    // here is reporting how long ago something happened.
    private static string DescribeSpan(TimeSpan span)
    {
        if (span < TimeSpan.Zero) span = TimeSpan.Zero;

        if (span.TotalMinutes < 1) return "less than a minute";
        if (span.TotalMinutes < 60) return $"{(int)span.TotalMinutes} minute{Plural(span.TotalMinutes)}";
        if (span.TotalHours < 24) return $"{(int)span.TotalHours} hour{Plural(span.TotalHours)}";

        return $"{(int)span.TotalDays} day{Plural(span.TotalDays)}";
    }

    private static string Plural(double n) => (int)n == 1 ? "" : "s";
}
