using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

// What was done, never who did it: the admin comes from the login.
public record EnquiryTakeOverBody(string? Reason);
public record EnquiryCallBody(string? Outcome, string? Reason, string? ReasonOther, string? Note, DateTimeOffset? CallbackAt);
public record EnquiryCloseBody(string? Note);
public record EnquiryOnboardedBody(Guid? FarmerProfileId);

// The admin side of public enquiries.
//
// [I'll handle this] -> [Log call] with an outcome:
//   wants          -> [Start onboarding]; finishing it links the farmer (won)
//   callback       -> a date and time; a reminder on Home when due
//   no_answer      -> counted; after 3 the console suggests closing
//   not_interested -> a reason is required (and words for Other); lost
// Every call is a row in the append-only enquiry_call, with the caller from the
// login. [Delete personal details] blanks name, phone, email and notes once an
// enquiry has ended (POPIA) but keeps province, crops, outcome and reason for
// statistics. Every step is audit-logged.
public static class EnquiryAdminEndpoints
{
    public const string NeedsMigration =
        "Enquiries need database migration 0044, which has not been applied yet.";

    public static void MapEnquiryAdminEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/enquiries")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapGet("", ListAsync);
        admin.MapGet("/summary", SummaryAsync);
        admin.MapGet("/{id:long}/calls", CallsAsync);
        admin.MapPost("/{id:long}/claim", ClaimAsync);
        admin.MapPost("/{id:long}/take-over", TakeOverAsync);
        admin.MapPost("/{id:long}/calls", LogCallAsync);
        admin.MapPost("/{id:long}/close", CloseAsync);
        admin.MapPost("/{id:long}/onboarded", OnboardedAsync);
        admin.MapPost("/{id:long}/anonymise", AnonymiseAsync);
    }

    /// What one logged call does to the enquiry. Pure, so it is tested.
    public sealed record CallEffect(string Status, int NoAnswerCount, DateTimeOffset? CallbackAt, bool SuggestClosing, string Message);

    public static CallEffect EffectOf(string outcome, int noAnswerBefore, DateTimeOffset? callbackAt)
    {
        return outcome switch
        {
            "wants" => new CallEffect("open", noAnswerBefore, null, false,
                "Logged. They want AgroFlow - start onboarding when you are ready."),
            "callback" => new CallEffect("open", noAnswerBefore, callbackAt, false,
                "Logged. A reminder will show on Home when the call-back is due."),
            "no_answer" => EnquiryRules.SuggestClosing(noAnswerBefore + 1)
                ? new CallEffect("open", noAnswerBefore + 1, null, true,
                    $"Logged. That is {noAnswerBefore + 1} calls with no answer - you may want to close it.")
                : new CallEffect("open", noAnswerBefore + 1, null, false,
                    $"Logged. No answer ({noAnswerBefore + 1} of {EnquiryRules.NoAnswerLimit})."),
            _ => new CallEffect("lost", noAnswerBefore, null, false, "Logged. The enquiry is closed as not interested."),
        };
    }

    /// Only an enquiry that has ended may lose its personal details.
    public static bool CanAnonymise(string status, DateTimeOffset? anonymisedAt) =>
        anonymisedAt is null && status is "lost" or "closed";

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid id) =>
        Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out id);

    private static async Task<bool> TableExistsAsync(NpgsqlConnection c, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("select to_regclass('public.enquiry_call') is not null", c);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    private static async Task<IResult> ListAsync(NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(c, ct)) return Results.Ok(Array.Empty<object>());

        await using var cmd = new NpgsqlCommand(
            """
            select e.id, e.full_name, e.phone, e.email, e.province, e.town, e.farm_size_ha, e.crops, e.crops_other,
                   e.best_time, e.notes, e.created_at, e.status, e.handled_by_profile_id,
                   (select coalesce(nullif(p.name, ''), p.email) from profile p where p.id = e.handled_by_profile_id),
                   e.claimed_at, e.callback_at, e.no_answer_count, e.outcome, e.reason, e.reason_other,
                   e.farmer_profile_id, e.anonymised_at, e.first_called_at, e.closed_at,
                   (select count(*) from enquiry_call k where k.enquiry_id = e.id)
              from enquiry e
             order by e.created_at desc
             limit 500
            """, c);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var rows = new List<object>();
        while (await r.ReadAsync(ct))
        {
            string? S(int i) => r.IsDBNull(i) ? null : r.GetString(i);
            DateTimeOffset? T(int i) => r.IsDBNull(i) ? null : r.GetFieldValue<DateTimeOffset>(i);
            rows.Add(new
            {
                id = r.GetInt64(0), fullName = S(1), phone = S(2), email = S(3), province = r.GetString(4), town = S(5),
                farmSizeHa = r.IsDBNull(6) ? (double?)null : Convert.ToDouble(r.GetValue(6)),
                crops = r.GetFieldValue<string[]>(7), cropsOther = S(8), bestTime = r.GetString(9), notes = S(10),
                createdAt = r.GetFieldValue<DateTimeOffset>(11), status = r.GetString(12),
                handledBy = r.IsDBNull(13) ? null : r.GetGuid(13).ToString(), handledByName = S(14), claimedAt = T(15),
                callbackAt = T(16), noAnswerCount = r.GetInt32(17), outcome = S(18), reason = S(19), reasonOther = S(20),
                farmerProfileId = r.IsDBNull(21) ? null : r.GetGuid(21).ToString(), anonymisedAt = T(22),
                firstCalledAt = T(23), closedAt = T(24), callCount = r.GetInt64(25),
            });
        }
        return Results.Ok(rows);
    }

    // For the sidebar badge and Home: new unclaimed enquiries and due call-backs.
    private static async Task<IResult> SummaryAsync(NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(c, ct)) return Results.Ok(new { waiting = 0, callbacksDue = 0 });
        await using var cmd = new NpgsqlCommand(
            """
            select count(*) filter (where status = 'new'),
                   count(*) filter (where status = 'open' and callback_at is not null and callback_at <= now())
              from enquiry
            """, c);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        await r.ReadAsync(ct);
        return Results.Ok(new { waiting = r.GetInt64(0), callbacksDue = r.GetInt64(1) });
    }

    private static async Task<IResult> CallsAsync(long id, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(c, ct)) return Results.Ok(Array.Empty<object>());
        await using var cmd = new NpgsqlCommand(
            "select called_at, caller_name, outcome, reason, reason_other, note, callback_at from enquiry_call where enquiry_id = $1 order by called_at",
            c);
        cmd.Parameters.AddWithValue(id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var rows = new List<object>();
        while (await r.ReadAsync(ct))
        {
            rows.Add(new
            {
                calledAt = r.GetFieldValue<DateTimeOffset>(0), callerName = r.GetString(1), outcome = r.GetString(2),
                reason = r.IsDBNull(3) ? null : r.GetString(3), reasonOther = r.IsDBNull(4) ? null : r.GetString(4),
                note = r.IsDBNull(5) ? null : r.GetString(5),
                callbackAt = r.IsDBNull(6) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(6),
            });
        }
        return Results.Ok(rows);
    }

    private sealed record Current(Guid? Handler, string Status, int NoAnswerCount, DateTimeOffset? AnonymisedAt);

    private static async Task<Current?> ReadAsync(NpgsqlConnection c, long id, CancellationToken ct, NpgsqlTransaction? tx = null)
    {
        await using var cmd = new NpgsqlCommand(
            "select handled_by_profile_id, status, no_answer_count, anonymised_at from enquiry where id = $1 for update", c, tx);
        cmd.Parameters.AddWithValue(id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        return new Current(r.IsDBNull(0) ? null : r.GetGuid(0), r.GetString(1), r.GetInt32(2),
            r.IsDBNull(3) ? null : r.GetFieldValue<DateTimeOffset>(3));
    }

    private static IResult NotHandler() =>
        Results.Json(new { error = "Take this enquiry on first (I'll handle this), or take it over." }, statusCode: StatusCodes.Status403Forbidden);

    private static async Task<IResult> ClaimAsync(long id, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var me)) return Results.Unauthorized();
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(c, ct)) return Results.Conflict(new { error = NeedsMigration });
        var e = await ReadAsync(c, id, ct);
        if (e is null) return Results.NotFound(new { error = "No such enquiry." });

        switch (HandlingRules.Claim(e.Handler, me))
        {
            case HandlingOutcome.AlreadyYours: return Results.Ok(new { message = "You are already handling this." });
            case HandlingOutcome.HeldByOther: return Results.Conflict(new { error = "Someone else is handling this. Use Take over, with a reason." });
        }

        await using (var cmd = new NpgsqlCommand(
            "update enquiry set handled_by_profile_id = $2, claimed_at = now(), status = case when status = 'new' then 'open' else status end where id = $1", c))
        {
            cmd.Parameters.AddWithValue(id);
            cmd.Parameters.AddWithValue(me);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await audit.WriteAsync(user, "enquiry.claimed", "enquiry", id.ToString(), cancellationToken: ct);
        return Results.Ok(new { message = "It is yours. Log each call you make." });
    }

    private static async Task<IResult> TakeOverAsync(long id, EnquiryTakeOverBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var me)) return Results.Unauthorized();
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(c, ct)) return Results.Conflict(new { error = NeedsMigration });
        var e = await ReadAsync(c, id, ct);
        if (e is null) return Results.NotFound(new { error = "No such enquiry." });

        switch (HandlingRules.TakeOver(e.Handler, me, body.Reason))
        {
            case HandlingOutcome.ReasonRequired: return Results.BadRequest(new { error = "Say why you are taking this over." });
            case HandlingOutcome.NothingToTakeOver: return Results.BadRequest(new { error = "Nobody has this yet - use I'll handle this." });
            case HandlingOutcome.AlreadyYours: return Results.Ok(new { message = "You are already handling this." });
        }

        await using (var cmd = new NpgsqlCommand("update enquiry set handled_by_profile_id = $2, claimed_at = now() where id = $1", c))
        {
            cmd.Parameters.AddWithValue(id);
            cmd.Parameters.AddWithValue(me);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await audit.WriteAsync(user, "enquiry.taken_over", "enquiry", id.ToString(),
            details: new { previousHandler = e.Handler, reason = body.Reason!.Trim() }, cancellationToken: ct);
        return Results.Ok(new { message = "Taken over. Your reason is on the record." });
    }

    private static async Task<IResult> LogCallAsync(long id, EnquiryCallBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var me)) return Results.Unauthorized();
        if (EnquiryRules.CheckCall(body.Outcome, body.Reason, body.ReasonOther, body.CallbackAt, DateTimeOffset.UtcNow) is { } problem)
            return Results.BadRequest(new { error = problem });

        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(c, ct)) return Results.Conflict(new { error = NeedsMigration });
        await using var tx = await c.BeginTransactionAsync(ct);
        var e = await ReadAsync(c, id, ct, tx);
        if (e is null) return Results.NotFound(new { error = "No such enquiry." });
        if (e.Handler != me) return NotHandler();
        if (e.Status is "won" or "lost" or "closed") return Results.BadRequest(new { error = "This enquiry has ended." });

        var effect = EffectOf(body.Outcome!, e.NoAnswerCount, body.CallbackAt);
        var notInterested = body.Outcome == "not_interested";

        await using (var cmd = new NpgsqlCommand(
            """
            insert into enquiry_call (enquiry_id, caller_profile_id, caller_name, outcome, reason, reason_other, note, callback_at)
            values ($1, $2, coalesce((select coalesce(nullif(name, ''), email) from profile where id = $2), 'Unknown'), $3, $4, $5, $6, $7)
            """, c, tx))
        {
            cmd.Parameters.AddWithValue(id);
            cmd.Parameters.AddWithValue(me);
            cmd.Parameters.AddWithValue(body.Outcome!);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, notInterested ? body.Reason! : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, notInterested && body.Reason == "other" ? body.ReasonOther!.Trim() : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, string.IsNullOrWhiteSpace(body.Note) ? DBNull.Value : body.Note.Trim());
            cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, effect.CallbackAt is { } cb ? cb.ToUniversalTime() : DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        await using (var cmd = new NpgsqlCommand(
            """
            update enquiry
               set status = $2, no_answer_count = $3, callback_at = $4, outcome = $5,
                   reason = coalesce($6, reason), reason_other = coalesce($7, reason_other),
                   first_called_at = coalesce(first_called_at, now()),
                   closed_at = case when $2 = 'lost' then now() else closed_at end
             where id = $1
            """, c, tx))
        {
            cmd.Parameters.AddWithValue(id);
            cmd.Parameters.AddWithValue(effect.Status);
            cmd.Parameters.AddWithValue(effect.NoAnswerCount);
            cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, effect.CallbackAt is { } cb ? cb.ToUniversalTime() : DBNull.Value);
            cmd.Parameters.AddWithValue(body.Outcome!);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, notInterested ? body.Reason! : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, notInterested && body.Reason == "other" ? body.ReasonOther!.Trim() : DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);

        await audit.WriteAsync(user, "enquiry.call_logged", "enquiry", id.ToString(),
            details: new { outcome = body.Outcome, reason = body.Reason, note = body.Note }, cancellationToken: ct);
        return Results.Ok(new { message = effect.Message, suggestClosing = effect.SuggestClosing });
    }

    private static async Task<IResult> CloseAsync(long id, EnquiryCloseBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var me)) return Results.Unauthorized();
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(c, ct)) return Results.Conflict(new { error = NeedsMigration });
        var e = await ReadAsync(c, id, ct);
        if (e is null) return Results.NotFound(new { error = "No such enquiry." });
        if (e.Handler != me) return NotHandler();

        await using (var cmd = new NpgsqlCommand("update enquiry set status = 'closed', closed_at = now(), callback_at = null where id = $1", c))
        {
            cmd.Parameters.AddWithValue(id);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await audit.WriteAsync(user, "enquiry.closed", "enquiry", id.ToString(), details: new { note = body.Note }, cancellationToken: ct);
        return Results.Ok(new { message = "Closed." });
    }

    // Called by the onboarding wizard when it finishes for this enquiry.
    private static async Task<IResult> OnboardedAsync(long id, EnquiryOnboardedBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!TryGetUserId(user, out _)) return Results.Unauthorized();
        if (body.FarmerProfileId is null) return Results.BadRequest(new { error = "Which farmer was onboarded?" });
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(c, ct)) return Results.Conflict(new { error = NeedsMigration });

        await using (var cmd = new NpgsqlCommand(
            "update enquiry set status = 'won', farmer_profile_id = $2, outcome = 'wants', closed_at = now(), callback_at = null where id = $1 returning id", c))
        {
            cmd.Parameters.AddWithValue(id);
            cmd.Parameters.AddWithValue(body.FarmerProfileId.Value);
            if (await cmd.ExecuteScalarAsync(ct) is null) return Results.NotFound(new { error = "No such enquiry." });
        }
        await audit.WriteAsync(user, "enquiry.onboarded", "enquiry", id.ToString(),
            details: new { farmerProfileId = body.FarmerProfileId }, cancellationToken: ct);
        return Results.Ok(new { message = "The enquiry is complete and linked to the new farmer." });
    }

    private static async Task<IResult> AnonymiseAsync(long id, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!TryGetUserId(user, out _)) return Results.Unauthorized();
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(c, ct)) return Results.Conflict(new { error = NeedsMigration });
        var e = await ReadAsync(c, id, ct);
        if (e is null) return Results.NotFound(new { error = "No such enquiry." });
        if (!CanAnonymise(e.Status, e.AnonymisedAt))
            return Results.BadRequest(new { error = "Only an enquiry that has ended can have its personal details deleted." });

        foreach (var sql in new[]
        {
            "update enquiry set full_name = null, phone = null, email = null, notes = null, anonymised_at = now() where id = $1",
            // A call note can name the person too. This is the only change a call row ever
            // gets; who called, when, the outcome and reason stay.
            "update enquiry_call set note = null where enquiry_id = $1",
        })
        {
            await using var cmd = new NpgsqlCommand(sql, c);
            cmd.Parameters.AddWithValue(id);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await audit.WriteAsync(user, "enquiry.anonymised", "enquiry", id.ToString(), cancellationToken: ct);
        return Results.Ok(new { message = "Personal details deleted. Province, crops, outcome and reason are kept for the statistics." });
    }
}
