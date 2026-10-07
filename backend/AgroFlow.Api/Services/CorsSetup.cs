namespace AgroFlow.Api.Services;

/* Admin polish, item 8: the API's one CORS policy.
 *
 * Program.cs used to register CORS three times - two "AdminFrontend" policies
 * (the second silently replaced the first, dropping localhost:5174) and a
 * default policy - and apply two of them. Now there is one named policy,
 * applied once:
 *
 *   - every origin in Cors:AllowedOrigins (on Railway: Cors__AllowedOrigins__0,
 *     Cors__AllowedOrigins__1, ...), matched exactly, ignoring case and a
 *     trailing slash;
 *   - the local dev origins (the admin's Vite ports and Expo web), in every
 *     environment, as before;
 *   - in Development, any http(s) loopback origin, so a dev server on another
 *     port works without configuration, as before.
 *
 * Any header and method: the admin and the mobile web app send Authorization
 * and Content-Type today; listing headers would break the next one added
 * without making anything safer - every route still checks its own JWT or
 * device key, and no credentials (cookies) are allowed. */
public static class CorsSetup
{
    public const string PolicyName = "AgroFlowWeb";

    public static readonly string[] LocalDevOrigins =
    [
        "http://localhost:5173",   // admin (vite dev)
        "http://localhost:5174",   // admin (second vite instance / preview)
        "http://localhost:8081",   // mobile (Expo web)
        "http://localhost:19006",  // mobile (older Expo web port)
    ];

    public static IServiceCollection AddAgroFlowCors(
        this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        var configured = (configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [])
            .Select(Normalise)
            .Where(o => o.Length > 0)
            .ToArray();
        var allowed = new HashSet<string>(configured.Concat(LocalDevOrigins), StringComparer.OrdinalIgnoreCase);
        var development = environment.IsDevelopment();

        services.AddCors(options => options.AddPolicy(PolicyName, policy => policy
            .SetIsOriginAllowed(origin => IsAllowed(origin, allowed, development))
            .AllowAnyHeader()
            .AllowAnyMethod()));
        return services;
    }

    internal static bool IsAllowed(string origin, ISet<string> allowed, bool development)
    {
        if (allowed.Contains(Normalise(origin))) return true;
        return development
            && Uri.TryCreate(origin, UriKind.Absolute, out var uri)
            && uri.IsLoopback
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    private static string Normalise(string? origin) => (origin ?? "").Trim().TrimEnd('/');
}
