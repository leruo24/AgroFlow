using System.Net.Http.Json;
using AgroFlow.Api.Auth;

namespace AgroFlow.Api.Endpoints;

public record CreateFarmerRequest(string Email, string TemporaryPassword, long FarmId, string? Name);
public record InviteFarmerRequest(string Email, long FarmId, string? Name);
public record FarmerOnboardingResponse(string Message);

// Both onboarding paths go through Supabase's own Admin Auth API rather than
// a hand-rolled invite-token table - see supabase/migrations/
// 0008_device_enrollment_and_onboarding.sql's handle_new_auth_user() trigger,
// which creates the profile/farm_member rows for either path uniformly once
// Supabase creates the underlying auth.users row.
//
// SECURITY: Supabase:ServiceRoleKey (read in GetSupabaseAdminConfig) bypasses
// Row Level Security entirely - it must only ever live in this server-side
// config, never in web-dashboard/admin's client-side code.
public static class FarmerOnboardingEndpoints
{
    public static void MapFarmerOnboardingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/farmers")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        group.MapPost("/create", CreateAsync);
        group.MapPost("/invite", InviteAsync);
    }

    // Admin sets the farmer's email + a temporary password directly.
    private static async Task<IResult> CreateAsync(
        CreateFarmerRequest request, IHttpClientFactory httpClientFactory, IConfiguration configuration)
    {
        var (supabaseUrl, serviceRoleKey) = GetSupabaseAdminConfig(configuration);
        using var client = BuildAdminClient(httpClientFactory, serviceRoleKey);

        var payload = new
        {
            email = request.Email,
            password = request.TemporaryPassword,
            email_confirm = true,
            user_metadata = new { invitedFarmId = request.FarmId, name = request.Name ?? "" },
        };

        var response = await client.PostAsJsonAsync($"{supabaseUrl}/auth/v1/admin/users", payload);
        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadAsStringAsync();
            return Results.Json(new { error = $"Supabase Admin API error: {error}" }, statusCode: (int)response.StatusCode);
        }

        return Results.Ok(new FarmerOnboardingResponse("Farmer account created."));
    }

    // Generates a one-time invite via Supabase Auth's built-in mechanism -
    // Supabase creates the user AND emails them a magic link to set their own
    // password. TODO: this only actually reaches the farmer's inbox if the
    // Supabase project has a real SMTP provider configured (Settings -> Auth
    // -> SMTP Settings). The default shared Supabase dev SMTP works for
    // testing but is low-volume/rate-limited - not something to rely on for
    // real farmers.
    private static async Task<IResult> InviteAsync(
        InviteFarmerRequest request, IHttpClientFactory httpClientFactory, IConfiguration configuration)
    {
        var (supabaseUrl, serviceRoleKey) = GetSupabaseAdminConfig(configuration);
        using var client = BuildAdminClient(httpClientFactory, serviceRoleKey);

        var payload = new
        {
            email = request.Email,
            data = new { invitedFarmId = request.FarmId, name = request.Name ?? "" },
        };

        var response = await client.PostAsJsonAsync($"{supabaseUrl}/auth/v1/invite", payload);
        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadAsStringAsync();
            return Results.Json(new { error = $"Supabase Admin API error: {error}" }, statusCode: (int)response.StatusCode);
        }

        return Results.Ok(new FarmerOnboardingResponse("Invite sent."));
    }

    private static HttpClient BuildAdminClient(IHttpClientFactory httpClientFactory, string serviceRoleKey)
    {
        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Add("apikey", serviceRoleKey);
        client.DefaultRequestHeaders.Add("Authorization", $"Bearer {serviceRoleKey}");
        return client;
    }

    private static (string SupabaseUrl, string ServiceRoleKey) GetSupabaseAdminConfig(IConfiguration configuration)
    {
        var url = configuration["Supabase:Url"]
            ?? throw new InvalidOperationException("Missing Supabase:Url in configuration - see appsettings.json.");
        var key = configuration["Supabase:ServiceRoleKey"]
            ?? throw new InvalidOperationException("Missing Supabase:ServiceRoleKey in configuration - see appsettings.json.");
        return (url.TrimEnd('/'), key);
    }
}
