using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;

namespace AgroFlow.Api.Endpoints;

// One or more username/password pairs, as pasted out of the HiveMQ console.
//
// Pasted in bulk because that is how they are made: HiveMQ Cloud's credential
// API needs the paid Starter plan, so an admin creates a batch by hand in the
// console and brings them over together. A one-at-a-time form would mean
// re-typing a password per kit, which is exactly where transcription errors
// come from.
public record AddMqttLoginsRequest(string Pasted);

public record AddMqttLoginsResponse(int Added, int Duplicates, int Skipped, int FreeCount, bool RunningLow, string Message);

// The admin "MQTT logins" page (step 4).
//
// NOTE WHAT IS NOT HERE: there is no endpoint that returns a password. The
// pool's passwords leave this server by exactly one route - GET
// /api/devices/mqtt-credentials, to the device that owns that entry, proving
// ownership with its device token. The admin page lists usernames, status and
// dates, and nothing else; see MqttCredentialPoolService.ListAsync, which does
// not even SELECT the encrypted column.
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
        MqttCredentialPoolService pool,
        CancellationToken cancellationToken)
    {
        if (!pool.IsConfigured)
        {
            // Refused rather than stored in plaintext. A pool that silently
            // accepted passwords with no key would be worse than no pool.
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

        return Results.Ok(new AddMqttLoginsResponse(
            added, duplicates, skipped, summary.FreeCount, summary.RunningLow,
            BuildMessage(added, duplicates, skipped)));
    }

    private static string BuildMessage(int added, int duplicates, int skipped)
    {
        var parts = new List<string> { $"{added} login(s) added." };

        // Pasting the same batch twice is a realistic accident, so it is
        // reported rather than treated as an error.
        if (duplicates > 0) parts.Add($"{duplicates} already in the pool.");
        if (skipped > 0) parts.Add($"{skipped} line(s) could not be read as a username and password.");

        return string.Join(" ", parts);
    }

    // Parsing lives in AgroFlow.Business.MqttPoolPasteParser, not here: what
    // this accepts IS the behaviour, and a separator it mishandles silently
    // stores a password that will not work - the board then just fails to
    // reach the broker with no visible cause. That deserves direct tests.
}
