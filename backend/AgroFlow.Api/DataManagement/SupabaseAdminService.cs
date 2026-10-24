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

    // Sets a password chosen elsewhere (a reset by Telegram code, a sweep that retires an
    // expired temporary password). True when Supabase accepted it.
    public async Task<bool> SetPasswordAsync(Guid userId, string password, CancellationToken cancellationToken)
    {
        try
        {
            var (supabaseUrl, serviceRoleKey) = GetAdminConfig();
            var client = AdminClient(serviceRoleKey);
            using var response = await client.PutAsJsonAsync(
                $"{supabaseUrl}/auth/v1/admin/users/{userId}", new { password }, cancellationToken);
            if (response.IsSuccessStatusCode) return true;
            _logger.LogError("Supabase Admin API refused a password change for {UserId}: {StatusCode}", userId, response.StatusCode);
            return false;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Password change for user {UserId} threw.", userId);
            return false;
        }
    }

    // A single-use sign-in for the one-tap link: Supabase's generate_link (type magiclink)
    // returns a hashed token the app exchanges for a session with verifyOtp. Nothing is
    // emailed; AgroFlow has no email for farmers. Null on failure.
    public async Task<string?> MagicLinkTokenHashAsync(string email, CancellationToken cancellationToken)
    {
        try
        {
            var (supabaseUrl, serviceRoleKey) = GetAdminConfig();
            var client = AdminClient(serviceRoleKey);
            using var response = await client.PostAsJsonAsync(
                $"{supabaseUrl}/auth/v1/admin/generate_link", new { type = "magiclink", email }, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Supabase generate_link refused: {StatusCode}", response.StatusCode);
                return null;
            }
            using var doc = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var root = doc.RootElement;
            if (root.TryGetProperty("hashed_token", out var top) && top.ValueKind == System.Text.Json.JsonValueKind.String) return top.GetString();
            if (root.TryGetProperty("properties", out var props) && props.TryGetProperty("hashed_token", out var nested)) return nested.GetString();
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "generate_link threw.");
            return null;
        }
    }

    // Staff without Telegram keep the email reset (Part A): Supabase sends its recovery email.
    public async Task SendRecoveryEmailAsync(string email, string? redirectTo, CancellationToken cancellationToken)
    {
        try
        {
            var (supabaseUrl, serviceRoleKey) = GetAdminConfig();
            var client = AdminClient(serviceRoleKey);
            var url = $"{supabaseUrl}/auth/v1/recover" +
                (string.IsNullOrWhiteSpace(redirectTo) ? "" : "?redirect_to=" + Uri.EscapeDataString(redirectTo));
            using var response = await client.PostAsJsonAsync(url, new { email }, cancellationToken);
            if (!response.IsSuccessStatusCode)
                _logger.LogWarning("Supabase recover refused: {StatusCode}", response.StatusCode);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Supabase recover threw.");
        }
    }

    private HttpClient AdminClient(string serviceRoleKey)
    {
        var client = _httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Add("apikey", serviceRoleKey);
        client.DefaultRequestHeaders.Add("Authorization", $"Bearer {serviceRoleKey}");
        return client;
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
