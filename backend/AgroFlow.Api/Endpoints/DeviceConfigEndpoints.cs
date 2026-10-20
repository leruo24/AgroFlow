using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// AutoWateringAllowed: whether the kit may water by itself while it cannot reach the server
// (the firmware's offline fallback). False for a Manual or Scheduled zone.
public record DeviceConfigResponse(long ZoneId, string IrrigationMode, bool AutoWateringAllowed);

// GET /api/devices/config: what a kit needs to know about its zone. Firmware 1.4.1+ asks on
// boot and every 10 minutes while online, keeps the answer in flash, and only waters on its
// own when offline if the last answer allowed it. Before this the kit did not know the
// zone's mode, so a zone set to Manual could still be watered by an offline kit.
public static class DeviceConfigEndpoints
{
    public static void MapDeviceConfigEndpoints(this WebApplication app)
    {
        app.MapGet("/api/devices/config", HandleAsync);
    }

    private static async Task<IResult> HandleAsync(
        HttpContext context, DeviceAuthService deviceAuth, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        // Security: this board's own token only. A legacy shared-key board cannot be told
        // apart from any other, so it gets no zone details.
        var device = await deviceAuth.AuthenticateAsync(context, ct);
        if (device is null || device.IsLegacyApiKey)
        {
            return Results.Json(new { error = "A valid X-Device-Token is required." }, statusCode: StatusCodes.Status401Unauthorized);
        }

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("select irrigation_mode from zone where id = $1", connection);
        cmd.Parameters.AddWithValue(device.ZoneId);
        var stored = await cmd.ExecuteScalarAsync(ct) as string;

        var mode = IrrigationMode.Canonical(stored);
        return Results.Ok(new DeviceConfigResponse(device.ZoneId, mode, IrrigationMode.AllowsKitFallback(mode)));
    }
}
