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

// The Windows Event Log provider can throw AccessDenied for a normal developer
// account, so we only use providers that need no machine-level registration.
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
// A character the report font cannot draw (e.g. an emoji in a farm name) prints
// as a blank box instead of failing the report.
QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;


// Set ConnectionStrings:Supabase (or ConnectionStrings__Supabase) to the Supabase
// direct Postgres connection string: Project Settings -> Database -> Connection string.
var connectionString = builder.Configuration.GetConnectionString("Supabase")
    ?? throw new InvalidOperationException(
        "Missing ConnectionStrings:Supabase in configuration - see appsettings.json.");

builder.Services.AddNpgsqlDataSource(connectionString);

// Security: ApiKey is the shared secret for device-facing endpoints
// (sensor-readings, irrigation-events, devices/firmware-check). Without it those
// endpoints would be open to anyone. devices/enroll and farmers/* use real admin
// auth instead (see below).
var apiKey = builder.Configuration["ApiKey"]
    ?? throw new InvalidOperationException("Missing ApiKey in configuration - see appsettings.json.");

// Set Supabase:JwksUrl ({Supabase:Url}/auth/v1/.well-known/jwks.json). Supabase
// signs tokens with asymmetric keys, so we validate against its public keys.
// Security: this proves the token came from Supabase Auth, not that the user is
// an admin (AdminOnlyFilter checks that).
var jwksUrl = builder.Configuration["Supabase:JwksUrl"]
    ?? throw new InvalidOperationException("Missing Supabase:JwksUrl in configuration - see appsettings.json.");

// ConfigurationManager fetches and caches the JWKS document (about every 24 h,
// with retries). Supabase serves a bare JWKS, not an OpenID discovery document,
// so JwksOnlyConfigurationRetriever below wraps it.
var jwksConfigManager = new ConfigurationManager<OpenIdConnectConfiguration>(
    jwksUrl,
    new JwksOnlyConfigurationRetriever(),
    new HttpDocumentRetriever { RequireHttps = true });

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Keep "sub" as "sub" instead of renaming it to the long NameIdentifier URI;
        // AdminOnlyFilter reads the plain "sub" claim.
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

// One CORS policy: Cors:AllowedOrigins (Railway: Cors__AllowedOrigins, comma-separated) plus
// the local dev origins, and any loopback origin in Development. See
// Services/CorsSetup.cs. Authentication and the device key are still required.
builder.Services.AddAgroFlowCors(builder.Configuration, builder.Environment);

// Set Mqtt:Host/Port/Username/Password to the HiveMQ Cloud cluster credentials.
// MqttConnectionService owns the one connection for subscribing and publishing;
// it is a singleton so IrrigationCommandNotifyService can use the same instance.
//
// Per-device credentials (migrations 0028 + 0029): DeviceAuthService resolves
// X-Device-Token to a board, so device endpoints act on the board the credential
// names, not the body. ClaimRateLimiter keeps per-IP counters in memory, so it must
// be a singleton. MqttCredentialPoolService hands out the pooled HiveMQ logins.
// Security: Mqtt__PoolEncryptionKey is a Railway variable and local user-secret,
// never in appsettings.json.
builder.Services.AddSingleton<DeviceAuthService>();
builder.Services.AddSingleton<ClaimRateLimiter>();
// Per-IP limit on the public enquiry form.
builder.Services.AddSingleton<EnquiryRateLimiter>();
builder.Services.AddSingleton<AgroFlow.Api.Auth.IProfileRoles, AgroFlow.Api.Auth.DbProfileRoles>();
builder.Services.AddSingleton<MqttCredentialPoolService>();

builder.Services.AddSingleton<MqttConnectionService>();
builder.Services.AddSingleton<IMqttPublisher>(sp => sp.GetRequiredService<MqttConnectionService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<MqttConnectionService>());
builder.Services.AddHostedService<IrrigationCommandNotifyService>();
// Farmer notifications (Telegram). A bot cannot message anyone first, so the admin
// shows a QR code during installation; the farmer scanning it creates the chat the
// bot uses for the welcome message and every alert.
// Security: Telegram__BotToken is a Railway variable and local user-secret, never
// in appsettings.json.
builder.Services.Configure<TelegramOptions>(
    builder.Configuration.GetSection(TelegramOptions.SectionName));

// Tokens and usernames pasted from @BotFather or a chat often have a trailing
// newline or a leading @, which would break the API URL or t.me link.
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

// Stops the same event being messaged again and again. The forecast refreshes
// every 6 hours with 8 days of data, so one storm would be announced about 20
// times without it (migration 0026).
builder.Services.AddSingleton<NotificationLedger>();

// The same claim-then-send for farm/zone request messages, in its own table,
// because a new_farm request has no farm yet (migration 0032).
builder.Services.AddSingleton<FarmRequestNotifier>();

// The append-only record of admin actions (migration 0037). A singleton like
// the other writers.
builder.Services.AddSingleton<AuditLog>();
builder.Services.AddSingleton<IAuditWriter>(sp => sp.GetRequiredService<AuditLog>());
// Dismiss and history for notifications.
builder.Services.AddSingleton<IDismissalStore, DbDismissalStore>();
builder.Services.AddSingleton<DismissalService>();
builder.Services.AddSingleton<SchemaCheck>();

// "Why am I seeing this?" for Telegram (migration 0039): stored explanations,
// who may read them, and the handler for button taps and /why.
builder.Services.AddSingleton<IExplanationStore, ExplanationStore>();
builder.Services.AddSingleton<IChatFarmAccess, ChatFarmAccess>();
builder.Services.AddSingleton<ITelegramReplies, TelegramReplies>();
builder.Services.AddSingleton<TelegramWhyHandler>();

// Password recovery over Telegram, because Supabase's email reset needs SMTP
// and we have none.
builder.Services.AddSingleton<PasswordResetService>();

// Singleton because MqttConnectionService and the hosted services below hold it
// for the whole process; it keeps no per-request state. Without a bot token every
// notification is a logged no-op, so the API runs with no Telegram set up.
if (builder.Configuration.GetSection(TelegramOptions.SectionName)["BotToken"] is { Length: > 0 })
{
    builder.Services.AddSingleton<INotificationService, TelegramNotificationService>();
}
else
{
    builder.Services.AddSingleton<INotificationService, NullNotificationService>();
}

// Inbound /start messages. Telegram:EnablePolling defaults to false: Telegram
// gives each update to one getUpdates consumer, so a local API would steal
// farmers' messages. Only Railway sets Telegram__EnablePolling=true.
// Registered as a singleton and as the hosted service (like MqttConnectionService)
// so the webhook uses the same instance and both routes behave the same.
builder.Services.AddSingleton<TelegramPollingService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<TelegramPollingService>());

// Equipment that has stopped working: quiet devices, pumps that never confirmed
// a command, zones with a silent sensor or nothing to control them.
builder.Services.AddHostedService<DeviceStatusMonitorService>();

// Crop-damaging weather, read from the stored forecast rows. Thresholds are
// configurable because what counts as dangerous is regional.
builder.Services.AddHostedService<WeatherAlertService>();

// Weather collection: fills weather_daily (0016) from Open-Meteo every
// Weather:FetchIntervalHours (default 6) for every farm with coordinates.
// Open-Meteo needs no API key.
builder.Services.AddHostedService<WeatherCollectionService>();

// FAO-56 insight engine (migration 0027): a full pass just after midnight SAST,
// and the act_now checks every 15 minutes.
// The controller is a singleton holding only a connection string (DB/XDB/Controller
// pattern). Fao56Engine:Enabled=false turns off the background passes but keeps
// the endpoints.
builder.Services.AddSingleton(sp => new AgroFlow.Business.Fao56EngineController(
    sp.GetRequiredService<IConfiguration>().GetConnectionString("Supabase")
        ?? throw new InvalidOperationException("Missing ConnectionStrings:Supabase for the FAO-56 engine.")));
builder.Services.AddHostedService<Fao56EngineService>();

// Turns `preparing` report_request rows (0034) into PDFs and sends them.
// A background queue because rendering can time out a phone on rural data, and
// automatic reports have no request to run in.
builder.Services.AddHostedService<ReportGenerationService>();

// Creates report_request rows for farms whose schedule (0035) is due, using the
// same queue as the app's Request button. Runs hourly so a deploy at the wrong
// moment cannot skip a week.
builder.Services.AddHostedService<AutoReportSchedulerService>();

// Historical backfill from Open-Meteo's archive (ERA5).
// WeatherBackfillStartupService decides whether to run it.
builder.Services.AddSingleton<WeatherBackfillService>();

// One-shot backfill, only when Weather:BackfillDays is set (Weather__BackfillDays
// on Railway). It runs once in the background after start-up. Remove the variable
// afterwards, or every redeploy repeats it (harmless, because the upsert does not
// duplicate, but wasteful).
builder.Services.AddHostedService<WeatherBackfillStartupService>();

var app = builder.Build();

// Logs once whether the container got the Telegram variables and from which
// configuration provider. Security: secret values are shown as a length, never printed.
StartupConfigurationDiagnostics.Log(
    app.Configuration,
    app.Services.GetRequiredService<IOptions<TelegramOptions>>(),
    app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("AgroFlow.Api.Startup"));

// An unhandled exception becomes a sentence instead of a bare 500: 503 when the
// database or network is unreachable, 500 otherwise. The exception only goes to the log.
app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var error = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
    var unreachable = error is Npgsql.NpgsqlException or System.Net.Sockets.SocketException or TimeoutException;
    context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("AgroFlow.Api.Errors")
        .LogError(error, "Unhandled error on {Method} {Path}.", context.Request.Method, context.Request.Path);

    context.Response.StatusCode = unreachable ? StatusCodes.Status503ServiceUnavailable : StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new
    {
        error = unreachable
            ? "AgroFlow cannot reach its database right now. Please try again in a few minutes."
            : "Something went wrong on our side. Please try again.",
    });
}));

// Applied before the gates and endpoints, so every response (401, 403, 500, 503)
// carries the CORS headers and the browser can show the API's message.
app.UseCors(CorsSetup.PolicyName);

// Security: device shared-secret gate. Skipped for the JWT-authenticated admin
// routes below.
app.Use(async (context, next) =>
{
    var path = context.Request.Path;

    // Security: routes that authenticate themselves, so the shared-key gate skips them.
    // /api/devices/claim: a newly flashed board has no credentials yet; the one-time
    // enrollment code is the authorisation and ClaimRateLimiter handles brute force.
    // The other three need X-Device-Token (DeviceAuthService), which is stronger than
    // the shared key. DeviceAuthService decides whether a legacy shared key is still
    // accepted (Devices:LegacyApiKeyEnabled).
    var isSelfAuthenticatingDeviceRoute =
        path.StartsWithSegments("/api/devices/claim") ||
        path.StartsWithSegments("/api/devices/mqtt-credentials") ||
        path.StartsWithSegments("/api/devices/firmware-check") ||
        path.StartsWithSegments("/api/devices/commands") ||
        path.StartsWithSegments("/api/irrigation-events");

    var isUserRoute = path.StartsWithSegments("/api/devices/enroll") ||
                  isSelfAuthenticatingDeviceRoute ||
                  // Security: every /api/admin route uses JWT + AdminOnlyFilter. Without this the
                  // browser would also need the device key, and the admin pages would get 401.
                  path.StartsWithSegments("/api/admin") ||
                  path.StartsWithSegments("/api/telegram") ||
                  // Security: anonymous because a farmer who forgot their password has neither a
                  // JWT nor the device key. The new password only goes to their linked Telegram
                  // chat (see PasswordResetEndpoints).
                  path.StartsWithSegments("/api/auth") ||
                  // Security: the public "Get a call back" form is anonymous; it rate-limits per IP
                  // and drops bots via the honeypot (EnquiryEndpoints).
                  path.StartsWithSegments("/api/public") ||
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
app.MapAuditLogEndpoints();
app.MapAdminSummaryEndpoints();
app.MapPlatformConfigEndpoints();

// Check once that the migrations' objects exist and log each missing one. Not
// awaited, so a slow database cannot stop the API starting; the health endpoint
// reports the same thing.
_ = Task.Run(async () =>
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<SchemaCheck>().LogAtStartupAsync();
});
app.MapFarmEndpoints();
app.MapLocationEndpoints();
app.MapUserEndpoints();
app.MapTelegramEndpoints();
app.MapTelegramWebhookEndpoints();
app.MapAdminRequestEndpoints();
app.MapHandlingEndpoints();
app.MapManualLogEndpoints();
app.MapTodayEndpoints();
app.MapZoneSetupEndpoints();
app.MapRecommendationEndpoints();
app.MapFarmZoneEndpoints();
app.MapEnquiryEndpoints();
app.MapEnquiryAdminEndpoints();
app.MapEnquiryReportEndpoints();
app.MapDismissalEndpoints();
app.MapMqttPoolEndpoints();
app.MapPasswordResetEndpoints();


app.Run();

// Parses a bare JWKS document ({"keys": [...]}), which is what Supabase's jwks.json
// is. The OpenIdConnectConfiguration wrapper only exists to satisfy
// ConfigurationManager<T>; we only read .SigningKeys.
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

// Lets the contract tests host the real API in memory (WebApplicationFactory).
public partial class Program { }
