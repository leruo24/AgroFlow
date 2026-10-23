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
/// Three states, not a boolean, because a reconnecting broker (amber) is not the
/// same emergency as an unreachable database (red).
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

// GET /api/admin/health: tells an admin whether a problem is the kit, the broker
// or the API. Each check runs on its own, so one failure cannot hide the others.
public static class HealthEndpoints
{
    // Statuses, matching the console's badge colours.
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
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        // Technical detail (SQL errors, hosts) goes to this log only; staff get a plain
        // sentence with a reference they can quote (AF-15).
        var log = loggerFactory.CreateLogger("AgroFlow.Api.Health");
        var checks = new List<HealthCheck>
        {
            CheckApi(),
            CheckDeployment(),
            await CheckDatabaseAsync(dataSource, log, cancellationToken),
            await CheckSchemaAsync(schema, cancellationToken),
            CheckMqtt(mqtt),
            CheckTelegram(telegram.Value, poller),
            await CheckWeatherAsync(dataSource, log, cancellationToken),
            await CheckDevicesAsync(dataSource, log, cancellationToken),
        };

        // The worst single check sets the overall light.
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
        // The informational version includes the commit when the build sets one, and
        // falls back to the assembly version. A missing attribute is not an outage.
        var assembly = Assembly.GetEntryAssembly();

        var version =
            assembly?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? assembly?.GetName().Version?.ToString()
            ?? "unknown";

        // Trim the +sourcerevision suffix, but keep the short hash.
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

    /// Which commit is running, so we can tell "pushed" from "deployed".
    /// Railway sets these variables on every deployment; anywhere else they are
    /// missing and we report "not a Railway deployment" instead of a fault.
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

        // A deployment from any branch but dev gets amber: dev is where our work lands.
        // Not red, because deploying another branch on purpose is fine.
        var status = string.Equals(branch, "dev", StringComparison.OrdinalIgnoreCase) ? Ok : Warning;

        var detail = $"Commit {shortSha} from {where}."
            + (string.IsNullOrWhiteSpace(deployment) ? "" : $" Deployment {deployment[..Math.Min(8, deployment.Length)]}.")
            + (status == Warning ? " Work lands on dev - check this is the branch you meant to deploy." : "");

        return new HealthCheck("deployment", "Deployment", status, detail);
    }

    /// Have the migrations this build expects been applied? See Services/SchemaCheck.
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

        // A missing table is red, not amber: every endpoint that uses it fails every time.
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
        NpgsqlDataSource dataSource, ILogger log, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();

        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand("select 1", connection);
            await cmd.ExecuteScalarAsync(ct);

            sw.Stop();

            // A slow but reachable database is worth amber before anything fails.
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
            log.LogError(ex, "Health check database: could not be reached (reference health-database).");
            return new HealthCheck(
                "database", "Database", Down,
                "Could not be reached. Check the database connection on Railway (reference health-database in the API log).");
        }
    }

    private static HealthCheck CheckMqtt(MqttConnectionService mqtt) =>
        MqttCheck(mqtt.IsConnected, mqtt.DisconnectedSinceUtc, DateTimeOffset.UtcNow);

    /// DATA RULE: how long the broker may be unreachable before it counts as down.
    public static readonly TimeSpan MqttDownAfter = TimeSpan.FromMinutes(2);

    // A short drop is amber because the loop retries every 10 s. Longer than
    // MqttDownAfter is red.
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
            // Only one instance may poll Telegram; we say so plainly so nobody "fixes" it
            // and starts stealing updates.
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

        // getUpdates long-polls for 30 s, so a gap over about two minutes means it is
        // not recovering on its own.
        return age > TimeSpan.FromMinutes(2)
            ? new HealthCheck("telegram", "Telegram", Warning,
                $"Last poll {DescribeSpan(age)} ago. Inbound messages may not be arriving.")
            : new HealthCheck("telegram", "Telegram", Ok,
                $"Polling. Last update {DescribeSpan(age)} ago.");
    }

    private static async Task<HealthCheck> CheckWeatherAsync(
        NpgsqlDataSource dataSource, ILogger log, CancellationToken ct)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(ct);

            await using var cmd = new NpgsqlCommand(
                // weather_daily has fetched_at (0016), not updated_at: the old query failed with 42703.
                "select max(fetched_at) from weather_daily", connection);

            // fetched_at is timestamptz. ExecuteScalar hands it back as a DateTime (Kind Utc),
            // which cannot be unboxed to DateTimeOffset (the InvalidCastException in production);
            // reading the field as DateTimeOffset gives the same instant with offset 0.
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct) || reader.IsDBNull(0))
            {
                return new HealthCheck("weather", "Weather", Warning,
                    "No weather has been collected yet. Farms need coordinates before it can run.");
            }

            var last = reader.GetFieldValue<DateTimeOffset>(0);
            var age = DateTimeOffset.UtcNow - last;

            // Collection runs every 6 hours; 12 hours is two missed runs.
            return age > TimeSpan.FromHours(12)
                ? new HealthCheck("weather", "Weather", Warning,
                    $"Last refreshed {DescribeSpan(age)} ago. Advice is running on stale forecasts.")
                : new HealthCheck("weather", "Weather", Ok,
                    $"Last refreshed {DescribeSpan(age)} ago.");
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Health check weather: the query failed (reference health-weather).");
            return new HealthCheck("weather", "Weather", Warning,
                "Weather status unavailable: the check itself failed, so this says nothing about the forecasts. Reference health-weather in the API log.");
        }
    }

    private static async Task<HealthCheck> CheckDevicesAsync(
        NpgsqlDataSource dataSource, ILogger log, CancellationToken ct)
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

            // Every kit offline points to a broker or API outage, so it is red.
            var status = online == 0 ? Down : online < total ? Warning : Ok;

            return new HealthCheck("devices", "Kits", status, detail);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Health check devices: the query failed (reference health-devices).");
            return new HealthCheck("devices", "Kits", Warning,
                "Kit status unavailable: the check itself failed. Reference health-devices in the API log.");
        }
    }

    // "4 minutes", "2 days": how long ago, not a timestamp.
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
