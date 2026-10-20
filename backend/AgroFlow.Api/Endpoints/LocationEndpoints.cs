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
    [property: JsonPropertyName("country")] string? Country,
    [property: JsonPropertyName("admin3")] string? Municipality = null);

// Detail is "Town, District/Municipality, Province".
internal sealed record LocationSearchItem(string Name, string Detail, double Latitude, double Longitude, string? Province = null, string? District = null);
internal sealed record ReverseLocationItem(string? Locality, string? District, string? Province, string? Country, string? DisplayName);

public static class LocationEndpoints
{
    private static readonly ConcurrentDictionary<string, IReadOnlyList<(LocationSearchProviderResult Result, string? Municipality)>> SearchCache = new();
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

    // Town search for the admin location picker (docs/drought-community.md, Part 3): limited to
    // South Africa and, when given, to one province; tolerant of misspellings ("Mafeking" finds
    // Mahikeng). Open-Meteo is asked for the typed name first, then for shorter prefixes when
    // that finds nothing in the province, and the results are ranked by how close the town (or
    // its local municipality) is to what was typed. Each answer is cached, so typing is one
    // request per new prefix at most (the app also waits for a pause in typing).
    private static async Task<IResult> SearchAsync(string? q, string? province, IHttpClientFactory clients, CancellationToken ct)
    {
        var query = q?.Trim() ?? "";
        if (query.Length < 2) return Results.BadRequest(new { error = "Type at least two characters to search." });
        if (province is not null && !AgroFlow.Business.LocationRules.IsProvince(province))
            return Results.BadRequest(new { error = "Choose one of the nine provinces." });

        var found = new List<(LocationSearchProviderResult Result, string? Municipality)>();
        foreach (var attempt in AgroFlow.Business.LocationRules.QueriesFor(query))
        {
            foreach (var r in await ProviderAsync(attempt, clients, ct))
                if (province is null || string.Equals(r.Result.Province, province, StringComparison.OrdinalIgnoreCase))
                    found.Add(r);
            if (found.Count > 0) break;
        }
        var items = found
            .Where(r => AgroFlow.Business.LocationRules.ValidateCoordinates(r.Result.Latitude, r.Result.Longitude) is null)
            .OrderByDescending(r => Math.Max(AgroFlow.Business.LocationRules.Similarity(query, r.Result.Name),
                                            r.Municipality is null ? 0 : AgroFlow.Business.LocationRules.Similarity(query, r.Municipality)))
            .Select(r => new LocationSearchItem(
                r.Result.Name,
                AgroFlow.Business.LocationRules.Display(r.Result.Name, r.Result.District, r.Result.Province),
                r.Result.Latitude,
                r.Result.Longitude,
                r.Result.Province,
                r.Result.District))
            .DistinctBy(r => (r.Name, r.Detail))
            .Take(8)
            .ToList();
        return Results.Ok(items);
    }

    private static async Task<IReadOnlyList<(LocationSearchProviderResult Result, string? Municipality)>> ProviderAsync(
        string name, IHttpClientFactory clients, CancellationToken ct)
    {
        var key = name.ToLowerInvariant();
        if (SearchCache.TryGetValue(key, out var cached)) return cached;
        var url = "https://geocoding-api.open-meteo.com/v1/search" +
                  $"?name={Uri.EscapeDataString(name)}&count=20&language=en&format=json&countryCode=ZA";
        using var response = await clients.CreateClient().GetAsync(url, ct);
        if (!response.IsSuccessStatusCode) return Array.Empty<(LocationSearchProviderResult, string?)>();
        var provider = await response.Content.ReadFromJsonAsync<LocationSearchResponse>(cancellationToken: ct);
        var list = (provider?.Results ?? new List<LocationSearchProviderResult>())
            .Select(r => (r, r.Municipality)).ToList();
        SearchCache[key] = list;
        return list;
    }

    private static async Task<IResult> ReverseAsync(double latitude, double longitude, IHttpClientFactory clients, CancellationToken ct)
    {
        if (AgroFlow.Business.LocationRules.ValidateCoordinates(latitude, longitude) is { } outside)
            return Results.BadRequest(new { error = outside });
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
