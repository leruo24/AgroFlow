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
    // Item 6: the setup the advice needs (zone columns from 0017, 0018,
    // 0027). Optional so older admin builds still register farms.
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

// What /onboard returns now that there is no welcome email.
//
// TemporaryPassword is returned EXACTLY ONCE, here, and is never stored by
// AgroFlow. The admin screen shows it so the installer can read it out to a
// farmer who has no Telegram; there is no endpoint that can retrieve it
// later, because there is nothing to retrieve. "Show it again" is a reset
// that mints a new one.
//
// TelegramDeepLink is what the admin screen renders as a QR code. It is null
// when Telegram:BotUsername is not configured, in which case onboarding still
// succeeded and the password above is the whole delivery mechanism.
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

// Open-Meteo geocoding response.
// The admin enters a human-readable location such as
// "Ceres, Western Cape". Open-Meteo resolves that location to
// latitude and longitude so the weather service can use it.
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

// Both onboarding paths go through Supabase's own Admin Auth API rather than
// a hand-rolled invite-token table - see supabase/migrations/
// 0008_device_enrollment_and_onboarding.sql's handle_new_auth_user(),
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
        group.MapPost("/onboard", OnboardAsync);
    }

    // ========================================================================
    // FULL FARMER ONBOARDING
    // ========================================================================

    private static async Task<IResult> OnboardAsync(
        FarmerOnboardingRequest request,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        TelegramOnboardingService telegramOnboarding,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.Endpoints.FarmerOnboarding");

        // --------------------------------------------------------------------
        // SERVER-SIDE VALIDATION
        // --------------------------------------------------------------------

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

        // --------------------------------------------------------------------
        // VALIDATE TOTAL ZONE AREA
        // --------------------------------------------------------------------
        // The combined area of all irrigation zones cannot exceed
        // the total farm area.

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

        // --------------------------------------------------------------------
        // GEOCODE FARM LOCATION
        // --------------------------------------------------------------------
        // The admin enters a readable location such as:
        // "Ceres, Western Cape"
        //
        // We use a separate HttpClient here so the Supabase service-role key
        // is NOT sent to Open-Meteo.

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

        // --------------------------------------------------------------------
        // GENERATE TEMPORARY PASSWORD
        // --------------------------------------------------------------------
        // The actual password used for the Supabase Auth account is generated
        // by the backend and returned to the admin screen exactly once. It is
        // not persisted anywhere. If the farmer links Telegram, the bot
        // replaces it with a fresh one at that moment (see
        // TelegramPollingService) - the admin screen says so.

        var temporaryPassword = TemporaryPasswordGenerator.Generate();

        long? farmId = null;
        Guid? userId = null;

        try
        {
            // ----------------------------------------------------------------
            // CREATE FARM
            // ----------------------------------------------------------------

            var farmPayload = new
            {
                name = request.Farm.FarmName.Trim(),
                location = location,
                total_area = request.Farm.SizeHectares,

                // Explicit coordinates take precedence; otherwise these come
                // from Open-Meteo geocoding of the readable locality.
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

            // ----------------------------------------------------------------
            // CREATE AUTH USER
            // ----------------------------------------------------------------

            var authPayload = new
            {
                email = request.Farmer.Email.Trim(),

                // Use the server-generated temporary password.
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

            // ----------------------------------------------------------------
            // ASSIGN FARM OWNER
            // ----------------------------------------------------------------

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

            // ----------------------------------------------------------------
            // CREATE ZONES
            // ----------------------------------------------------------------

            var zonePayload = request.Farm.Zones
                .Select(zone => new
                {
                    farm_id = farmId.Value,
                    name = zone.Name.Trim(),
                    size_value = zone.SizeHectares,
                    size_unit = "ha",
                    location = coordinates.Value.Location,
                    crop_type = zone.CropType.Trim(),
                    // Item 6: soil defaults to loam exactly as the column does.
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

            // Onboarding is COMPLETE at this point: the farm, the Auth user
            // and every zone exist and are staying. Everything after this
            // line is delivery, and delivery is deliberately outside the try
            // block below - see the note there.
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Farmer onboarding failed."
            );

            // If the Auth user was created, remove it.
            // The Supabase trigger-created profile/farm_member records
            // should be removed through the Auth user deletion cascade.
            if (userId.HasValue)
            {
                await TryDeleteAuthUserAsync(
                    client,
                    supabaseUrl,
                    userId.Value,
                    logger
                );
            }

            // Remove zones and farm created during this onboarding attempt.
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

        // --------------------------------------------------------------------
        // TELEGRAM ONBOARDING CODE - AFTER THE COMMIT, OUTSIDE THE ROLLBACK
        // --------------------------------------------------------------------
        // This is the fix for the behaviour the Resend welcome email had: that
        // send sat INSIDE the try block above, so an email provider outage
        // landed in the catch and deleted the Auth user, the farm and every
        // zone that had just been created on-site. A messaging failure used to
        // destroy a completed onboarding.
        //
        // Nothing below may do that. The farmer, the farm and the zones exist
        // and are staying, whatever happens here. The worst case is a response
        // carrying a warning and no QR code, which the admin resolves with the
        // "Regenerate code" button - or by reading the temporary password out
        // loud, which is right there in the same response.

        string? deepLink = null;
        string? code = null;
        DateTimeOffset? expiresAt = null;
        string? warning = null;

        // The temporary password below is about to be read off an admin's
        // screen, and possibly written on a piece of paper. That applies
        // whether or not the farmer ever links Telegram, so the forced change
        // is set here rather than only on the bot's redemption path.
        //
        // The profile row exists by now: handle_new_auth_user() (migration
        // 0008) creates it from the auth.users insert above.
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
            // Not worth failing or warning the admin over: the farmer can
            // still sign in and change their password themselves, and the
            // account is otherwise complete.
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
                temporaryPassword,
                deepLink,
                code,
                expiresAt,
                warning
            )
        );
    }

    // ========================================================================
    // OPEN-METEO GEOCODING
    // ========================================================================

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

    // ========================================================================
    // EXISTING CREATE FARMER
    // ========================================================================

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

    // ========================================================================
    // EXISTING INVITE FARMER
    // ========================================================================
    // Supabase /auth/v1/invite creates the user and emails them a magic link
    // to set their own password. Requires SMTP config to actually reach inbox.

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

    // ========================================================================
    // SUPABASE ADMIN CLIENT
    // ========================================================================

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

    // ========================================================================
    // SUPABASE CONFIG
    // ========================================================================

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

    // ========================================================================
    // CLEANUP HELPERS
    // ========================================================================

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
