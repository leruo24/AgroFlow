using AgroFlow.Api.Services;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Mqtt;
using AgroFlow.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using QuestPDF.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
{
    options.AddPolicy("AdminFrontend", policy =>
    {
        policy
            .WithOrigins("http://localhost:5174", "http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

// The Windows Event Log provider can throw AccessDenied for an ordinary
// developer account while a background service is reporting a recoverable
// MQTT/Postgres connection failure. Keep development and deployed logging on
// providers that do not require machine-level Event Log registration.
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;


// TODO: set ConnectionStrings:Supabase in appsettings.json (or via the
// ConnectionStrings__Supabase environment variable) to your Supabase
// project's direct Postgres connection string - Project Settings ->
// Database -> Connection string in the Supabase dashboard.
var connectionString = builder.Configuration.GetConnectionString("Supabase")
    ?? throw new InvalidOperationException(
        "Missing ConnectionStrings:Supabase in configuration - see appsettings.json.");

builder.Services.AddNpgsqlDataSource(connectionString);

// TODO: set ApiKey in appsettings.json (or the ApiKey environment variable) to
// a secret value shared with the ESP32 firmware's API_KEY constant. This is
// the equivalent of the Supabase anon key the firmware used to send directly -
// without it, these endpoints would be open to anyone who finds the URL.
// Covers every device-facing endpoint (sensor-readings, irrigation-events,
// devices/claim, devices/firmware-check) - NOT devices/enroll or farmers/*,
// which use real admin auth instead (see below).
var apiKey = builder.Configuration["ApiKey"]
    ?? throw new InvalidOperationException("Missing ApiKey in configuration - see appsettings.json.");

// TODO: set Supabase:JwksUrl in appsettings.json - this project's Supabase
// instance uses the newer asymmetric JWT signing keys, not the legacy
// shared secret, so tokens are validated against the public keys Supabase
// publishes there instead of a symmetric key AgroFlow.Api would otherwise
// need to hold. Always {Supabase:Url}/auth/v1/.well-known/jwks.json for a
// given project. This validates that a bearer token was genuinely issued by
// Supabase Auth for a real logged-in user - it does NOT by itself prove
// that user is an admin, see AdminOnlyFilter for the role check.
var jwksUrl = builder.Configuration["Supabase:JwksUrl"]
    ?? throw new InvalidOperationException("Missing Supabase:JwksUrl in configuration - see appsettings.json.");

// ConfigurationManager fetches and caches the JWKS document itself (default
// ~24h refresh, with automatic retry-on-failure) - this is the standard
// ASP.NET Core building block for "validate against a JWKS endpoint",
// distinct from the Authority-based OIDC discovery flow JwtBearerOptions
// normally uses, since Supabase's GoTrue exposes a raw JWKS document at
// this URL rather than a full OpenID Connect discovery document. There's no
// built-in IConfigurationRetriever for a bare JWKS document in this package
// version (only the full-discovery-document one), so JwksOnlyConfigurationRetriever
// below wraps the raw response in a JsonWebKeySet directly - ConfigurationManager's
// own IConfigurationRetriever<T> extensibility point is the documented way to do
// exactly this.
var jwksConfigManager = new ConfigurationManager<OpenIdConnectConfiguration>(
    jwksUrl,
    new JwksOnlyConfigurationRetriever(),
    new HttpDocumentRetriever { RequireHttps = true });

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Supabase-issued JWTs aren't Microsoft-issued tokens - disable the
        // legacy inbound-claim renaming so "sub" stays "sub" instead of being
        // remapped to a long ClaimTypes.NameIdentifier URI. AdminOnlyFilter
        // reads the claim as plain "sub".
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKeyResolver = (token, securityToken, kid, validationParameters) =>
                jwksConfigManager.GetConfigurationAsync(CancellationToken.None)
                    .GetAwaiter().GetResult().SigningKeys,
            ValidateAudience = true,
            ValidAudience = "authenticated", // Supabase's standard audience claim for logged-in users
            ValidateIssuer = false, // would need the exact project ref to validate reliably; signing key check is the important part
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddHttpClient();
builder.Services.AddCors(options =>
{
    options.AddPolicy("AdminFrontend", policy =>
    {
        policy
            .WithOrigins("http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

// Expo web runs on a separate origin from the API. Accept local browser
// origins during development and explicitly configured origins in deployment.
// Authentication and the device API key remain required for actual requests.
var allowedWebOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? Array.Empty<string>();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.SetIsOriginAllowed(origin =>
    {
        if (allowedWebOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)) return true;
        return builder.Environment.IsDevelopment()
            && Uri.TryCreate(origin, UriKind.Absolute, out var uri)
            && uri.IsLoopback
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    })
    .AllowAnyHeader()
    .AllowAnyMethod()));

// TODO: set Mqtt:Host/Port/Username/Password in appsettings.json to your
// HiveMQ Cloud cluster credentials (HiveMQ Cloud console -> your cluster ->
// Access Management). MqttConnectionService owns the single connection this
// process uses for both subscribing (sensor readings) and publishing
// (irrigation commands) - registered once as a singleton so
// IrrigationCommandNotifyService can inject the same instance via
// IMqttPublisher rather than opening a second connection.
builder.Services.AddSingleton<MqttConnectionService>();
builder.Services.AddSingleton<IMqttPublisher>(sp => sp.GetRequiredService<MqttConnectionService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<MqttConnectionService>());
builder.Services.AddHostedService<IrrigationCommandNotifyService>();
builder.Services.AddHttpClient<ResendEmailService>();
builder.Services.AddScoped<IEmailService, ResendEmailService>();

// Weather collection. Populates weather_daily (migration 0016) from
// Open-Meteo every Weather:FetchIntervalHours (default 6) for every farm that
// has coordinates - the foundation the FAO-56 ET0 / ETc advice engine needs,
// since nothing in AgroFlow stored weather before this. Open-Meteo is free and
// needs no API key, so there is no new secret to set on Railway.
builder.Services.AddHostedService<WeatherCollectionService>();

// Historical backfill. Registered so it can be resolved, but DELIBERATELY NOT
// a hosted service and deliberately not called anywhere - weather_daily does
// not exist in the live database until migration 0016 is applied, and the
// backfill is a one-off to be triggered by hand afterwards. See the header of
// WeatherBackfillService for how to run it.
builder.Services.AddSingleton<WeatherBackfillService>();

var app = builder.Build();
app.UseCors("AdminFrontend");

app.UseCors();

// Device shared-secret gate - skipped for the admin (JWT-authenticated)
// routes below, which use app.UseAuthentication()/UseAuthorization() instead.
app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    var isUserRoute = path.StartsWithSegments("/api/devices/enroll") ||
                  path.StartsWithSegments("/api/farmers") ||
                  path.StartsWithSegments("/api/farmer") ||
                  path.StartsWithSegments("/api/farms")||
                  path.StartsWithSegments("/api/users");
                  

    if (!isUserRoute &&
        (!context.Request.Headers.TryGetValue("X-Api-Key", out var providedKey) || providedKey != apiKey))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsync("Missing or invalid X-Api-Key header.");
        return;
    }

    await next();
});

app.UseAuthentication();
app.UseAuthorization();

app.MapSensorReadingEndpoints();
app.MapIrrigationEventEndpoints();
app.MapDeviceEnrollmentEndpoints();
app.MapDeviceCommandEndpoints();
app.MapFarmerOnboardingEndpoints();
app.MapFarmerEndpoints();
app.MapFarmEndpoints();
app.MapUserEndpoints();


app.Run();

// Parses a bare JWKS document (just {"keys": [...]}), not a full OpenID
// Connect discovery document - Supabase's jwks.json endpoint is the former.
// Wrapping it in an (otherwise-empty) OpenIdConnectConfiguration is just to
// satisfy ConfigurationManager<T>'s generic parameter; only .SigningKeys is
// ever read (see IssuerSigningKeyResolver above).
internal sealed class JwksOnlyConfigurationRetriever : IConfigurationRetriever<OpenIdConnectConfiguration>
{
    public async Task<OpenIdConnectConfiguration> GetConfigurationAsync(
        string address, IDocumentRetriever retriever, CancellationToken cancel)
    {
        var jwksJson = await retriever.GetDocumentAsync(address, cancel);
        var configuration = new OpenIdConnectConfiguration
        {
            JsonWebKeySet = new JsonWebKeySet(jwksJson),
        };

        foreach (var signingKey in configuration.JsonWebKeySet.GetSigningKeys())
        {
            configuration.SigningKeys.Add(signingKey);
        }

        return configuration;
    }
}
