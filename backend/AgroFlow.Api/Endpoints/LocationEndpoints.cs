using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using AgroFlow.Api.Auth;

namespace AgroFlow.Api.Endpoints;

internal sealed record LocationSearchResponse(
    [property: JsonPropertyName("results")] List<LocationSearchProviderResult>? Results);

internal sealed record LocationSearchProviderResult(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("latitude")] double Latitude,
    [property: JsonPropertyName("longitude")] double Longitude,
    [property: JsonPropertyName("admin1")] string? Province,
    [property: JsonPropertyName("admin2")] string? District,
    [property: JsonPropertyName("country")] string? Country);

internal sealed record LocationSearchItem(string Name, string Detail, double Latitude, double Longitude);
internal sealed record ReverseLocationItem(string? Locality, string? District, string? Province, string? Country, string? DisplayName);

public static class LocationEndpoints
{
    private static readonly ConcurrentDictionary<string, IReadOnlyList<LocationSearchItem>> SearchCache = new();
    private static readonly ConcurrentDictionary<string, ReverseLocationItem> ReverseCache = new();
    private static readonly SemaphoreSlim NominatimGate = new(1, 1);
    private static DateTimeOffset _lastNominatimRequest = DateTimeOffset.MinValue;

    public static void MapLocationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/locations")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();
        group.MapGet("/search", SearchAsync);
        group.MapGet("/reverse", ReverseAsync);
    }

    private static async Task<IResult> SearchAsync(string? q, IHttpClientFactory clients, CancellationToken ct)
    {
        var query = q?.Trim() ?? "";
        if (query.Length < 2) return Results.BadRequest(new { error = "Type at least two characters to search." });
        var key = query.ToLowerInvariant();
        if (SearchCache.TryGetValue(key, out var cached)) return Results.Ok(cached);

        var url = "https://geocoding-api.open-meteo.com/v1/search" +
                  $"?name={Uri.EscapeDataString(query)}&count=8&language=en&format=json&countryCode=ZA";
        using var response = await clients.CreateClient().GetAsync(url, ct);
        if (!response.IsSuccessStatusCode) return Results.Problem("The location search provider is unavailable.", statusCode: 502);
        var provider = await response.Content.ReadFromJsonAsync<LocationSearchResponse>(cancellationToken: ct);
        var items = (provider?.Results ?? new List<LocationSearchProviderResult>())
            .Where(r => Valid(r.Latitude, r.Longitude))
            .Select(r => new LocationSearchItem(
                r.Name,
                string.Join(", ", new[] { r.District, r.Province, r.Country }.Where(x => !string.IsNullOrWhiteSpace(x))),
                r.Latitude,
                r.Longitude))
            .DistinctBy(r => (r.Name, r.Detail, r.Latitude, r.Longitude))
            .ToList();
        SearchCache[key] = items;
        return Results.Ok(items);
    }

    private static async Task<IResult> ReverseAsync(double latitude, double longitude, IHttpClientFactory clients, CancellationToken ct)
    {
        if (!Valid(latitude, longitude))
            return Results.BadRequest(new { error = "Latitude must be -90 to 90 and longitude -180 to 180." });
        var key = $"{latitude:F5},{longitude:F5}";
        if (ReverseCache.TryGetValue(key, out var cached)) return Results.Ok(cached);

        await NominatimGate.WaitAsync(ct);
        try
        {
            var wait = TimeSpan.FromMilliseconds(1100) - (DateTimeOffset.UtcNow - _lastNominatimRequest);
            if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
            var client = clients.CreateClient();
            client.DefaultRequestHeaders.UserAgent.ParseAdd("AgroFlow/1.0 (farm location picker)");
            var url = "https://nominatim.openstreetmap.org/reverse" +
                      $"?format=jsonv2&lat={latitude.ToString(System.Globalization.CultureInfo.InvariantCulture)}" +
                      $"&lon={longitude.ToString(System.Globalization.CultureInfo.InvariantCulture)}&zoom=14&addressdetails=1";
            using var response = await client.GetAsync(url, ct);
            _lastNominatimRequest = DateTimeOffset.UtcNow;
            if (!response.IsSuccessStatusCode) return Results.Problem("The nearest-locality service is unavailable.", statusCode: 502);
            using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            var root = json.RootElement;
            var address = root.TryGetProperty("address", out var value) ? value : default;
            string? Field(params string[] names)
            {
                if (address.ValueKind != JsonValueKind.Object) return null;
                foreach (var name in names)
                    if (address.TryGetProperty(name, out var field) && field.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(field.GetString()))
                        return field.GetString();
                return null;
            }
            var item = new ReverseLocationItem(
                Field("town", "city", "village", "hamlet", "suburb", "municipality"),
                Field("county", "district", "municipality"),
                Field("state", "province"),
                Field("country"),
                root.TryGetProperty("display_name", out var display) ? display.GetString() : null);
            ReverseCache[key] = item;
            return Results.Ok(item);
        }
        finally
        {
            NominatimGate.Release();
        }
    }

    private static bool Valid(double latitude, double longitude) =>
        double.IsFinite(latitude) && double.IsFinite(longitude) && latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;
}
