using System.Text;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Mqtt;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

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

// TODO: set Supabase:JwtSecret to your project's JWT secret (Settings -> API
// -> JWT Settings -> "Legacy JWT Secret" in the Supabase dashboard). This
// validates that a bearer token was genuinely issued by Supabase Auth for a
// real logged-in user - it does NOT by itself prove that user is an admin,
// see AdminOnlyFilter for the role check.
//
// If this project has migrated to Supabase's newer asymmetric JWT signing
// keys, the legacy shared secret may not be exposed the same way - in that
// case this needs to switch to JWKS-based validation
// (https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json) instead
// of a symmetric key. Using the legacy secret here since it's simpler and
// still supported for backward compatibility on all Supabase projects.
var supabaseJwtSecret = builder.Configuration["Supabase:JwtSecret"]
    ?? throw new InvalidOperationException("Missing Supabase:JwtSecret in configuration - see appsettings.json.");

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
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(supabaseJwtSecret)),
            ValidateAudience = true,
            ValidAudience = "authenticated", // Supabase's standard audience claim for logged-in users
            ValidateIssuer = false, // would need the exact project ref to validate reliably; signing key check is the important part
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddHttpClient();

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

var app = builder.Build();

// Device shared-secret gate - skipped for the admin (JWT-authenticated)
// routes below, which use app.UseAuthentication()/UseAuthorization() instead.
app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    var isAdminRoute = path.StartsWithSegments("/api/devices/enroll") ||
                        path.StartsWithSegments("/api/farmers");

    if (!isAdminRoute &&
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
app.MapFarmerOnboardingEndpoints();

app.Run();
