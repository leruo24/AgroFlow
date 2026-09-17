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
    double SizeHectares
);

public record FarmerOnboardingFarm(
    string FarmName,
    string Location,
    double SizeHectares,
    List<FarmerOnboardingZone> Zones,
    // Optional for now - manual entry until the admin dashboard geocodes
    // Location automatically. Left null, farm.latitude/longitude stay NULL
    // and the mobile app's WeatherSummary/FarmLocationMap have nothing to
    // show for this farm.
    double? Latitude = null,
    double? Longitude = null
);

public record FarmerOnboardingRequest(
    FarmerOnboardingFarmer Farmer,
    FarmerOnboardingFarm Farm
);

public record FarmerOnboardingResponse(string Message);

internal sealed record SupabaseAuthUserResponse(
    Guid Id
);

internal sealed record SupabaseFarmResponse(
    [property: JsonPropertyName("farm_id")] long FarmId
);


// Both onboarding paths go through Supabase's own Admin Auth API rather than
// a hand-rolled invite-token table - see supabase/migrations/
// 0008_device_enrollment_and_onboarding.sql's handle_new_auth_user() trigger,
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

    // -------------------------------------------------------------------------
    // FULL FARMER ONBOARDING
    // -------------------------------------------------------------------------
    //
    // The order here is important:
    //
    // 1. Create the farm first so we have a real farm_id.
    // 2. Create the Supabase Auth user with invitedFarmId in metadata.
    // 3. Supabase's handle_new_auth_user() trigger creates the profile and
    //    farm_member rows automatically.
    // 4. Link the new Auth user as the farm owner.
    // 5. Create the farmer's zones.
    //
    // The Auth user cannot be created first because the trigger needs the
    // farm_id in the user's metadata.
    private static async Task<IResult> OnboardAsync(
        FarmerOnboardingRequest request,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILoggerFactory loggerFactory)
    {
         var logger = loggerFactory.CreateLogger("FarmerOnboarding");
        // ---------------------------------------------------------------------
        // Validate the request server-side.
        // Never rely only on frontend validation.
        // ---------------------------------------------------------------------

        if (string.IsNullOrWhiteSpace(request.Farmer.FullName))
        {
            return Results.BadRequest(new { error = "Farmer name is required." });
        }

        if (string.IsNullOrWhiteSpace(request.Farmer.Email))
        {
            return Results.BadRequest(new { error = "Farmer email is required." });
        }

        if (string.IsNullOrWhiteSpace(request.Farmer.Phone))
        {
            return Results.BadRequest(new { error = "Farmer phone number is required." });
        }

        if (string.IsNullOrWhiteSpace(request.Farmer.Password) ||
            request.Farmer.Password.Length < 8)
        {
            return Results.BadRequest(new
            {
                error = "Farmer password must be at least 8 characters."
            });
        }

        if (string.IsNullOrWhiteSpace(request.Farm.FarmName))
        {
            return Results.BadRequest(new { error = "Farm name is required." });
        }

        if (string.IsNullOrWhiteSpace(request.Farm.Location))
        {
            return Results.BadRequest(new { error = "Farm location is required." });
        }

        if (request.Farm.SizeHectares <= 0)
        {
            return Results.BadRequest(new
            {
                error = "Farm size must be greater than 0."
            });
        }

        if (request.Farm.Latitude is < -90 or > 90)
        {
            return Results.BadRequest(new
            {
                error = "Latitude must be between -90 and 90."
            });
        }

        if (request.Farm.Longitude is < -180 or > 180)
        {
            return Results.BadRequest(new
            {
                error = "Longitude must be between -180 and 180."
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
        }

        var (supabaseUrl, serviceRoleKey) =
            GetSupabaseAdminConfig(configuration);

        using var client =
            BuildAdminClient(httpClientFactory, serviceRoleKey);

        long? farmId = null;
        Guid? userId = null;

        try
        {
            // -----------------------------------------------------------------
            // 1. CREATE THE FARM
            // -----------------------------------------------------------------

            var farmPayload = new
            {
                name = request.Farm.FarmName.Trim(),
                location = request.Farm.Location.Trim(),
                total_area = request.Farm.SizeHectares,
                status = "Active",
                latitude = request.Farm.Latitude,
                longitude = request.Farm.Longitude
            };

            using var farmRequest = new HttpRequestMessage(
                HttpMethod.Post,
                $"{supabaseUrl}/rest/v1/farm"
            )
            {
                Content = JsonContent.Create(farmPayload)
            };

            farmRequest.Headers.Add("Prefer", "return=representation");

            using var farmResponse =
                await client.SendAsync(farmRequest);

            if (!farmResponse.IsSuccessStatusCode)
            {
                var error =
                    await farmResponse.Content.ReadAsStringAsync();

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
                    .ReadFromJsonAsync<List<SupabaseFarmResponse>>();

            farmId = farms?.FirstOrDefault()?.FarmId;

            if (farmId is null)
            {
                throw new InvalidOperationException(
                    "Supabase created the farm but did not return a farm_id."
                );
            }

            // -----------------------------------------------------------------
            // 2. CREATE THE SUPABASE AUTH USER
            // -----------------------------------------------------------------
            //
            // invitedFarmId is read by handle_new_auth_user().
            // That trigger creates:
            //
            // profile
            // farm_member
            //
            // The role is deliberately NOT supplied by the frontend.
            // The trigger assigns farm_user.
            // -----------------------------------------------------------------

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
                    authPayload
                );

            if (!authResponse.IsSuccessStatusCode)
            {
                var error =
                    await authResponse.Content.ReadAsStringAsync();

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
                    .ReadFromJsonAsync<SupabaseAuthUserResponse>();

            if (authUser is null ||
                authUser.Id == Guid.Empty)
            {
                throw new InvalidOperationException(
                    "Supabase created the Auth user but did not return a user ID."
                );
            }

            userId = authUser.Id;

            // -----------------------------------------------------------------
            // 3. LINK THE FARM OWNER
            // -----------------------------------------------------------------

            var ownerPayload = new
            {
                owner_id = userId.Value
            };

            using var ownerRequest = new HttpRequestMessage(
                HttpMethod.Patch,
                $"{supabaseUrl}/rest/v1/farm?farm_id=eq.{farmId.Value}"
            )
            {
                Content = JsonContent.Create(ownerPayload)
            };

            ownerRequest.Headers.Add("Prefer", "return=minimal");

            using var ownerResponse =
                await client.SendAsync(ownerRequest);

            if (!ownerResponse.IsSuccessStatusCode)
            {
                var error =
                    await ownerResponse.Content.ReadAsStringAsync();

                throw new InvalidOperationException(
                    $"Unable to assign farmer as farm owner: {error}"
                );
            }

            // -----------------------------------------------------------------
            // 4. CREATE THE ZONES
            // -----------------------------------------------------------------

            var zonePayload = request.Farm.Zones
                .Select(zone => new
                {
                    farm_id = farmId.Value,
                    name = zone.Name.Trim(),
                    size_value = zone.SizeHectares,
                    size_unit = "ha"
                })
                .ToList();

            using var zoneRequest = new HttpRequestMessage(
                HttpMethod.Post,
                $"{supabaseUrl}/rest/v1/zone"
            )
            {
                Content = JsonContent.Create(zonePayload)
            };

            zoneRequest.Headers.Add("Prefer", "return=minimal");

            using var zoneResponse =
                await client.SendAsync(zoneRequest);

            if (!zoneResponse.IsSuccessStatusCode)
            {
                var error =
                    await zoneResponse.Content.ReadAsStringAsync();

                throw new InvalidOperationException(
                    $"Unable to create zones: {error}"
                );
            }

            // -----------------------------------------------------------------
            // SUCCESS
            // -----------------------------------------------------------------

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

            // Auth user first, because the trigger-created farm_member
            // references the farmer/profile.
            if (userId.HasValue)
            {
                await TryDeleteAuthUserAsync(
                    client,
                    supabaseUrl,
                    userId.Value,
                    logger
                );
            }

            // Delete any zones that may have been partially created.
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


    // -------------------------------------------------------------------------
    // EXISTING CREATE FARMER ENDPOINT
    // -------------------------------------------------------------------------

    // Admin sets the farmer's email + a temporary password directly.
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


    // -------------------------------------------------------------------------
    // EXISTING INVITE FARMER ENDPOINT
    // -------------------------------------------------------------------------

    // Generates a one-time invite via Supabase Auth's built-in mechanism -
    // Supabase creates the user AND emails them a magic link to set their own
    // password. TODO: this only actually reaches the farmer's inbox if the
    // Supabase project has a real SMTP provider configured (Settings -> Auth
    // -> SMTP Settings). The default shared Supabase dev SMTP works for
    // testing but is low-volume/rate-limited - not something to rely on
    // for real farmers.
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


    // -------------------------------------------------------------------------
    // SUPABASE HTTP HELPERS
    // -------------------------------------------------------------------------

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


    // -------------------------------------------------------------------------
    // CLEANUP HELPERS
    // -------------------------------------------------------------------------
    //
    // Auth + database operations cannot all happen inside one transaction
    // because the Auth Admin API is a separate service.
    //
    // Therefore, if a later step fails, we perform best-effort cleanup so
    // that a half-created farmer/farm is not left behind.
    // -------------------------------------------------------------------------

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
                    "Failed to clean up Auth user {UserId}: {Error}",
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
                    "Failed to clean up zones for farm {FarmId}: {Error}",
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
                    "Failed to clean up farm {FarmId}: {Error}",
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