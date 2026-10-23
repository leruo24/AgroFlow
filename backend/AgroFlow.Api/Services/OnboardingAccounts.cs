using System.Net.Http.Json;

namespace AgroFlow.Api.Services;

// The farmer's sign-in, for onboarding (AF-01). Creating it is the one onboarding step that
// cannot share the database transaction (it is Supabase Auth's Admin API), so it sits behind
// this interface: the endpoint records the outcome on onboarding_request (0057) and a retry
// continues from there. Tests swap in a fake that writes auth.users on the local database.
// Security: the Supabase implementation uses Supabase:ServiceRoleKey, server config only.
public interface IOnboardingAccounts
{
    // The new user's id, or the reason it was refused (for example the email is taken).
    Task<OnboardingAccountResult> CreateAsync(string email, string password, string name, string phone, long farmId, CancellationToken ct);

    Task<bool> SetPasswordAsync(Guid userId, string password, CancellationToken ct);
}

public sealed record OnboardingAccountResult(Guid? UserId, string? Error, int StatusCode = 200);

public sealed class SupabaseOnboardingAccounts : IOnboardingAccounts
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly SupabaseAdminService _admin;
    private readonly ILogger<SupabaseOnboardingAccounts> _logger;

    public SupabaseOnboardingAccounts(IHttpClientFactory httpClientFactory, IConfiguration configuration,
        SupabaseAdminService admin, ILogger<SupabaseOnboardingAccounts> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _admin = admin;
        _logger = logger;
    }

    public async Task<OnboardingAccountResult> CreateAsync(string email, string password, string name, string phone, long farmId, CancellationToken ct)
    {
        var url = (_configuration["Supabase:Url"] ?? throw new InvalidOperationException("Missing Supabase:Url in configuration - see appsettings.json.")).TrimEnd('/');
        var key = _configuration["Supabase:ServiceRoleKey"] ?? throw new InvalidOperationException("Missing Supabase:ServiceRoleKey in configuration - see appsettings.json.");
        var client = _httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Add("apikey", key);
        client.DefaultRequestHeaders.Add("Authorization", $"Bearer {key}");

        // handle_new_auth_user() (0008) creates the profile and the farm_member row from
        // invitedFarmId.
        using var response = await client.PostAsJsonAsync($"{url}/auth/v1/admin/users", new
        {
            email,
            password,
            email_confirm = true,
            user_metadata = new { invitedFarmId = farmId, name, phone },
        }, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            // Security: the body never has the password in it; it is Supabase's error text.
            _logger.LogWarning("Supabase refused the onboarding account: {StatusCode} {Body}", response.StatusCode, body);
            return new OnboardingAccountResult(null, PlainAuthError(body), (int)response.StatusCode);
        }

        var user = await response.Content.ReadFromJsonAsync<SupabaseAuthUserResponse>(cancellationToken: ct);
        return user is null || user.Id == Guid.Empty
            ? new OnboardingAccountResult(null, "The sign-in service created the account but did not return its id.", 502)
            : new OnboardingAccountResult(user.Id, null);
    }

    public Task<bool> SetPasswordAsync(Guid userId, string password, CancellationToken ct) => _admin.SetPasswordAsync(userId, password, ct);

    // Supabase's messages are technical; the two a staff member can act on are said plainly.
    public static string PlainAuthError(string body)
    {
        var lower = body.ToLowerInvariant();
        if (lower.Contains("already") && (lower.Contains("registered") || lower.Contains("exists")))
            return "An account with this email already exists. Use a different email, or find the farmer under Farmers.";
        if (lower.Contains("email") && lower.Contains("invalid"))
            return "The sign-in service did not accept this email address. Check it and try again.";
        return "The sign-in service could not create the account. The farm is saved; press Retry to finish.";
    }

    private sealed record SupabaseAuthUserResponse(Guid Id);
}
