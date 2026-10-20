using System.Net.Http.Json;
using System.Text.Json.Serialization;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;

namespace AgroFlow.Api.Endpoints;

public record CreateFarmerRequest(
    string Email,
    string TemporaryPassword,
    long FarmId,
    string? Name
);

public record InviteFarmerRequest(
    string Email,
    long FarmId,
    string? Name
);

public record FarmerOnboardingFarmer(
    string FullName,
    string Email,
    string Phone
);

public record FarmerOnboardingZone(
    string Name,
    double SizeHectares,
    string CropType,
    // The zone setup the advice needs (columns from 0017, 0018, 0027). Optional so
    // older admin builds can still register farms.
    string? SoilType = null,
    double? AreaM2 = null,
    DateOnly? PlantingDate = null,
    double? RootDepthLimitM = null,
    double? FlowRateLpm = null
);

public record FarmerOnboardingFarm(
    string FarmName,
    string Location,
    double SizeHectares,
    List<FarmerOnboardingZone> Zones,
    double? Latitude = null,
    double? Longitude = null
);

public record FarmerOnboardingRequest(
    FarmerOnboardingFarmer Farmer,
    FarmerOnboardingFarm Farm
);

public record FarmerOnboardingResponse(string Message);

// What /onboard returns.
// Security: TemporaryPassword is returned only once, here, and never stored. The
// admin screen shows it so the installer can read it to a farmer without
// Telegram; showing it again means a reset with a new one.
// TelegramDeepLink is shown as a QR code. It is null when Telegram:BotUsername is
// not set, and onboarding still succeeds.
public record FarmerOnboardedResponse(
    string Message,
    Guid ProfileId,
    string Email,
    string TemporaryPassword,
    string? TelegramDeepLink,
    string? TelegramCode,
    DateTimeOffset? TelegramCodeExpiresAt,
    string? Warning);

internal sealed record SupabaseAuthUserResponse(Guid Id);

internal sealed record SupabaseFarmResponse(
    [property: JsonPropertyName("farm_id")] long FarmId
);

// Open-Meteo geocoding response: turns a location like "Ceres, Western Cape"
// into latitude and longitude for the weather service.
internal sealed record OpenMeteoGeocodingResponse(
    [property: JsonPropertyName("results")]
    List<OpenMeteoGeocodingResult>? Results
);

internal sealed record OpenMeteoGeocodingResult(
    [property: JsonPropertyName("name")]
    string Name,

    [property: JsonPropertyName("latitude")]
    double Latitude,

    [property: JsonPropertyName("longitude")]
    double Longitude
);

// Both onboarding paths use Supabase's Admin Auth API; handle_new_auth_user()
// (migration 0008) then creates the profile and farm_member rows.
// Security: Supabase:ServiceRoleKey bypasses Row Level Security, so it must only
// ever be in this server config, never in the admin web app.
public static class FarmerOnboardingEndpoints
{
    public static void MapFarmerOnboardingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/farmers")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        group.MapPost("/create", CreateAsync);
        group.MapPost("/invite", InviteAsync);
        group.MapPost("/onboard", OnboardAsync);
    }

    // Full farmer onboarding

    private static async Task<IResult> OnboardAsync(
        FarmerOnboardingRequest request,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        TelegramOnboardingService telegramOnboarding,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.Endpoints.FarmerOnboarding");

        // Server-side validation

        if (string.IsNullOrWhiteSpace(request.Farmer.FullName))
        {
            return Results.BadRequest(new
            {
                error = "Farmer name is required."
            });
        }

        if (string.IsNullOrWhiteSpace(request.Farmer.Email))
        {
            return Results.BadRequest(new
            {
                error = "Farmer email is required."
            });
        }

        if (string.IsNullOrWhiteSpace(request.Farmer.Phone))
        {
            return Results.BadRequest(new
            {
                error = "Farmer phone number is required."
            });
        }

        if (string.IsNullOrWhiteSpace(request.Farm.FarmName))
        {
            return Results.BadRequest(new
            {
                error = "Farm name is required."
            });
        }

        var suppliedCoordinates = ValidCoordinates(request.Farm.Latitude, request.Farm.Longitude);
        if ((request.Farm.Latitude.HasValue || request.Farm.Longitude.HasValue) && !suppliedCoordinates)
        {
            return Results.BadRequest(new { error = "Provide both latitude (-90 to 90) and longitude (-180 to 180)." });
        }

        if (string.IsNullOrWhiteSpace(request.Farm.Location) && !suppliedCoordinates)
            return Results.BadRequest(new { error = "Search for a farm location or provide precise coordinates." });

        if (request.Farm.SizeHectares <= 0)
        {
            return Results.BadRequest(new
            {
                error = "Farm size must be greater than 0."
            });
        }

        if (request.Farm.Zones is null ||
            request.Farm.Zones.Count == 0)
        {
            return Results.BadRequest(new
            {
                error = "At least one zone is required."
            });
        }

        if (request.Farm.Zones.Count > 50)
        {
            return Results.BadRequest(new
            {
                error = "A maximum of 50 zones can be created at once."
            });
        }

        foreach (var zone in request.Farm.Zones)
        {
            if (string.IsNullOrWhiteSpace(zone.Name))
            {
                return Results.BadRequest(new
                {
                    error = "Every zone must have a name."
                });
            }

            if (zone.SizeHectares <= 0)
            {
                return Results.BadRequest(new
                {
                    error =
                        $"Zone '{zone.Name}' must have a size greater than 0."
                });
            }

            if (string.IsNullOrWhiteSpace(zone.CropType))
            {
                return Results.BadRequest(new
                {
                    error =
                        $"Zone '{zone.Name}' must have a crop type."
                });
            }

            if (ZoneSetupFields.Check(zone.Name, zone.SizeHectares, zone.SoilType, zone.AreaM2,
                    zone.PlantingDate, zone.RootDepthLimitM, zone.FlowRateLpm, AgroFlow.Business.Fao56EngineController.TodayInSast()) is { } setupProblem)
            {
                return Results.BadRequest(new { error = setupProblem });
            }
        }

        // The zones together cannot be bigger than the farm.

        var totalZoneSize =
            request.Farm.Zones.Sum(zone => zone.SizeHectares);

        if (totalZoneSize > request.Farm.SizeHectares)
        {
            return Results.BadRequest(new
            {
                error =
                    $"The total zone area ({totalZoneSize:0.##} ha) " +
                    $"cannot exceed the farm size " +
                    $"({request.Farm.SizeHectares:0.##} ha)."
            });
        }

        // Geocode the farm location (e.g. "Ceres, Western Cape").
        // Security: a separate HttpClient, so the Supabase service-role key is never sent
        // to Open-Meteo.

        var location = request.Farm.Location?.Trim() ?? "";

        (string Location, double Latitude, double Longitude)? coordinates;

        if (suppliedCoordinates)
        {
            var readable = string.IsNullOrWhiteSpace(location)
                ? $"Coordinates: {request.Farm.Latitude:0.#####}, {request.Farm.Longitude:0.#####}"
                : location;
            coordinates = (readable, request.Farm.Latitude!.Value, request.Farm.Longitude!.Value);
            location = readable;
        }
        else try
        {
            var geocodingClient =
                httpClientFactory.CreateClient();

            coordinates = await GeocodeLocationAsync(
                geocodingClient,
                location,
                cancellationToken
            );
        }
        catch (HttpRequestException ex)
        {
            logger.LogError(
                ex,
                "Farm location geocoding request failed for '{Location}'.",
                location
            );

            return Results.Problem(
                title: "Farm location could not be verified.",
                detail:
                    "The location service could not be reached. Please try again.",
                statusCode: StatusCodes.Status502BadGateway
            );
        }

        if (coordinates is null)
        {
            return Results.BadRequest(new
            {
                error =
                    $"Farm location '{location}' could not be found. " +
                    "Enter a town or city and province, for example " +
                    "'Ceres, Western Cape'."
            });
        }

        location = coordinates.Value.Location;

        var (supabaseUrl, serviceRoleKey) =
            GetSupabaseAdminConfig(configuration);

        using var client =
            BuildAdminClient(
                httpClientFactory,
                serviceRoleKey
            );

        // Generate a temporary password for the Supabase account. It is shown to the
        // admin once and never stored. If the farmer links Telegram, the bot replaces it
        // with a new one (see TelegramPollingService).

        var temporaryPassword = TemporaryPasswordGenerator.Generate();

        long? farmId = null;
        Guid? userId = null;

        try
        {
            // Create the farm

            var farmPayload = new
            {
                name = request.Farm.FarmName.Trim(),
                location = location,
                total_area = request.Farm.SizeHectares,

                // Explicit coordinates win; otherwise we use Open-Meteo's geocoding of the place name.
                latitude = coordinates.Value.Latitude,
                longitude = coordinates.Value.Longitude,

                status = "Active"
            };

            using var farmRequest = new HttpRequestMessage(
                HttpMethod.Post,
                $"{supabaseUrl}/rest/v1/farm")
            {
                Content = JsonContent.Create(farmPayload)
            };

            farmRequest.Headers.Add(
                "Prefer",
                "return=representation"
            );

            using var farmResponse =
                await client.SendAsync(
                    farmRequest,
                    cancellationToken
                );

            if (!farmResponse.IsSuccessStatusCode)
            {
                var error =
                    await farmResponse.Content.ReadAsStringAsync(
                        cancellationToken
                    );

                return Results.Json(
                    new
                    {
                        error =
                            $"Supabase farm creation error: {error}"
                    },
                    statusCode: (int)farmResponse.StatusCode
                );
            }

            var farms =
                await farmResponse.Content
                    .ReadFromJsonAsync<List<SupabaseFarmResponse>>(
                        cancellationToken: cancellationToken
                    );

            farmId =
                farms?.FirstOrDefault()?.FarmId;

            if (farmId is null)
            {
                throw new InvalidOperationException(
                    "Supabase created the farm but did not return a farm_id."
                );
            }

            // Create the Auth user

            var authPayload = new
            {
                email = request.Farmer.Email.Trim(),

                // The server-generated temporary password.
                password = temporaryPassword,

                email_confirm = true,

                user_metadata = new
                {
                    invitedFarmId = farmId.Value,
                    name = request.Farmer.FullName.Trim(),
                    phone = request.Farmer.Phone.Trim()
                }
            };

            using var authResponse =
                await client.PostAsJsonAsync(
                    $"{supabaseUrl}/auth/v1/admin/users",
                    authPayload,
                    cancellationToken
                );

            if (!authResponse.IsSuccessStatusCode)
            {
                var error =
                    await authResponse.Content.ReadAsStringAsync(
                        cancellationToken
                    );

                await TryDeleteFarmAsync(
                    client,
                    supabaseUrl,
                    farmId.Value,
                    logger
                );

                return Results.Json(
                    new
                    {
                        error =
                            $"Supabase Auth API error: {error}"
                    },
                    statusCode: (int)authResponse.StatusCode
                );
            }

            var authUser =
                await authResponse.Content
                    .ReadFromJsonAsync<SupabaseAuthUserResponse>(
                        cancellationToken: cancellationToken
                    );

            if (authUser is null ||
                authUser.Id == Guid.Empty)
            {
                throw new InvalidOperationException(
                    "Supabase created the Auth user but did not return a user ID."
                );
            }

            userId = authUser.Id;

            // Make the farmer the farm owner

            var ownerPayload = new
            {
                owner_id = userId.Value
            };

            using var ownerRequest = new HttpRequestMessage(
                HttpMethod.Patch,
                $"{supabaseUrl}/rest/v1/farm?farm_id=eq.{farmId.Value}")
            {
                Content = JsonContent.Create(ownerPayload)
            };

            ownerRequest.Headers.Add(
                "Prefer",
                "return=minimal"
            );

            using var ownerResponse =
                await client.SendAsync(
                    ownerRequest,
                    cancellationToken
                );

            if (!ownerResponse.IsSuccessStatusCode)
            {
                var error =
                    await ownerResponse.Content.ReadAsStringAsync(
                        cancellationToken
                    );

                throw new InvalidOperationException(
                    $"Unable to assign farmer as farm owner: {error}"
                );
            }

            // Create the zones

            var zonePayload = request.Farm.Zones
                .Select(zone => new
                {
                    farm_id = farmId.Value,
                    name = zone.Name.Trim(),
                    size_value = zone.SizeHectares,
                    size_unit = "ha",
                    location = coordinates.Value.Location,
                    crop_type = zone.CropType.Trim(),
                    // Soil defaults to loam, the same as the column default.
                    soil_type = zone.SoilType?.Trim().ToLowerInvariant() ?? "loam",
                    area_m2 = zone.AreaM2,
                    planting_date = zone.PlantingDate?.ToString("yyyy-MM-dd"),
                    root_depth_limit_m = zone.RootDepthLimitM,
                    flow_rate_lpm = zone.FlowRateLpm,
                })
                .ToList();

            using var zoneRequest = new HttpRequestMessage(
                HttpMethod.Post,
                $"{supabaseUrl}/rest/v1/zone")
            {
                Content = JsonContent.Create(zonePayload)
            };

            zoneRequest.Headers.Add(
                "Prefer",
                "return=minimal"
            );

            using var zoneResponse =
                await client.SendAsync(
                    zoneRequest,
                    cancellationToken
                );

            if (!zoneResponse.IsSuccessStatusCode)
            {
                var error =
                    await zoneResponse.Content.ReadAsStringAsync(
                        cancellationToken
                    );

                throw new InvalidOperationException(
                    $"Unable to create zones: {error}"
                );
            }

            // Onboarding is complete here: the farm, the Auth user and the zones stay.
            // Everything after this is delivery, which sits outside the try block below.
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Farmer onboarding failed."
            );

            // If the Auth user was created, remove it; the trigger-created profile and
            // farm_member rows go with it.
            if (userId.HasValue)
            {
                await TryDeleteAuthUserAsync(
                    client,
                    supabaseUrl,
                    userId.Value,
                    logger
                );
            }

            // Remove the zones and farm created in this attempt.
            if (farmId.HasValue)
            {
                await TryDeleteZonesAsync(
                    client,
                    supabaseUrl,
                    farmId.Value,
                    logger
                );

                await TryDeleteFarmAsync(
                    client,
                    supabaseUrl,
                    farmId.Value,
                    logger
                );
            }

            return Results.Problem(
                title: "Farmer onboarding failed.",
                detail:
                    "The farmer could not be fully onboarded. " +
                    "No completed onboarding was saved.",
                statusCode: StatusCodes.Status500InternalServerError
            );
        }

        // Telegram onboarding code, after the commit and outside the rollback.
        // Nothing here may undo a finished onboarding. At worst the response has a warning
        // and no QR code, and the admin can use "Regenerate code" or read out the
        // temporary password.

        string? deepLink = null;
        string? code = null;
        DateTimeOffset? expiresAt = null;
        string? warning = null;

        // Security: the temporary password is read off an admin's screen, so we always
        // force a password change, whether or not the farmer links Telegram.
        // The profile row already exists: handle_new_auth_user() (0008) created it.
        try
        {
            await telegramOnboarding.SetMustChangePasswordAsync(
                userId!.Value,
                true,
                cancellationToken
            );
        }
        catch (Exception ex)
        {
            // Not worth failing for: the farmer can still sign in and change the password.
            logger.LogWarning(
                ex,
                "Could not set must_change_password for {UserId} after onboarding.",
                userId!.Value
            );
        }

        try
        {
            var issued = await telegramOnboarding.IssueCodeAsync(
                userId!.Value,
                TelegramCodePurpose.Onboarding,
                cancellationToken
            );

            code = issued.Code;
            expiresAt = issued.ExpiresAt;
            deepLink = issued.DeepLink;

            if (deepLink is null)
            {
                warning =
                    "Telegram:BotUsername is not configured, so no QR link could be built. " +
                    "Give the farmer the temporary password directly.";

                logger.LogWarning(
                    "Issued an onboarding code for {UserId} but Telegram:BotUsername is unset.",
                    userId.Value
                );
            }
        }
        catch (Exception ex)
        {
            warning =
                "The farmer was created successfully, but the Telegram onboarding code " +
                "could not be generated. Use Regenerate code, or give the farmer the " +
                "temporary password directly.";

            logger.LogError(
                ex,
                "Onboarding for {UserId} succeeded but issuing a Telegram code failed.",
                userId!.Value
            );
        }

        return Results.Ok(
            new FarmerOnboardedResponse(
                "Farmer onboarded successfully.",
                userId!.Value,
                request.Farmer.Email.Trim(),
                AgroFlow.Business.EasyPassword.Display(temporaryPassword),   // "KX7P 4MRT"; set without the space
                deepLink,
                code,
                expiresAt,
                warning
            )
        );
    }

    // Open-Meteo geocoding

    private static async Task<
        (string Location, double Latitude, double Longitude)?
    > GeocodeLocationAsync(
        HttpClient client,
        string location,
        CancellationToken cancellationToken)
    {
        var url =
            "https://geocoding-api.open-meteo.com/v1/search" +
            $"?name={Uri.EscapeDataString(location)}" +
            "&count=1" +
            "&language=en" +
            "&format=json" +
            "&countryCode=ZA";

        using var response =
            await client.GetAsync(
                url,
                cancellationToken
            );

        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        var result =
            await response.Content
                .ReadFromJsonAsync<OpenMeteoGeocodingResponse>(
                    cancellationToken: cancellationToken
                );

        var first =
            result?.Results?.FirstOrDefault();

        if (first is null)
        {
            return null;
        }

        return (
            first.Name,
            first.Latitude,
            first.Longitude
        );
    }

    private static bool ValidCoordinates(double? latitude, double? longitude) =>
        latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;

    // Create farmer (older route)

    private static async Task<IResult> CreateAsync(
        CreateFarmerRequest request,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration)
    {
        var (supabaseUrl, serviceRoleKey) =
            GetSupabaseAdminConfig(configuration);

        using var client =
            BuildAdminClient(
                httpClientFactory,
                serviceRoleKey
            );

        var payload = new
        {
            email = request.Email,
            password = request.TemporaryPassword,
            email_confirm = true,

            user_metadata = new
            {
                invitedFarmId = request.FarmId,
                name = request.Name ?? ""
            }
        };

        var response =
            await client.PostAsJsonAsync(
                $"{supabaseUrl}/auth/v1/admin/users",
                payload
            );

        if (!response.IsSuccessStatusCode)
        {
            var error =
                await response.Content.ReadAsStringAsync();

            return Results.Json(
                new
                {
                    error =
                        $"Supabase Admin API error: {error}"
                },
                statusCode: (int)response.StatusCode
            );
        }

        return Results.Ok(
            new FarmerOnboardingResponse(
                "Farmer account created."
            )
        );
    }

    // Invite farmer (older route). Supabase /auth/v1/invite creates the user and
    // emails a link to set their own password. Needs SMTP to be configured.

    private static async Task<IResult> InviteAsync(
        InviteFarmerRequest request,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration)
    {
        var (supabaseUrl, serviceRoleKey) =
            GetSupabaseAdminConfig(configuration);

        using var client =
            BuildAdminClient(
                httpClientFactory,
                serviceRoleKey
            );

        var payload = new
        {
            email = request.Email,

            data = new
            {
                invitedFarmId = request.FarmId,
                name = request.Name ?? ""
            }
        };

        var response =
            await client.PostAsJsonAsync(
                $"{supabaseUrl}/auth/v1/invite",
                payload
            );

        if (!response.IsSuccessStatusCode)
        {
            var error =
                await response.Content.ReadAsStringAsync();

            return Results.Json(
                new
                {
                    error =
                        $"Supabase Admin API error: {error}"
                },
                statusCode: (int)response.StatusCode
            );
        }

        return Results.Ok(
            new FarmerOnboardingResponse(
                "Invite sent."
            )
        );
    }

    // Supabase admin client

    private static HttpClient BuildAdminClient(
        IHttpClientFactory httpClientFactory,
        string serviceRoleKey)
    {
        var client =
            httpClientFactory.CreateClient();

        client.DefaultRequestHeaders.Add(
            "apikey",
            serviceRoleKey
        );

        client.DefaultRequestHeaders.Add(
            "Authorization",
            $"Bearer {serviceRoleKey}"
        );

        return client;
    }

    // Supabase config

    private static (
        string SupabaseUrl,
        string ServiceRoleKey
    ) GetSupabaseAdminConfig(
        IConfiguration configuration)
    {
        var url =
            configuration["Supabase:Url"]
            ?? throw new InvalidOperationException(
                "Missing Supabase:Url in configuration - see appsettings.json."
            );

        var key =
            configuration["Supabase:ServiceRoleKey"]
            ?? throw new InvalidOperationException(
                "Missing Supabase:ServiceRoleKey in configuration - see appsettings.json."
            );

        return (
            url.TrimEnd('/'),
            key
        );
    }

    // Cleanup helpers

    private static async Task TryDeleteAuthUserAsync(
        HttpClient client,
        string supabaseUrl,
        Guid userId,
        ILogger logger)
    {
        try
        {
            using var response =
                await client.DeleteAsync(
                    $"{supabaseUrl}/auth/v1/admin/users/{userId}"
                );

            if (!response.IsSuccessStatusCode)
            {
                var error =
                    await response.Content.ReadAsStringAsync();

                logger.LogWarning(
                    "Unable to clean up Auth user {UserId}: {Error}",
                    userId,
                    error
                );
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "Exception while cleaning up Auth user {UserId}.",
                userId
            );
        }
    }

    private static async Task TryDeleteZonesAsync(
        HttpClient client,
        string supabaseUrl,
        long farmId,
        ILogger logger)
    {
        try
        {
            using var response =
                await client.DeleteAsync(
                    $"{supabaseUrl}/rest/v1/zone?farm_id=eq.{farmId}"
                );

            if (!response.IsSuccessStatusCode)
            {
                var error =
                    await response.Content.ReadAsStringAsync();

                logger.LogWarning(
                    "Unable to clean up zones for farm {FarmId}: {Error}",
                    farmId,
                    error
                );
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "Exception while cleaning up zones for farm {FarmId}.",
                farmId
            );
        }
    }

    private static async Task TryDeleteFarmAsync(
        HttpClient client,
        string supabaseUrl,
        long farmId,
        ILogger logger)
    {
        try
        {
            using var response =
                await client.DeleteAsync(
                    $"{supabaseUrl}/rest/v1/farm?farm_id=eq.{farmId}"
                );

            if (!response.IsSuccessStatusCode)
            {
                var error =
                    await response.Content.ReadAsStringAsync();

                logger.LogWarning(
                    "Unable to clean up farm {FarmId}: {Error}",
                    farmId,
                    error
                );
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "Exception while cleaning up farm {FarmId}.",
                farmId
            );
        }
    }
}
