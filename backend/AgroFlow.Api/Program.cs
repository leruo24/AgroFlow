using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Mqtt;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
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
            .WithOrigins("http://localhost:5173", "http://localhost:8081")
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
// ---------------------------------------------------------------------------
// PER-DEVICE CREDENTIALS (firmware v1.3.0, migrations 0028 + 0029)
// ---------------------------------------------------------------------------
// DeviceAuthService resolves X-Device-Token to a specific board, so a device
// endpoint acts on the device the CREDENTIAL names rather than on whatever
// deviceId the request body claimed. ClaimRateLimiter holds per-IP failed-claim
// counters in memory, so it must be a singleton to count anything at all.
// MqttCredentialPoolService hands out the hand-created HiveMQ logins.
//
// SECRETS: Mqtt__PoolEncryptionKey is a Railway variable and a local
// user-secret. Like Telegram__BotToken it is deliberately absent from
// appsettings.json and must never be committed.
builder.Services.AddSingleton<DeviceAuthService>();
builder.Services.AddSingleton<ClaimRateLimiter>();
builder.Services.AddSingleton<MqttCredentialPoolService>();

builder.Services.AddSingleton<MqttConnectionService>();
builder.Services.AddSingleton<IMqttPublisher>(sp => sp.GetRequiredService<MqttConnectionService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<MqttConnectionService>());
builder.Services.AddHostedService<IrrigationCommandNotifyService>();
// ---------------------------------------------------------------------------
// FARMER NOTIFICATIONS (Telegram) - replaces the Resend welcome email.
// ---------------------------------------------------------------------------
// A Telegram bot cannot message anyone first, so onboarding no longer pushes
// anything at a new farmer. The admin, already on-site installing hardware,
// shows a QR code; the farmer scanning it is what creates a chat the bot may
// use from then on, for the welcome message and for every alert afterwards.
//
// SECRETS: Telegram__BotToken is a Railway variable and a local user-secret.
// It is deliberately absent from appsettings.json and must never be committed.
builder.Services.Configure<TelegramOptions>(
    builder.Configuration.GetSection(TelegramOptions.SectionName));

// A token pasted out of @BotFather, or a username pasted out of a chat,
// routinely arrives with a trailing newline or a leading @. Both would
// otherwise be baked straight into an API URL or a t.me link and fail in a
// way that looks like a wrong token rather than a stray character.
builder.Services.PostConfigure<TelegramOptions>(options =>
{
    options.BotToken = options.BotToken?.Trim();
    options.BotUsername = options.BotUsername?.Trim().TrimStart('@');
    options.WebhookSecret = options.WebhookSecret?.Trim();
});
builder.Services.Configure<ApkOptions>(
    builder.Configuration.GetSection(ApkOptions.SectionName));
builder.Services.Configure<DeviceMonitorOptions>(
    builder.Configuration.GetSection(DeviceMonitorOptions.SectionName));
builder.Services.Configure<WeatherAlertOptions>(
    builder.Configuration.GetSection(WeatherAlertOptions.SectionName));
builder.Services.Configure<PasswordResetOptions>(
    builder.Configuration.GetSection(PasswordResetOptions.SectionName));

builder.Services.AddSingleton<TelegramClient>();
builder.Services.AddSingleton<TelegramOnboardingService>();
builder.Services.AddSingleton<SupabaseAdminService>();

// Stops a repeatedly-observed event becoming a repeatedly-sent message. The
// forecast refreshes every 6 hours with 8 days of data, so without this one
// storm would be announced about 20 times. See migration 0026.
builder.Services.AddSingleton<NotificationLedger>();

// The same claim-then-send mechanism for farm/zone request messages, against
// its own table - notification_sent's farm_id is NOT NULL and a new_farm
// request has no farm yet. See migration 0032.
builder.Services.AddSingleton<FarmRequestNotifier>();

// Self-service password recovery over Telegram. Supabase's own email reset
// needs SMTP that this project has never configured, so the mobile
// forgot-password screen silently did nothing before this.
builder.Services.AddSingleton<PasswordResetService>();

// Singleton rather than scoped because MqttConnectionService and the two
// hosted services below are singletons and hold this for the process
// lifetime. Nothing in the implementation keeps per-request state.
//
// With no bot token configured, every notification becomes a logged no-op
// instead of a startup crash - a developer can run the whole API with no
// Telegram set up at all.
if (builder.Configuration.GetSection(TelegramOptions.SectionName)["BotToken"] is { Length: > 0 })
{
    builder.Services.AddSingleton<INotificationService, TelegramNotificationService>();
}
else
{
    builder.Services.AddSingleton<INotificationService, NullNotificationService>();
}

// Inbound /start messages. Gated on Telegram:EnablePolling, which defaults to
// FALSE: Telegram hands each update to exactly one getUpdates consumer, so a
// local API running alongside Railway would steal farmers' onboarding
// messages at random. Railway sets Telegram__EnablePolling=true; nowhere else
// should.
// Registered as a singleton AND as the hosted service, the same way
// MqttConnectionService is above, so that TelegramEndpoints' webhook can
// resolve the SAME instance and hand it an update. Both inbound routes then
// run identical handling - /start, /status, /alerts and /help behave the same
// whether Telegram pushed the update to the webhook or the poller pulled it.
builder.Services.AddSingleton<TelegramPollingService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<TelegramPollingService>());

// Equipment that has stopped working: devices gone quiet, pumps that never
// acknowledged a command, zones whose sensor has gone silent or that have
// nothing able to control them. Transition-based where possible and
// ledger-deduplicated where not. Nothing wrote hardware.status after enrolment
// before this.
builder.Services.AddHostedService<DeviceStatusMonitorService>();

// Crop-damaging weather, interpreted from the forecast rows
// WeatherCollectionService already stores. Thresholds are configurable because
// what counts as dangerous is regional.
builder.Services.AddHostedService<WeatherAlertService>();

// Weather collection. Populates weather_daily (migration 0016) from
// Open-Meteo every Weather:FetchIntervalHours (default 6) for every farm that
// has coordinates - the foundation the FAO-56 ET0 / ETc advice engine needs,
// since nothing in AgroFlow stored weather before this. Open-Meteo is free and
// needs no API key, so there is no new secret to set on Railway.
builder.Services.AddHostedService<WeatherCollectionService>();

// ---------------------------------------------------------------------------
// FAO-56 insight engine (migration 0027). Runs the per-zone soil water balance
// and writes the farmer's insights: a full pass just after midnight SAST, and
// the act_now checks every 15 minutes in between.
//
// The controller is registered as a singleton holding only a connection string,
// in the project's DB/XDB/Controller shape; the endpoints resolve it directly.
// Set Fao56Engine:Enabled=false to turn the background passes off without
// disabling the endpoints.
// ---------------------------------------------------------------------------
builder.Services.AddSingleton(sp => new AgroFlow.Business.Fao56EngineController(
    sp.GetRequiredService<IConfiguration>().GetConnectionString("Supabase")
        ?? throw new InvalidOperationException("Missing ConnectionStrings:Supabase for the FAO-56 engine.")));
builder.Services.AddHostedService<Fao56EngineService>();

// Turns `preparing` report_request rows (0034) into PDFs and delivers them.
// A background queue rather than work done inside the HTTP request: the
// FAO-56 render is long enough to time out a phone on rural data, and the
// automatic weekly reports have no request to run inside at all.
builder.Services.AddHostedService<ReportGenerationService>();

// Creates report_request rows for farms whose schedule (0035) is due. It
// generates nothing itself - it fills the same queue the app's own Request
// button fills, so an automatic report and a hand-requested one cannot render
// or deliver differently. Hourly rather than a daily cron, because a deploy
// at 06:58 would otherwise skip that week entirely.
builder.Services.AddHostedService<AutoReportSchedulerService>();

// Historical backfill from Open-Meteo's archive (ERA5). The routine itself is
// a plain singleton; WeatherBackfillStartupService below is what decides
// whether to run it.
builder.Services.AddSingleton<WeatherBackfillService>();

// One-shot, config-triggered backfill. Does nothing unless Weather:BackfillDays
// is set (Weather__BackfillDays on Railway), so an ordinary deploy is
// unaffected. When it is set, the backfill runs once in the background AFTER
// the app has started serving, then the service completes. The variable must be
// removed afterwards or every redeploy repeats the run - harmless to the data,
// because the (farm_id, date) upsert converges rather than duplicates, but a
// waste of a free service's capacity. See the header of
// WeatherBackfillStartupService.
builder.Services.AddHostedService<WeatherBackfillStartupService>();

var app = builder.Build();

// Prints, once, whether the container was actually given the Telegram
// variables and which configuration provider supplied each one. "Telegram
// polling is off" on its own cannot distinguish a variable Railway never
// passed from one our code read under the wrong key, and those have opposite
// fixes. Secret values are reported as a length, never printed.
StartupConfigurationDiagnostics.Log(
    app.Configuration,
    app.Services.GetRequiredService<IOptions<TelegramOptions>>(),
    app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("AgroFlow.Api.Startup"));

app.UseCors("AdminFrontend");

app.UseCors();

// Device shared-secret gate - skipped for the admin (JWT-authenticated)
// routes below, which use app.UseAuthentication()/UseAuthorization() instead.
app.Use(async (context, next) =>
{
    var path = context.Request.Path;

    // Routes that authenticate THEMSELVES and must therefore not be stopped
    // by the shared-key gate.
    //
    // /api/devices/claim: a freshly flashed v1.3.0 board holds no credential
    // of any kind until claim answers - the compiled-in fleet key is exactly
    // what this release removes from the firmware image. The one-time,
    // single-use, 24-hour enrollment code is the authorisation, and
    // ClaimRateLimiter replaces the shared key's brute-force role.
    //
    // The other three: they require X-Device-Token and resolve the board from
    // it (DeviceAuthService), which is strictly stronger than the shared key.
    // They still ACCEPT the shared key while Devices:LegacyApiKeyEnabled is
    // true, but that decision belongs to DeviceAuthService - which can log
    // each legacy use and be switched off by config - not to a middleware
    // that cannot tell the two apart.
    var isSelfAuthenticatingDeviceRoute =
        path.StartsWithSegments("/api/devices/claim") ||
        path.StartsWithSegments("/api/devices/mqtt-credentials") ||
        path.StartsWithSegments("/api/devices/firmware-check") ||
        path.StartsWithSegments("/api/devices/commands") ||
        path.StartsWithSegments("/api/irrigation-events");

    var isUserRoute = path.StartsWithSegments("/api/devices/enroll") ||
                  isSelfAuthenticatingDeviceRoute ||
                  // Every /api/admin route is JWT + AdminOnlyFilter. Without
                  // this line the shared DEVICE key would also be demanded of
                  // a human administrator, which no browser sends - the
                  // hardware actions, the MQTT logins page and the request
                  // status endpoint would all 401 for the dashboard.
                  path.StartsWithSegments("/api/admin") ||
                  path.StartsWithSegments("/api/telegram") ||
                  // Anonymous by necessity: a farmer who has forgotten their
                  // password can present neither a JWT nor the device key.
                  // What makes it safe is that the new password goes only to
                  // the Telegram chat already linked to that account - see
                  // PasswordResetEndpoints.
                  path.StartsWithSegments("/api/auth") ||
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
app.MapZoneHardwareEndpoints();
app.MapFarmerOnboardingEndpoints();
app.MapFarmerEndpoints();
app.MapReportEndpoints();
app.MapFao56EngineEndpoints();
app.MapForecastEndpoints();
app.MapReportRequestEndpoints();
app.MapReportScheduleEndpoints();
app.MapHealthEndpoints();
app.MapFarmEndpoints();
app.MapUserEndpoints();
app.MapTelegramEndpoints();
app.MapTelegramWebhookEndpoints();
app.MapAdminRequestEndpoints();
app.MapMqttPoolEndpoints();
app.MapPasswordResetEndpoints();


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
