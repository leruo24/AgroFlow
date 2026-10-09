using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

// People interested in AgroFlow ask for a call back.
// POST /api/public/enquiries needs no login. It is checked on the server
// (EnquiryRules), rate-limited per IP, and a hidden honeypot field catches bots
// without a captcha. Admins are told on Telegram. The admin side is in
// EnquiryAdminEndpoints.
public static class EnquiryEndpoints
{
    public const string ThankYou = "Thank you, a representative will call you within 2 working days.";

    public static void MapEnquiryEndpoints(this WebApplication app)
    {
        app.MapPost("/api/public/enquiries", SubmitAsync).AllowAnonymous();

        // "Is the server there?" for the admin's error messages: if this answers when
        // another request failed, a browser extension probably blocked it. No login, no
        // database, only "ok".
        app.MapGet("/api/public/ping", () => Results.Ok(new { ok = true })).AllowAnonymous();
    }

    private static async Task<IResult> SubmitAsync(
        EnquiryForm form, HttpContext context, NpgsqlDataSource dataSource, EnquiryRateLimiter limiter,
        INotificationService notifications, ILoggerFactory loggerFactory, CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.Enquiries");

        // Rate limit first, so a script cannot use the checks to probe.
        if (!limiter.TryTake(ClaimRateLimiter.ResolveAddress(context), DateTimeOffset.UtcNow))
        {
            return Results.Json(
                new { error = "Too many enquiries from this connection. Please try again in an hour." },
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        // A bot gets the same thank-you as a person, so it learns nothing.
        if (EnquiryRules.IsBot(form))
        {
            logger.LogInformation("Honeypot filled: enquiry discarded.");
            return Results.Ok(new { message = ThankYou });
        }

        if (EnquiryRules.Check(form) is { } problem) return Results.BadRequest(new { error = problem });

        // If the database is down the person gets a sentence, not a bare 500.
        var crops = form.Crops!.Distinct().ToArray();
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(ct);
            await using (var exists = new NpgsqlCommand("select to_regclass('public.enquiry') is not null", connection))
            {
                if (await exists.ExecuteScalarAsync(ct) is not true)
                {
                    logger.LogError("An enquiry arrived but migration 0044 (enquiry) is not applied.");
                    return Results.Json(
                        new { error = "We could not take your enquiry right now. Please try again later." },
                        statusCode: StatusCodes.Status503ServiceUnavailable);
                }
            }

            await using (var cmd = new NpgsqlCommand(
                """
                insert into enquiry (full_name, phone, email, province, town, farm_size_ha, crops, crops_other,
                                     best_time, notes, consent_at)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
                """, connection))
            {
                cmd.Parameters.AddWithValue(form.FullName!.Trim());
                cmd.Parameters.AddWithValue(EnquiryRules.NormalisePhone(form.Phone)!);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Text, string.IsNullOrWhiteSpace(form.Email) ? DBNull.Value : form.Email.Trim());
                cmd.Parameters.AddWithValue(form.Province!);
                cmd.Parameters.AddWithValue(form.Town!.Trim());
                cmd.Parameters.AddWithValue(NpgsqlDbType.Numeric, form.FarmSizeHa is { } ha ? (object)(decimal)ha : DBNull.Value);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Array | NpgsqlDbType.Text, crops);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Text, string.IsNullOrWhiteSpace(form.CropsOther) ? DBNull.Value : form.CropsOther.Trim());
                cmd.Parameters.AddWithValue(form.BestTime!);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Text, string.IsNullOrWhiteSpace(form.Notes) ? DBNull.Value : form.Notes.Trim());
                await cmd.ExecuteNonQueryAsync(ct);
            }
        }
        catch (NpgsqlException ex)
        {
            logger.LogError(ex, "An enquiry could not be saved: the database could not be reached.");
            return Results.Json(
                new { error = "We could not take your enquiry right now. Please try again later." },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        await notifications.NotifyAdminsAsync(
            EnquiryRules.AdminMessage(form.FullName!, form.Town!, crops, form.CropsOther, form.BestTime!), ct);

        return Results.Ok(new { message = ThankYou });
    }
}
