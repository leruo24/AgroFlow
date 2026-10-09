using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;

namespace AgroFlow.Api.Endpoints;

// One or more username/password pairs pasted from the HiveMQ console. Pasted in
// bulk because the free plan has no credential API, and typing them one by one
// invites mistakes.
public record AddMqttLoginsRequest(string Pasted);

public record AddMqttLoginsResponse(int Added, int Duplicates, int Skipped, int FreeCount, bool RunningLow, string Message);

// The admin "MQTT logins" page.
// Security: no endpoint here returns a password. Passwords only leave the server
// through GET /api/devices/mqtt-credentials, to the device that owns the entry.
// The page lists usernames, status and dates only (ListAsync does not even
// select the encrypted column).
public static class MqttPoolEndpoints
{
    public static void MapMqttPoolEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/mqtt-logins")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapGet("/", ListAsync);
        admin.MapPost("/", AddAsync);
    }

    private static async Task<IResult> ListAsync(
        MqttCredentialPoolService pool, CancellationToken cancellationToken)
    {
        var summary = await pool.ListAsync(cancellationToken);

        return Results.Ok(new
        {
            entries = summary.Entries,
            freeCount = summary.FreeCount,
            assignedCount = summary.AssignedCount,
            burnedCount = summary.BurnedCount,
            runningLow = summary.RunningLow,
            warning = summary.RunningLow
                ? $"Only {summary.FreeCount} free login(s) left. Create more in the HiveMQ console and paste " +
                  "them in below - a kit that claims with an empty pool falls back to the shared credential."
                : null,
        });
    }

    private static async Task<IResult> AddAsync(
        AddMqttLoginsRequest request,
        System.Security.Claims.ClaimsPrincipal user,
        MqttCredentialPoolService pool,
        AuditLog audit,
        CancellationToken cancellationToken)
    {
        if (!pool.IsConfigured)
        {
            // Security: refuse instead of storing passwords in plain text when there is no key.
            return Results.Problem(
                title: "Mqtt:PoolEncryptionKey is not configured.",
                detail: "Pooled passwords are encrypted at rest, so no login can be stored until " +
                        "Mqtt__PoolEncryptionKey is set on the server. Generate one with `openssl rand -base64 32`.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var parsed = MqttPoolPasteParser.Parse(request.Pasted);
        var credentials = parsed.Credentials;
        var skipped = parsed.Skipped;

        if (credentials.Count == 0)
        {
            return Results.BadRequest(new
            {
                error = "No username/password pairs were found. Put one pair per line, " +
                        "separated by a space, comma, colon or tab.",
            });
        }

        var (added, duplicates) = await pool.AddAsync(
            credentials.Select(c => (c.Username, c.Password)), cancellationToken);

        var summary = await pool.ListAsync(cancellationToken);

        // Security: log counts only, never usernames or passwords.
        await audit.WriteAsync(
            user, AuditActions.MqttPoolAdded, "mqtt_credential_pool", null,
            details: new { added, duplicates, skipped, freeAfter = summary.FreeCount },
            cancellationToken: cancellationToken);

        return Results.Ok(new AddMqttLoginsResponse(
            added, duplicates, skipped, summary.FreeCount, summary.RunningLow,
            BuildMessage(added, duplicates, skipped)));
    }

    private static string BuildMessage(int added, int duplicates, int skipped)
    {
        var parts = new List<string> { $"{added} login(s) added." };

        // Pasting the same batch twice is an easy mistake, so we report it instead of failing.
        if (duplicates > 0) parts.Add($"{duplicates} already in the pool.");
        if (skipped > 0) parts.Add($"{skipped} line(s) could not be read as a username and password.");

        return string.Join(" ", parts);
    }

    // Parsing is in AgroFlow.Business.MqttPoolPasteParser with its own tests: a
    // wrongly split password would be stored and the board would just fail to connect.
}
