using System.Globalization;
using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

public sealed record HelpRequestBody(string? Topic, long? ZoneId, string? Note);
public sealed record TermsAcceptBody(string? TermsVersion, string? PrivacyVersion, bool? Accepted);
public sealed record AutoOfferBody(string? Answer);
public sealed record CaseUpdateBody(Guid? OwnerProfileId, string? NextAction, DateTimeOffset? FollowUpAt, bool? ServiceAgreed,
    string? ServiceStatus, string? Payer, string? PlanDescription, bool? ClearOwner, bool? ClearFollowUp);
public sealed record VisitBody(DateTimeOffset? ScheduledFor, string? InstallerName, Guid? InstallerProfileId, string? Kind, string? Notes);
public sealed record VisitStatusBody(string? Status);
public sealed record CheckBody(string? Provenance, string? ValueText, string? Notes, double? FlowRateLpm, int? MaxRunMinutes);
public sealed record ResolveHelpBody(string? Resolution);
public sealed record EnquiryLinkBody(Guid? FarmerProfileId, long? FarmId = null);

// The enquiry-to-installation journey (Part B; docs/audit/ui-contracts.md).
//
// Farmer (their own farm only, 404 otherwise):
//   GET  /api/farmer/farms/{farmId}/journey        setup progress, installation stage, "Where you are now"
//   POST /api/farmer/farms/{farmId}/tasks/{task}   finish one of the four tasks (checked against the saved data)
//   POST /api/farmer/farms/{farmId}/help           "I don't know - help me": a staff follow-up with an owner
//   POST /api/farmer/terms/accept                  record acceptance of the current terms and privacy versions
//   POST /api/farmer/zones/{zoneId}/automatic-offer  "Turn on automatic watering?" Yes / Keep manual
//   GET  /api/farmer/service                       Service & support for Settings
// Public: GET /api/public/legal, GET /api/public/legal/{key} (the draft documents).
// Staff (AdminOnlyFilter):
//   GET/PUT /api/admin/farms/{farmId}/case, POST /api/admin/farms/{farmId}/visits, PUT /api/admin/visits/{id},
//   POST /api/admin/zones/{zoneId}/checklist/{item}, POST /api/admin/help-requests/{id}/resolve,
//   POST /api/admin/enquiries/{id}/link, PUT /api/admin/zones/{zoneId}/mode
public static class JourneyEndpoints
{
    public static void MapJourneyEndpoints(this WebApplication app)
    {
        var farmer = app.MapGroup("/api/farmer").RequireAuthorization();
        farmer.MapGet("/farms/{farmId:long}/journey", GetJourneyAsync);
        farmer.MapPost("/farms/{farmId:long}/tasks/{task}", FinishTaskAsync);
        farmer.MapPost("/farms/{farmId:long}/help", AskForHelpAsync);
        farmer.MapPost("/terms/accept", AcceptTermsAsync);
        farmer.MapPost("/zones/{zoneId:long}/automatic-offer", AnswerAutoOfferAsync);
        farmer.MapGet("/service", GetServiceAsync);

        app.MapGet("/api/public/legal", (HttpRequest request) => Results.Ok(new
        {
            documents = LegalDocuments.All.Select(d => LegalDocuments.Describe(d, PublicBase(request))),
        })).AllowAnonymous();
        app.MapGet("/api/public/legal/{key}", (string key) => LegalDocuments.Find(key) is { } d
            ? Results.Text(LegalDocuments.Text(d), "text/markdown; charset=utf-8")
            : Results.NotFound(new { error = "No such document." })).AllowAnonymous();
        // The example price the public /service-pricing page shows: the same staff-edited
        // service.* settings as the farmer's Service & support, so the two never disagree.
        app.MapGet("/api/public/service-price", async (AppSettingsStore settings, CancellationToken ct) =>
            Results.Ok(await ServicePrice.ExampleAsync(settings, ct))).AllowAnonymous();

        var staff = app.MapGroup("/api/admin").RequireAuthorization().AddEndpointFilter<AdminOnlyFilter>();
        staff.MapGet("/farms/{farmId:long}/case", GetCaseAsync);
        staff.MapPut("/farms/{farmId:long}/case", UpdateCaseAsync);
        staff.MapPost("/farms/{farmId:long}/visits", BookVisitAsync);
        staff.MapPut("/visits/{visitId:long}", UpdateVisitAsync);
        staff.MapPost("/zones/{zoneId:long}/checklist/{item}", RecordCheckAsync);
        staff.MapPost("/help-requests/{id:long}/resolve", ResolveHelpAsync);
        staff.MapPost("/enquiries/{id:long}/link", LinkEnquiryAsync);
        staff.MapPut("/zones/{zoneId:long}/mode", StaffSetModeAsync);
    }

    private static string PublicBase(HttpRequest r) => $"{r.Scheme}://{r.Host}";

    private static bool TryUser(ClaimsPrincipal user, out Guid id) => Guid.TryParse(user.FindFirstValue("sub"), out id);

    // ---------------------------------------------------------------------------------------
    // Farmer
    // ---------------------------------------------------------------------------------------

    private static async Task<IResult> GetJourneyAsync(long farmId, ClaimsPrincipal user, NpgsqlDataSource dataSource, AppSettingsStore settings, HttpRequest request, INotificationService notifications, CancellationToken ct)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await JourneyStore.FarmerCanAccessFarmAsync(connection, farmId, userId, ct)) return Results.NotFound(new { error = "Farm not found." });
        if (!await JourneyStore.ReadyAsync(connection, ct)) return Results.Json(new { error = JourneyStore.NeedsMigration }, statusCode: StatusCodes.Status409Conflict);
        await JourneyStore.RefreshCommissioningAsync(connection, farmId, ct, notifications);
        return Results.Ok(await JourneyViewAsync(connection, farmId, userId, forStaff: false, request, await settings.TermsAcceptanceOpenAsync(ct), ct));
    }

    // The shape both the farmer's Home and the staff case read (docs/audit/ui-contracts.md).
    // termsOpen: staff have switched acceptance on and no document is a draft (RET-02). While it is
    // off the terms are a preview: shown, never asked for, never recorded.
    internal static async Task<object> JourneyViewAsync(NpgsqlConnection connection, long farmId, Guid? person, bool forStaff, HttpRequest request, bool termsOpen, CancellationToken ct)
    {
        var facts = await JourneyStore.FactsAsync(connection, farmId, person, termsOpen, ct);
        var view = Journey.Describe(facts);
        var zones = await JourneyStore.ZonesAsync(connection, farmId, ct);
        var tasks = await TasksAsync(connection, farmId, ct);
        var help = await HelpRequestsAsync(connection, farmId, ct);
        var termsAccepted = await AcceptedAsync(connection, person, ct);

        return new
        {
            farmId,
            setupProgress = new
            {
                done = tasks.Count,
                total = Journey.FarmerTaskCount,
                label = $"Your details: {tasks.Count} of {Journey.FarmerTaskCount}",
                tasks = Journey.FarmerTasks.Select(t => new
                {
                    key = t,
                    done = tasks.ContainsKey(t),
                    doneAt = tasks.TryGetValue(t, out var at) ? at : (DateTimeOffset?)null,
                }),
            },
            // RET-10: the account, the farmer's details and the installation are three separate things.
            account = new
            {
                status = Journey.AccountStatus(facts),
                label = Journey.AccountStatus(facts) switch
                {
                    Journey.AccountActiveStatus => "Account: active",
                    Journey.AccountNeedsPassword => "Account: choose your own password",
                    Journey.AccountNeedsTerms => "Account: accept the terms",
                    _ => "Account: not created yet",
                },
            },
            installation = new
            {
                status = Journey.InstallationStatus(view.Stage),
                stage = view.Stage,
                label = view.StageLabel,
                text = $"Installation: {InstallationText(Journey.InstallationStatus(view.Stage))}",
                live = view.Live,
            },
            whereYouAreNow = new
            {
                stage = view.Stage,
                stageLabel = view.StageLabel,
                stageNumber = view.StageNumber,
                stageCount = view.StageCount,
                steps = view.Steps.Select(s => new { key = s.Key, label = s.Label, done = s.Done }),
                done = view.Done,
                stillToDo = view.StillToDo,
                nextAction = view.NextAction,
                whoActsNext = view.WhoActsNext,
                whoActsNextLabel = view.WhoActsNext switch { Journey.You => "You", Journey.Installer => "Your installer", _ => "AgroFlow staff" },
                knownDate = view.KnownDate,
                dateLabel = view.DateLabel,
            },
            zones = zones.Select(z => new
            {
                zoneId = z.ZoneId,
                name = z.Name,
                commissionState = z.CommissionState,
                commissionedAt = z.CommissionedAt,
                irrigationMode = z.IrrigationMode,
                // Asked once, after commissioning: "Turn on automatic watering?" (Yes / Keep manual).
                offerAutomatic = Commissioning.OfferAutomatic(z.CommissionState, z.AutoOfferAnswer),
                autoOfferAnswer = z.AutoOfferAnswer,
                installerChecks = Commissioning.ChecklistItems.Select(i => CheckView(i, z, forStaff)),
            }),
            helpRequests = help,
            terms = new
            {
                // false: the documents are a preview ("not yet in effect"): no checkbox, nothing recorded.
                acceptanceEnabled = termsOpen,
                accepted = termsAccepted,
                documents = LegalDocuments.All.Select(d => LegalDocuments.Describe(d, PublicBase(request))),
            },
        };
    }

    private static string InstallationText(string status) => status switch
    {
        "waiting_for_booking" => "waiting for booking",
        "visit_booked" => "visit booked",
        "installing" => "installing",
        "commissioned" => "commissioned",
        _ => "not booked yet",
    };

    private static object CheckView(string item, JourneyStore.ZoneRow z, bool forStaff)
    {
        var row = z.Checks.LastOrDefault(k => k.Item == item);
        var done = Commissioning.Done(item, z.Facts);
        return new
        {
            item,
            label = Commissioning.Label(item),
            done,
            required = Commissioning.Required.Contains(item),
            // The farmer never edits these: "Your installer will complete this".
            whoCompletes = "installer",
            doneBy = row?.DoneByName,
            doneAt = row?.DoneAt,
            provenance = row?.Provenance ?? (done ? "from_kit" : null),
            value = item == Commissioning.RunLimit ? $"{z.MaxRunMinutes} min"
                : item == Commissioning.FlowMeasured && z.FlowRateLpm is { } lpm ? $"{lpm.ToString("0.##", CultureInfo.InvariantCulture)} L/min"
                : row?.ValueText,
            notes = forStaff ? row?.Notes : null,
        };
    }

    private static async Task<Dictionary<string, DateTimeOffset>> TasksAsync(NpgsqlConnection connection, long farmId, CancellationToken ct)
    {
        var done = new Dictionary<string, DateTimeOffset>();
        await using var cmd = new NpgsqlCommand("select task, min(done_at) from farmer_task where farm_id = $1 group by task", connection);
        cmd.Parameters.AddWithValue(farmId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) done[r.GetString(0)] = r.GetFieldValue<DateTimeOffset>(1);
        return done;
    }

    private static async Task<List<object>> HelpRequestsAsync(NpgsqlConnection connection, long farmId, CancellationToken ct)
    {
        var list = new List<object>();
        await using var cmd = new NpgsqlCommand("""
            select h.id, h.topic, h.zone_id, h.note, h.status, h.created_at, h.resolved_at, h.resolution, p.name
              from help_request h left join profile p on p.id = h.owner_profile_id
             where h.farm_id = $1 order by h.created_at desc limit 50
            """, connection);
        cmd.Parameters.AddWithValue(farmId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            list.Add(new
            {
                id = r.GetInt64(0),
                topic = r.GetString(1),
                zoneId = r.IsDBNull(2) ? (long?)null : r.GetInt64(2),
                note = r.IsDBNull(3) ? null : r.GetString(3),
                status = r.GetString(4),
                createdAt = r.GetFieldValue<DateTimeOffset>(5),
                resolvedAt = r.IsDBNull(6) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(6),
                resolution = r.IsDBNull(7) ? null : r.GetString(7),
                ownerName = r.IsDBNull(8) ? null : r.GetString(8),
            });
        }
        return list;
    }

    private static async Task<object> AcceptedAsync(NpgsqlConnection connection, Guid? person, CancellationToken ct)
    {
        var accepted = new Dictionary<string, DateTimeOffset>();
        if (person is { } who)
        {
            await using var cmd = new NpgsqlCommand(
                "select document, accepted_at from terms_acceptance where profile_id = $1 and ((document = 'terms' and version = $2) or (document = 'privacy' and version = $3))", connection);
            cmd.Parameters.AddWithValue(who);
            cmd.Parameters.AddWithValue(LegalDocuments.Terms.Version);
            cmd.Parameters.AddWithValue(LegalDocuments.Privacy.Version);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) accepted[r.GetString(0)] = r.GetFieldValue<DateTimeOffset>(1);
        }
        return new
        {
            all = accepted.ContainsKey("terms") && accepted.ContainsKey("privacy"),
            termsAcceptedAt = accepted.TryGetValue("terms", out var t) ? t : (DateTimeOffset?)null,
            privacyAcceptedAt = accepted.TryGetValue("privacy", out var p) ? p : (DateTimeOffset?)null,
        };
    }

    // A task is finished only when its saved data is there (or a help request covers the gap), so
    // "Your details: X of 4" is never just a button press.
    internal static async Task<string?> TaskProblemAsync(NpgsqlConnection connection, long farmId, Guid userId, string task, bool termsOpen, CancellationToken ct)
    {
        string sql = task switch
        {
            "preferences" => """
                select case
                  when coalesce((select must_change_password from profile where id = $2), true) then 'Choose your own password first.'
                  when $5 and (not exists (select 1 from terms_acceptance where profile_id = $2 and document = 'terms' and version = $3)
                    or not exists (select 1 from terms_acceptance where profile_id = $2 and document = 'privacy' and version = $4))
                    then 'Read and accept the terms and the privacy notice first.'
                  end
                """,
            "farm" => """
                select case when not exists (select 1 from farm where farm_id = $1 and latitude is not null)
                  and not exists (select 1 from help_request where farm_id = $1 and topic = 'location')
                  then 'Your farm has no location yet. Tap I don''t know - help me and AgroFlow staff will set it.' end
                """,
            "water" => """
                select case when not exists (select 1 from farm where farm_id = $1 and water_source is not null)
                  and not exists (select 1 from help_request where farm_id = $1 and topic = 'water_source')
                  then 'Choose where your water comes from, or tap I don''t know - help me.' end
                """,
            "crops" => """
                select case when exists (select 1 from zone z where z.farm_id = $1
                    and (z.crop_type is null or z.crop_type = '' or z.planting_date is null)
                    and not exists (select 1 from help_request h where h.farm_id = $1 and h.zone_id = z.id and h.topic in ('crop', 'planting_date')))
                  then 'Each field needs its crop and about when it was planted, or I don''t know - help me.' end
                """,
            _ => "select 'No such task.'",
        };
        await using var cmd = new NpgsqlCommand(sql, connection);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(LegalDocuments.Terms.Version);
        cmd.Parameters.AddWithValue(LegalDocuments.Privacy.Version);
        cmd.Parameters.AddWithValue(termsOpen);
        return await cmd.ExecuteScalarAsync(ct) as string;
    }

    private static async Task<IResult> FinishTaskAsync(long farmId, string task, ClaimsPrincipal user, NpgsqlDataSource dataSource, AppSettingsStore settings, HttpRequest request, CancellationToken ct)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        if (!Journey.FarmerTasks.Contains(task)) return Results.BadRequest(new { error = "The tasks are preferences, farm, water and crops." });
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await JourneyStore.FarmerCanAccessFarmAsync(connection, farmId, userId, ct)) return Results.NotFound(new { error = "Farm not found." });
        if (!await JourneyStore.ReadyAsync(connection, ct)) return Results.Json(new { error = JourneyStore.NeedsMigration }, statusCode: StatusCodes.Status409Conflict);
        var termsOpen = await settings.TermsAcceptanceOpenAsync(ct);
        if (await TaskProblemAsync(connection, farmId, userId, task, termsOpen, ct) is { } problem)
            return Results.BadRequest(new { error = problem, task });

        // Saying it twice is fine: the first time is kept.
        await using (var cmd = new NpgsqlCommand(
            "insert into farmer_task (profile_id, farm_id, task) values ($1, $2, $3) on conflict do nothing", connection))
        {
            cmd.Parameters.AddWithValue(userId);
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(task);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        return Results.Ok(await JourneyViewAsync(connection, farmId, userId, forStaff: false, request, termsOpen, ct));
    }

    public static readonly string[] HelpTopics =
        { "location", "water_source", "tank_capacity", "tank_level", "crop", "planting_date", "irrigation_type", "soil_type", "area", "other" };

    private static async Task<IResult> AskForHelpAsync(long farmId, HelpRequestBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        var topic = body.Topic?.Trim().ToLowerInvariant();
        if (topic is null || !HelpTopics.Contains(topic)) return Results.BadRequest(new { error = "Say what you need help with." });
        var note = body.Note?.Trim();
        if (note is { Length: > 500 }) return Results.BadRequest(new { error = "Keep the note under 500 characters." });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await JourneyStore.FarmerCanAccessFarmAsync(connection, farmId, userId, ct)) return Results.NotFound(new { error = "Farm not found." });
        if (!await JourneyStore.ReadyAsync(connection, ct)) return Results.Json(new { error = JourneyStore.NeedsMigration }, statusCode: StatusCodes.Status409Conflict);
        if (body.ZoneId is { } zoneId)
        {
            await using var zone = new NpgsqlCommand("select exists (select 1 from zone where id = $1 and farm_id = $2)", connection);
            zone.Parameters.AddWithValue(zoneId);
            zone.Parameters.AddWithValue(farmId);
            if (await zone.ExecuteScalarAsync(ct) is not true) return Results.NotFound(new { error = "Zone not found." });
        }

        var owner = await JourneyStore.HelpOwnerAsync(connection, farmId, ct);
        // Asking twice is the same request (one open request per farm, zone and topic).
        await using var cmd = new NpgsqlCommand("""
            insert into help_request (farm_id, zone_id, profile_id, topic, note, owner_profile_id)
            values ($1, $2, $3, $4, $5, $6)
            on conflict (farm_id, coalesce(zone_id, 0), topic) where status = 'open'
              do update set note = coalesce(excluded.note, help_request.note)
            returning id, (xmax = 0)
            """, connection);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)body.ZoneId ?? DBNull.Value);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(topic);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)(string.IsNullOrEmpty(note) ? null : note) ?? DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)owner ?? DBNull.Value);
        long id;
        bool created;
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            await r.ReadAsync(ct);
            id = r.GetInt64(0);
            created = r.GetBoolean(1);
        }
        if (created) await audit.WriteAsync(userId, "help_request.created", "help_request", id.ToString(), farmId, new { topic, zoneId = body.ZoneId }, ct);
        return Results.Ok(new
        {
            id,
            topic,
            status = "open",
            assigned = owner is not null,
            message = owner is not null
                ? "Sent. AgroFlow staff will help you with this; you can carry on."
                : "Sent. The AgroFlow team will pick this up and help you; you can carry on.",
        });
    }

    private static async Task<IResult> AcceptTermsAsync(TermsAcceptBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AppSettingsStore settings, AuditLog audit, CancellationToken ct)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        // RET-02: a preview (acceptance switched off, or a draft document) is never recorded.
        if (!await settings.TermsAcceptanceOpenAsync(ct))
            return Results.Conflict(new { error = "The terms and the privacy notice are a preview and not yet in effect, so there is nothing to accept yet.", preview = true });
        if (body.Accepted is not true) return Results.BadRequest(new { error = "Tick the box to accept the terms and the privacy notice." });
        // Only the current versions can be accepted: an older screen cannot record a version the
        // server no longer shows.
        if (body.TermsVersion != LegalDocuments.Terms.Version || body.PrivacyVersion != LegalDocuments.Privacy.Version)
            return Results.Conflict(new { error = "The terms have changed. Please read the current version.", termsVersion = LegalDocuments.Terms.Version, privacyVersion = LegalDocuments.Privacy.Version });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await JourneyStore.ReadyAsync(connection, ct)) return Results.Json(new { error = JourneyStore.NeedsMigration }, statusCode: StatusCodes.Status409Conflict);
        var at = new Dictionary<string, DateTimeOffset>();
        foreach (var d in LegalDocuments.All)
        {
            await using var cmd = new NpgsqlCommand("""
                insert into terms_acceptance (profile_id, document, version) values ($1, $2, $3)
                on conflict (profile_id, document, version) do update set version = excluded.version
                returning accepted_at
                """, connection);
            cmd.Parameters.AddWithValue(userId);
            cmd.Parameters.AddWithValue(d.Key);
            cmd.Parameters.AddWithValue(d.Version);
            // timestamptz comes back as a UTC DateTime from ExecuteScalar.
            at[d.Key] = new DateTimeOffset(DateTime.SpecifyKind((DateTime)(await cmd.ExecuteScalarAsync(ct))!, DateTimeKind.Utc));
        }
        await audit.WriteAsync(userId, "terms.accepted", "profile", userId.ToString(), null,
            new { terms = LegalDocuments.Terms.Version, privacy = LegalDocuments.Privacy.Version }, ct);
        return Results.Ok(new
        {
            accepted = true,
            termsVersion = LegalDocuments.Terms.Version,
            privacyVersion = LegalDocuments.Privacy.Version,
            termsAcceptedAt = at["terms"],
            privacyAcceptedAt = at["privacy"],
        });
    }

    private static async Task<IResult> AnswerAutoOfferAsync(long zoneId, AutoOfferBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        var answer = body.Answer?.Trim().ToLowerInvariant();
        if (answer is not ("automatic" or "manual")) return Results.BadRequest(new { error = "Answer automatic (Yes) or manual (Keep manual)." });
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (await JourneyStore.AnswerAutoOfferOnAccessibleZoneAsync(connection, userId, zoneId, answer, ct) is not { } answered)
            return Results.NotFound(new { error = "This zone is not commissioned yet, or is not yours." });
        var (farmId, mode, _) = answered;
        await audit.WriteAsync(userId, "zone.auto_offer_answered", "zone", zoneId.ToString(), farmId, new { answer }, ct);
        return Results.Ok(new { zoneId, answer, irrigationMode = mode });
    }

    private static async Task<IResult> GetServiceAsync(ClaimsPrincipal user, long? farmId, NpgsqlDataSource dataSource, AppSettingsStore settings, CancellationToken ct)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        long? farm = farmId;
        if (farm is null)
        {
            await using var pick = new NpgsqlCommand("""
                select f.farm_id from farm f where f.owner_id = $1 or exists (select 1 from farm_member m where m.farm_id = f.farm_id and m.profile_id = $1)
                order by case when f.owner_id = $1 then 0 else 1 end, f.farm_id limit 1
                """, connection);
            pick.Parameters.AddWithValue(userId);
            farm = await pick.ExecuteScalarAsync(ct) as long?;
        }
        if (farm is null || !await JourneyStore.FarmerCanAccessFarmAsync(connection, farm.Value, userId, ct))
            return Results.NotFound(new { error = "No farm is linked to this account yet." });

        var example = await ServicePrice.ExampleAsync(settings, ct);
        if (!await JourneyStore.ReadyAsync(connection, ct))
            return Results.Ok(new { farmId = farm, status = "not_agreed", statusLabel = ServicePrice.StatusLabel("not_agreed"), payer = (string?)null, planDescription = (string?)null, example, help = ServicePrice.Help });

        var c = await JourneyStore.CaseAsync(connection, farm.Value, ct);
        return Results.Ok(new
        {
            farmId = farm,
            status = c?.ServiceStatus ?? "not_agreed",
            statusLabel = ServicePrice.StatusLabel(c?.ServiceStatus ?? "not_agreed"),
            serviceAgreedAt = c?.ServiceAgreedAt,
            // Only what staff recorded; nothing is invented (no invoices, no balances).
            payer = c?.Payer,
            planDescription = c?.PlanDescription,
            contactName = c?.OwnerName,
            example,
            help = ServicePrice.Help,
            billing = "AgroFlow does not take payments in the app.",
        });
    }

    // ---------------------------------------------------------------------------------------
    // Staff
    // ---------------------------------------------------------------------------------------

    private static async Task<IResult> GetCaseAsync(long farmId, NpgsqlDataSource dataSource, AppSettingsStore settings, HttpRequest request, INotificationService notifications, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await JourneyStore.ReadyAsync(connection, ct)) return Results.Json(new { error = JourneyStore.NeedsMigration }, statusCode: StatusCodes.Status409Conflict);
        await JourneyStore.RefreshCommissioningAsync(connection, farmId, ct, notifications);
        var c = await JourneyStore.CaseAsync(connection, farmId, ct);
        if (c is null) return Results.NotFound(new { error = "No such farm." });
        var journey = await JourneyViewAsync(connection, farmId, c.FarmerId, forStaff: true, request, await settings.TermsAcceptanceOpenAsync(ct), ct);
        var visits = new List<object>();
        await using (var cmd = new NpgsqlCommand("""
            select id, kind, scheduled_for, installer_name, installer_profile_id, status, notes, created_at, started_at, completed_at
              from installation_visit where farm_id = $1 order by scheduled_for desc limit 20
            """, connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                visits.Add(new
                {
                    id = r.GetInt64(0), kind = r.GetString(1), scheduledFor = r.GetFieldValue<DateTimeOffset>(2),
                    installerName = r.GetString(3), installerProfileId = r.IsDBNull(4) ? (Guid?)null : r.GetGuid(4),
                    status = r.GetString(5), notes = r.IsDBNull(6) ? null : r.GetString(6),
                    createdAt = r.GetFieldValue<DateTimeOffset>(7),
                    startedAt = r.IsDBNull(8) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(8),
                    completedAt = r.IsDBNull(9) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(9),
                });
            }
        }
        return Results.Ok(new
        {
            caseId = c.Id,
            farmId = c.FarmId,
            farmName = c.FarmName,
            owner = c.OwnerId is null ? null : new { id = c.OwnerId, name = c.OwnerName },
            nextAction = c.NextAction,
            followUpAt = c.FollowUpAt,
            service = new { status = c.ServiceStatus, statusLabel = ServicePrice.StatusLabel(c.ServiceStatus), agreedAt = c.ServiceAgreedAt, payer = c.Payer, planDescription = c.PlanDescription },
            enquiry = c.EnquiryId is null ? null : new { id = c.EnquiryId, name = c.EnquiryName, status = c.EnquiryStatus },
            farmer = c.FarmerId is null ? null : new { id = c.FarmerId, name = c.FarmerName, passwordChanged = c.PasswordChanged },
            visits,
            journey,
        });
    }

    public static readonly string[] ServiceStatuses = { "not_agreed", "sponsored", "paying", "trial", "paused", "ended" };

    private static async Task<IResult> UpdateCaseAsync(long farmId, CaseUpdateBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AppSettingsStore settings, AuditLog audit, HttpRequest request, INotificationService notifications, CancellationToken ct)
    {
        if (body.NextAction is { Length: > 300 }) return Results.BadRequest(new { error = "Keep the next action under 300 characters." });
        if (body.ServiceStatus is { } st && !ServiceStatuses.Contains(st)) return Results.BadRequest(new { error = "Unknown service status." });
        if (body.Payer is { Length: > 120 } || body.PlanDescription is { Length: > 500 }) return Results.BadRequest(new { error = "That text is too long." });
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await JourneyStore.ReadyAsync(connection, ct)) return Results.Json(new { error = JourneyStore.NeedsMigration }, statusCode: StatusCodes.Status409Conflict);
        var caseId = await JourneyStore.EnsureCaseAsync(connection, farmId, ct);
        if (body.OwnerProfileId is { } owner)
        {
            await using var staff = new NpgsqlCommand("select role = 'admin' from profile where id = $1", connection);
            staff.Parameters.AddWithValue(owner);
            if (await staff.ExecuteScalarAsync(ct) is not true) return Results.BadRequest(new { error = "The owner must be an AgroFlow staff member." });
        }
        await using (var cmd = new NpgsqlCommand("""
            update service_case set
              owner_profile_id = case when $9 then null else coalesce($2, owner_profile_id) end,
              next_action = coalesce($3, next_action),
              follow_up_at = case when $10 then null else coalesce($4, follow_up_at) end,
              service_agreed_at = case when $5 is true then coalesce(service_agreed_at, now()) when $5 is false then null else service_agreed_at end,
              service_status = coalesce($6, service_status),
              payer = coalesce($7, payer),
              plan_description = coalesce($8, plan_description),
              updated_at = now()
             where id = $1
            """, connection))
        {
            cmd.Parameters.AddWithValue(caseId);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)body.OwnerProfileId ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)body.NextAction?.Trim() ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, (object?)body.FollowUpAt ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Boolean, (object?)body.ServiceAgreed ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)body.ServiceStatus ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)body.Payer?.Trim() ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)body.PlanDescription?.Trim() ?? DBNull.Value);
            cmd.Parameters.AddWithValue(body.ClearOwner == true);
            cmd.Parameters.AddWithValue(body.ClearFollowUp == true);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await audit.WriteAsync(user, "case.updated", "service_case", caseId.ToString(), farmId, body, ct);
        return await GetCaseAsync(farmId, dataSource, settings, request, notifications, ct);
    }

    private static async Task<IResult> BookVisitAsync(long farmId, VisitBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, HttpRequest request, CancellationToken ct)
    {
        TryUser(user, out var staffId);
        var installer = body.InstallerName?.Trim();
        if (body.ScheduledFor is null) return Results.BadRequest(new { error = "Choose the visit's date and time.", field = "scheduledFor" });
        if (installer is not { Length: >= 2 and <= 120 }) return Results.BadRequest(new { error = "Name the installer who will visit.", field = "installerName" });
        var kind = body.Kind ?? "first_installation";
        if (kind is not ("first_installation" or "follow_up" or "maintenance")) return Results.BadRequest(new { error = "Unknown kind of visit." });
        if (body.Notes is { Length: > 1000 }) return Results.BadRequest(new { error = "Keep the notes under 1000 characters." });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await JourneyStore.ReadyAsync(connection, ct)) return Results.Json(new { error = JourneyStore.NeedsMigration }, statusCode: StatusCodes.Status409Conflict);
        await using (var farm = new NpgsqlCommand("select exists (select 1 from farm where farm_id = $1)", connection))
        {
            farm.Parameters.AddWithValue(farmId);
            if (await farm.ExecuteScalarAsync(ct) is not true) return Results.NotFound(new { error = "No such farm." });
        }
        await JourneyStore.EnsureCaseAsync(connection, farmId, ct);
        // A first installation needs no device: the farm, a date and a named installer (AF-09).
        await using var cmd = new NpgsqlCommand("""
            insert into installation_visit (farm_id, kind, scheduled_for, installer_name, installer_profile_id, notes, created_by)
            values ($1, $2, $3, $4, $5, $6, $7) returning id
            """, connection);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(kind);
        cmd.Parameters.AddWithValue(body.ScheduledFor.Value);
        cmd.Parameters.AddWithValue(installer);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)body.InstallerProfileId ?? DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)body.Notes?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, staffId == Guid.Empty ? DBNull.Value : staffId);
        var id = (long)(await cmd.ExecuteScalarAsync(ct))!;
        await audit.WriteAsync(user, "visit.booked", "installation_visit", id.ToString(), farmId, new { kind, body.ScheduledFor, installer }, ct);
        return Results.Created($"/api/admin/visits/{id}", new { id, farmId, kind, scheduledFor = body.ScheduledFor, installerName = installer, status = "booked" });
    }

    private static async Task<IResult> UpdateVisitAsync(long visitId, VisitStatusBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        var status = body.Status?.Trim().ToLowerInvariant();
        if (status is not ("in_progress" or "done" or "cancelled")) return Results.BadRequest(new { error = "A visit can be started, finished or cancelled." });
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            update installation_visit set status = $2,
                   started_at = case when $2 = 'in_progress' then coalesce(started_at, now()) else started_at end,
                   completed_at = case when $2 = 'done' then now() else completed_at end,
                   cancelled_at = case when $2 = 'cancelled' then now() else cancelled_at end
             where id = $1 and status not in ('done', 'cancelled')
            returning farm_id
            """, connection);
        cmd.Parameters.AddWithValue(visitId);
        cmd.Parameters.AddWithValue(status);
        if (await cmd.ExecuteScalarAsync(ct) is not long farmId) return Results.NotFound(new { error = "No open visit with this id." });
        await audit.WriteAsync(user, "visit." + status, "installation_visit", visitId.ToString(), farmId, null, ct);
        return Results.Ok(new { id = visitId, status });
    }

    // The installer checklist. Each item records who, when and measured vs estimated. kit_linked and
    // calibration are only recorded once the data is really there (an active kit; both readings
    // from the kit); test_start_stop only when the kit acknowledged a start AND a stop on this zone
    // in the last hour, so it cannot be ticked without a real test.
    private static async Task<IResult> RecordCheckAsync(long zoneId, string item, CheckBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, INotificationService notifications, CancellationToken ct)
    {
        TryUser(user, out var staffId);
        if (!Commissioning.ChecklistItems.Contains(item)) return Results.BadRequest(new { error = "Unknown checklist item." });
        var provenance = body.Provenance?.Trim().ToLowerInvariant() ?? "confirmed";
        if (provenance is not ("measured" or "estimated" or "confirmed")) return Results.BadRequest(new { error = "Say whether it was measured, estimated or confirmed." });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await JourneyStore.ReadyAsync(connection, ct)) return Results.Json(new { error = JourneyStore.NeedsMigration }, statusCode: StatusCodes.Status409Conflict);
        long farmId;
        await using (var zone = new NpgsqlCommand("select farm_id from zone where id = $1", connection))
        {
            zone.Parameters.AddWithValue(zoneId);
            if (await zone.ExecuteScalarAsync(ct) is not long f) return Results.NotFound(new { error = "No such zone." });
            farmId = f;
        }
        var facts = (await JourneyStore.ZonesAsync(connection, farmId, ct)).First(z => z.ZoneId == zoneId);
        string? value = body.ValueText?.Trim();
        Guid[]? commands = null;

        switch (item)
        {
            case Commissioning.KitLinked when !facts.Facts.HasActiveKit:
                return Results.Conflict(new { error = "No kit is active on this zone yet. Register and claim the kit first." });
            case Commissioning.Calibration when !(facts.Facts.HasWetReading && facts.Facts.HasDryReading):
                return Results.Conflict(new { error = "Save the dry and the wet reading from the kit first." });
            case Commissioning.FlowMeasured:
                if (body.FlowRateLpm is not { } lpm || lpm <= 0 || lpm > ZoneSetupFields.MaxFlowRateLpm)
                    return Results.BadRequest(new { error = $"Enter the flow rate, 0.1 to {ZoneSetupFields.MaxFlowRateLpm} L/min.", field = "flowRateLpm" });
                await using (var save = new NpgsqlCommand("update zone set flow_rate_lpm = $2 where id = $1", connection))
                {
                    save.Parameters.AddWithValue(zoneId);
                    save.Parameters.AddWithValue(lpm);
                    await save.ExecuteNonQueryAsync(ct);
                }
                value = $"{lpm.ToString("0.##", CultureInfo.InvariantCulture)} L/min";
                break;
            case Commissioning.RunLimit:
                if (body.MaxRunMinutes is { } max)
                {
                    if (IrrigationRunRules.CheckMaxRunMinutes(max) is { } wrong) return Results.BadRequest(new { error = wrong, field = "maxRunMinutes" });
                    await using var save = new NpgsqlCommand("update zone set max_run_minutes = $2 where id = $1", connection);
                    save.Parameters.AddWithValue(zoneId);
                    save.Parameters.AddWithValue(max);
                    await save.ExecuteNonQueryAsync(ct);
                    value = $"{max} min";
                }
                else value = $"{facts.MaxRunMinutes} min";
                provenance = "confirmed";
                break;
            case Commissioning.TestStartStop:
            {
                await using var test = new NpgsqlCommand("""
                    select (select id from irrigation_commands where zone_id = $1 and command = 'start' and status = 'executed'
                              and created_at > now() - interval '1 hour' order by created_at desc limit 1),
                           (select id from irrigation_commands where zone_id = $1 and command = 'stop' and status = 'executed'
                              and created_at > now() - interval '1 hour' order by created_at desc limit 1)
                    """, connection);
                test.Parameters.AddWithValue(zoneId);
                await using var r = await test.ExecuteReaderAsync(ct);
                await r.ReadAsync(ct);
                if (r.IsDBNull(0) || r.IsDBNull(1))
                    return Results.Conflict(new { error = "No acknowledged test yet: press Water now for 1 minute, then Stop, and wait for the kit to confirm both." });
                commands = new[] { r.GetGuid(0), r.GetGuid(1) };
                provenance = "measured";
                value = "Start and stop acknowledged by the kit";
                break;
            }
        }

        var name = await StaffNameAsync(connection, staffId, ct);
        await using (var cmd = new NpgsqlCommand("""
            insert into installer_check (zone_id, item, provenance, value_text, notes, done_by, done_by_name, command_ids)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            on conflict (zone_id, item) do update set provenance = excluded.provenance, value_text = excluded.value_text,
              notes = excluded.notes, done_by = excluded.done_by, done_by_name = excluded.done_by_name, done_at = now(), command_ids = excluded.command_ids
            """, connection))
        {
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(item);
            cmd.Parameters.AddWithValue(provenance);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)value ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)body.Notes?.Trim() ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, staffId == Guid.Empty ? DBNull.Value : staffId);
            cmd.Parameters.AddWithValue(name);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Array | NpgsqlDbType.Uuid, (object?)commands ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        var commissioned = await JourneyStore.RefreshCommissioningAsync(connection, farmId, ct, notifications);
        await audit.WriteAsync(user, "checklist." + item, "zone", zoneId.ToString(), farmId, new { provenance, value }, ct);
        return Results.Ok(new { zoneId, item, provenance, value, doneBy = name, commissionedNow = commissioned });
    }

    private static async Task<string> StaffNameAsync(NpgsqlConnection connection, Guid staffId, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("select coalesce(nullif(name, ''), email) from profile where id = $1", connection);
        cmd.Parameters.AddWithValue(staffId);
        return await cmd.ExecuteScalarAsync(ct) as string ?? "AgroFlow staff";
    }

    private static async Task<IResult> ResolveHelpAsync(long id, ResolveHelpBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        TryUser(user, out var staffId);
        if (body.Resolution is { Length: > 500 }) return Results.BadRequest(new { error = "Keep it under 500 characters." });
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            update help_request set status = 'resolved', resolved_at = now(), resolved_by = $2, resolution = $3
             where id = $1 and status = 'open' returning farm_id
            """, connection);
        cmd.Parameters.AddWithValue(id);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, staffId == Guid.Empty ? DBNull.Value : staffId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)body.Resolution?.Trim() ?? DBNull.Value);
        if (await cmd.ExecuteScalarAsync(ct) is not long farmId) return Results.NotFound(new { error = "No open help request with this id." });
        await audit.WriteAsync(user, "help_request.resolved", "help_request", id.ToString(), farmId, new { body.Resolution }, ct);
        return Results.Ok(new { id, status = "resolved" });
    }

    // AF-24: an enquiry linked to a farmer who already exists (onboarded another way). The enquiry is
    // completed and put on the farmer's case. No call is logged: none happened.
    private static async Task<IResult> LinkEnquiryAsync(long id, EnquiryLinkBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (body.FarmerProfileId is not { } farmer) return Results.BadRequest(new { error = "Choose the farmer to link." });
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        long? farmId;
        await using (var who = new NpgsqlCommand("""
            select f.farm_id from profile p
              left join farm f on f.owner_id = p.id or exists (select 1 from farm_member m where m.farm_id = f.farm_id and m.profile_id = p.id)
             where p.id = $1 and p.role = 'farm_user' and ($2::bigint is null or f.farm_id = $2)
             order by f.farm_id limit 1
            """, connection))
        {
            who.Parameters.AddWithValue(farmer);
            who.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)body.FarmId ?? DBNull.Value);
            var v = await who.ExecuteScalarAsync(ct);
            if (v is null) return Results.BadRequest(new { error = "That account is not a farmer." });
            farmId = v as long?;
        }
        await using (var cmd = new NpgsqlCommand("""
            update enquiry set status = 'won', farmer_profile_id = $2, closed_at = coalesce(closed_at, now()), callback_at = null
             where id = $1 and (farmer_profile_id is null or farmer_profile_id = $2) returning id
            """, connection))
        {
            cmd.Parameters.AddWithValue(id);
            cmd.Parameters.AddWithValue(farmer);
            if (await cmd.ExecuteScalarAsync(ct) is null)
                return Results.Conflict(new { error = "This enquiry is already linked to another farmer, or no longer exists." });
        }
        if (farmId is { } f) await JourneyStore.LinkCaseAsync(connection, id, farmer, f, ct);
        await audit.WriteAsync(user, "enquiry.linked", "enquiry", id.ToString(), farmId, new { farmerProfileId = farmer }, ct);
        return Results.Ok(new { message = "The enquiry is linked to the farmer and closed. No call was logged.", farmId });
    }

    // Staff can switch any zone's watering mode, commissioned or not (decision).
    private static async Task<IResult> StaffSetModeAsync(long zoneId, AutoOfferBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        var mode = body.Answer?.Trim().ToLowerInvariant();
        if (mode is not ("automatic" or "scheduled" or "manual")) return Results.BadRequest(new { error = "The mode is automatic, scheduled or manual." });
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            update zone set irrigation_mode = $2, automation_enabled = ($2 = 'automatic'), schedule_enabled = ($2 = 'scheduled')
             where id = $1 returning farm_id
            """, connection);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(mode);
        if (await cmd.ExecuteScalarAsync(ct) is not long farmId) return Results.NotFound(new { error = "No such zone." });
        await audit.WriteAsync(user, "zone.mode_set", "zone", zoneId.ToString(), farmId, new { mode }, ct);
        return Results.Ok(new { zoneId, irrigationMode = mode });
    }
}

// The example service price (no billing; staff edit it in Settings).
public static class ServicePrice
{
    public static readonly object Help = new
    {
        inApp = "Open Help in the app, or tap I don't know - help me on any setup question.",
        telegram = "If you linked Telegram, message the AgroFlow bot.",
        staff = "AgroFlow staff will contact you about your installation and any open questions.",
    };

    public static string StatusLabel(string status) => status switch
    {
        "sponsored" => "Sponsored",
        "paying" => "Active (paid service)",
        "trial" => "Trial",
        "paused" => "Paused",
        "ended" => "Ended",
        _ => "Not agreed yet",
    };

    public static async Task<object> ExampleAsync(AppSettingsStore settings, CancellationToken ct)
    {
        var v = await settings.ServiceAsync(ct);
        return new
        {
            installationZar = v.InstallationZar,
            monthlyZar = v.MonthlyZar,
            zones = v.Zones,
            label = v.Label,
            text = $"R{v.InstallationZar.ToString("N0", CultureInfo.InvariantCulture).Replace(',', ' ')} installation (hardware included) and R{v.MonthlyZar.ToString("N0", CultureInfo.InvariantCulture).Replace(',', ' ')} a month: {v.Label}.",
        };
    }
}
