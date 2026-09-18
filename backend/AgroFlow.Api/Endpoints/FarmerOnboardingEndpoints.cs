using System.Net.Http.Json;
using System.Text.Json.Serialization;
using AgroFlow.Api.Auth;

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
    string Phone,
    string Password
);

public record FarmerOnboardingZone(
    string Name,
    double SizeHectares,
    string CropType
);

public record FarmerOnboardingFarm(
    string FarmName,
    string Location,
    double SizeHectares,
    List<FarmerOnboardingZone> Zones
);

public record FarmerOnboardingRequest(
    FarmerOnboardingFarmer Farmer,
    FarmerOnboardingFarm Farm
);

public record FarmerOnboardingResponse(string Message);

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

    // FULL FARMER ONBOARDING
    private static async Task<IResult> OnboardAsync(
        FarmerOnboardingRequest request,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("FarmerOnboarding");

        // server-side validation
        if (string.IsNullOrWhiteSpace(request.Farmer.FullName))
            return Results.BadRequest(new
            {
                error = "Farmer name is required."
            });

        if (string.IsNullOrWhiteSpace(request.Farmer.Email))
            return Results.BadRequest(new
            {
                error = "Farmer email is required."
            });

        if (string.IsNullOrWhiteSpace(request.Farmer.Phone))
            return Results.BadRequest(new
            {
                error = "Farmer phone number is required."
            });

        if (string.IsNullOrWhiteSpace(request.Farmer.Password) ||
            request.Farmer.Password.Length < 8)
        {
            return Results.BadRequest(new
            {
                error = "Farmer password must be at least 8 characters."
            });
        }

        if (string.IsNullOrWhiteSpace(request.Farm.FarmName))
            return Results.BadRequest(new
            {
                error = "Farm name is required."
            });

        if (string.IsNullOrWhiteSpace(request.Farm.Location))
            return Results.BadRequest(new
            {
                error = "Farm location is required."
            });

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
                    error = $"Zone '{zone.Name}' must have a size greater than 0."
                });
            }

            if (string.IsNullOrWhiteSpace(zone.CropType))
    {
        return Results.BadRequest(new
        {
            error = $"Zone '{zone.Name}' must have a crop type."
        });
    }
        }

        // --------------------------------------------------------------------
        // GEOCODE FARM LOCATION
        // --------------------------------------------------------------------
        // The admin enters a readable location such as:
        // "Ceres, Western Cape"
        //
        // We use a separate HttpClient here so the Supabase service-role key
        // is NOT sent to Open-Meteo.
        var location = request.Farm.Location.Trim();

        (double Latitude, double Longitude)? coordinates;

        try
        {
            var geocodingClient = httpClientFactory.CreateClient();

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
                detail: "The location service could not be reached. Please try again.",
                statusCode: StatusCodes.Status502BadGateway
            );
        }

        if (coordinates is null)
        {
            return Results.BadRequest(new
            {
                error =
                    $"Farm location '{location}' could not be found. " +
                    "Enter a town or city and province, for example 'Ceres, Western Cape'."
            });
        }

        var (supabaseUrl, serviceRoleKey) =
            GetSupabaseAdminConfig(configuration);

        using var client =
            BuildAdminClient(httpClientFactory, serviceRoleKey);

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

                // These values come from Open-Meteo geocoding.
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
                        error = $"Supabase farm creation error: {error}"
                    },
                    statusCode: (int)farmResponse.StatusCode
                );
            }

            var farms =
                await farmResponse.Content
                    .ReadFromJsonAsync<List<SupabaseFarmResponse>>(
                        cancellationToken: cancellationToken
                    );

            farmId = farms?.FirstOrDefault()?.FarmId;

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
                password = request.Farmer.Password,
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
                        error = $"Supabase Auth API error: {error}"
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
        crop_type = zone.CropType.Trim()
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

            return Results.Ok(
                new FarmerOnboardingResponse(
                    "Farmer onboarded successfully."
                )
            );
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Farmer onboarding failed."
            );

            if (userId.HasValue)
            {
                await TryDeleteAuthUserAsync(
                    client,
                    supabaseUrl,
                    userId.Value,
                    logger
                );
            }

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
                detail: "The farmer could not be fully onboarded. No completed onboarding was saved.",
                statusCode: StatusCodes.Status500InternalServerError
            );
        }
    }

    // ------------------------------------------------------------------------
    // OPEN-METEO GEOCODING
    // ------------------------------------------------------------------------
    private static async Task<(double Latitude, double Longitude)?>
        GeocodeLocationAsync(
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
            first.Latitude,
            first.Longitude
        );
    }

    // EXISTING CREATE FARMER
    private static async Task<IResult> CreateAsync(
        CreateFarmerRequest request,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration)
    {
        var (supabaseUrl, serviceRoleKey) =
            GetSupabaseAdminConfig(configuration);

        using var client =
            BuildAdminClient(httpClientFactory, serviceRoleKey);

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
                    error = $"Supabase Admin API error: {error}"
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

    // EXISTING INVITE FARMER
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
            BuildAdminClient(httpClientFactory, serviceRoleKey);

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
                    error = $"Supabase Admin API error: {error}"
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

    // ------------------------------------------------------------------------
    // SUPABASE ADMIN CLIENT
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // SUPABASE CONFIG
    // ------------------------------------------------------------------------
    private static (string SupabaseUrl, string ServiceRoleKey)
        GetSupabaseAdminConfig(
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

    // ------------------------------------------------------------------------
    // CLEANUP HELPERS
    // ------------------------------------------------------------------------
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