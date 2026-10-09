using System.Net.Http.Json;

namespace AgroFlow.Api.Services;

// The one place outside FarmerOnboardingEndpoints that calls Supabase's Admin Auth
// API; it changes a user's password.
// Security: Supabase:ServiceRoleKey bypasses Row Level Security. It lives only in
// server configuration (Railway variable / user-secrets) and must never reach the
// admin dashboard or the mobile app.
public sealed class SupabaseAdminService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<SupabaseAdminService> _logger;

    public SupabaseAdminService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<SupabaseAdminService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    // Sets a new temporary password on an existing farmer and returns it; the caller
    // shows or sends it once and nothing stores it. Returns null on failure instead of
    // throwing, because the Telegram bot calls this from its polling loop.
    public async Task<string?> ResetTemporaryPasswordAsync(
        Guid userId,
        CancellationToken cancellationToken)
    {
        var password = TemporaryPasswordGenerator.Generate();

        try
        {
            var (supabaseUrl, serviceRoleKey) = GetAdminConfig();

            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Add("apikey", serviceRoleKey);
            client.DefaultRequestHeaders.Add("Authorization", $"Bearer {serviceRoleKey}");

            using var response = await client.PutAsJsonAsync(
                $"{supabaseUrl}/auth/v1/admin/users/{userId}",
                new { password },
                cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                // Security: never log the password; this line goes to Railway's log stream.
                _logger.LogInformation(
                    "Issued a new temporary password for user {UserId}.", userId);

                return password;
            }

            var error = await response.Content.ReadAsStringAsync(cancellationToken);

            _logger.LogError(
                "Supabase Admin API refused the password reset for {UserId}: {StatusCode} {Error}",
                userId, response.StatusCode, error);

            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Password reset for user {UserId} threw.", userId);
            return null;
        }
    }

    private (string SupabaseUrl, string ServiceRoleKey) GetAdminConfig()
    {
        var url = _configuration["Supabase:Url"]
            ?? throw new InvalidOperationException(
                "Missing Supabase:Url in configuration - see appsettings.json.");

        var key = _configuration["Supabase:ServiceRoleKey"]
            ?? throw new InvalidOperationException(
                "Missing Supabase:ServiceRoleKey in configuration - see appsettings.json.");

        return (url.TrimEnd('/'), key);
    }
}
