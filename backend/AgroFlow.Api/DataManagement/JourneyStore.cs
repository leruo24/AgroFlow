using AgroFlow.Business;
using Npgsql;
using AgroFlow.Api.Services.Notifications;
using NpgsqlTypes;

namespace AgroFlow.Api.Services;

// Reads and writes the journey (migration 0058): the case, visits, installer checklist, farmer
// tasks, help requests and terms acceptance, and works out the facts Journey and Commissioning
// describe. Static helpers on a caller's connection, the way ZoneRunLimit is used.
public static class JourneyStore
{
    public static async Task<bool> ReadyAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("select to_regclass('public.service_case') is not null", connection);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    public const string NeedsMigration = "This needs database migration 0058, which has not been applied yet.";

    // The case for a farm, made on first use (one per farm). Returns its id.
    public static async Task<long> EnsureCaseAsync(NpgsqlConnection connection, long farmId, CancellationToken ct)
    {
        await using (var find = new NpgsqlCommand("select id from service_case where farm_id = $1", connection))
        {
            find.Parameters.AddWithValue(farmId);
            if (await find.ExecuteScalarAsync(ct) is long id) return id;
        }
        await using var insert = new NpgsqlCommand("""
            insert into service_case (farm_id, farmer_profile_id, enquiry_id)
            select f.farm_id, f.owner_id,
                   (select e.id from enquiry e where e.farmer_profile_id = f.owner_id and f.owner_id is not null
                      and not exists (select 1 from service_case c where c.enquiry_id = e.id)
                    order by e.created_at desc limit 1)
              from farm f where f.farm_id = $1
            on conflict (farm_id) where farm_id is not null do update set updated_at = service_case.updated_at
            returning id
            """, connection);
        insert.Parameters.AddWithValue(farmId);
        return (long)(await insert.ExecuteScalarAsync(ct))!;
    }

    // AF-24: an enquiry and the farmer it became, on the farm's case. Once only: an enquiry already
    // on another case is left where it is.
    public static async Task LinkCaseAsync(NpgsqlConnection connection, long enquiryId, Guid profileId, long farmId, CancellationToken ct)
    {
        if (!await ReadyAsync(connection, ct)) return;
        var caseId = await EnsureCaseAsync(connection, farmId, ct);
        await using var cmd = new NpgsqlCommand("""
            update service_case set enquiry_id = coalesce(enquiry_id, $2), farmer_profile_id = coalesce(farmer_profile_id, $3), updated_at = now()
             where id = $1 and not exists (select 1 from service_case o where o.enquiry_id = $2 and o.id <> $1)
            """, connection);
        cmd.Parameters.AddWithValue(caseId);
        cmd.Parameters.AddWithValue(enquiryId);
        cmd.Parameters.AddWithValue(profileId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public sealed record ZoneRow(
        long ZoneId, string Name, string CommissionState, DateTimeOffset? CommissionedAt, string? AutoOfferAnswer,
        string IrrigationMode, int MaxRunMinutes, double? FlowRateLpm, Commissioning.ZoneFacts Facts,
        IReadOnlyList<CheckRow> Checks);

    public sealed record CheckRow(string Item, string Provenance, string? ValueText, string? Notes, string DoneByName, DateTimeOffset DoneAt);

    public static async Task<List<ZoneRow>> ZonesAsync(NpgsqlConnection connection, long farmId, CancellationToken ct)
    {
        var checks = new Dictionary<long, List<CheckRow>>();
        await using (var c = new NpgsqlCommand("""
            select k.zone_id, k.item, k.provenance, k.value_text, k.notes, k.done_by_name, k.done_at
              from installer_check k join zone z on z.id = k.zone_id where z.farm_id = $1 order by k.done_at
            """, connection))
        {
            c.Parameters.AddWithValue(farmId);
            await using var r = await c.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var list = checks.TryGetValue(r.GetInt64(0), out var l) ? l : checks[r.GetInt64(0)] = new List<CheckRow>();
                list.Add(new CheckRow(r.GetString(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3),
                    r.IsDBNull(4) ? null : r.GetString(4), r.GetString(5), r.GetFieldValue<DateTimeOffset>(6)));
            }
        }

        var zones = new List<ZoneRow>();
        await using var cmd = new NpgsqlCommand("""
            select z.id, z.name, z.commission_state, z.commissioned_at, z.auto_offer_answer, z.irrigation_mode,
                   z.max_run_minutes, z.flow_rate_lpm, z.calibration_wet is not null, z.calibration_dry is not null,
                   exists (select 1 from hardware h where h.zone_id = z.id and h.enrollment_status = 'active' and h.device_id is not null)
              from zone z where z.farm_id = $1 order by z.id
            """, connection);
        cmd.Parameters.AddWithValue(farmId);
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                var id = r.GetInt64(0);
                var own = checks.TryGetValue(id, out var l) ? l : new List<CheckRow>();
                var facts = new Commissioning.ZoneFacts(
                    HasActiveKit: r.GetBoolean(10),
                    HasWetReading: r.GetBoolean(8),
                    HasDryReading: r.GetBoolean(9),
                    FlowRecordedAsMeasured: own.Any(k => k.Item == Commissioning.FlowMeasured && k.Provenance == "measured"),
                    RunLimitConfirmed: own.Any(k => k.Item == Commissioning.RunLimit),
                    TestAcknowledged: own.Any(k => k.Item == Commissioning.TestStartStop));
                zones.Add(new ZoneRow(id, r.IsDBNull(1) ? $"Zone {id}" : r.GetString(1), r.GetString(2),
                    r.IsDBNull(3) ? null : r.GetFieldValue<DateTimeOffset>(3), r.IsDBNull(4) ? null : r.GetString(4),
                    r.IsDBNull(5) ? "manual" : r.GetString(5), IrrigationRunRules.ZoneMaxOrDefault(r.IsDBNull(6) ? null : r.GetInt32(6)),
                    r.IsDBNull(7) ? null : Convert.ToDouble(r.GetValue(7)), facts, own));
            }
        }
        return zones;
    }

    // A pending zone whose four checks are done becomes commissioned (once). Legacy zones are left
    // alone. Returns true when it changed. With notifications, each farmer hears "Your kit in
    // <zone> is working" on Telegram, once, from whichever path finished the checks.
    public static async Task<bool> RefreshCommissioningAsync(NpgsqlConnection connection, long farmId, CancellationToken ct,
        INotificationService? notifications = null)
    {
        var commissioned = new List<long>();
        foreach (var z in await ZonesAsync(connection, farmId, ct))
        {
            if (z.CommissionState != "pending" || !Commissioning.IsCommissioned(z.Facts)) continue;
            await using var cmd = new NpgsqlCommand(
                "update zone set commission_state = 'commissioned', commissioned_at = now() where id = $1 and commission_state = 'pending'", connection);
            cmd.Parameters.AddWithValue(z.ZoneId);
            if (await cmd.ExecuteNonQueryAsync(ct) > 0) commissioned.Add(z.ZoneId);
        }
        if (notifications is not null)
            foreach (var zoneId in commissioned) await notifications.NotifyKitWorkingAsync(zoneId, ct);
        return commissioned.Count > 0;
    }

    // The farmer's answer to "Turn on automatic watering?", from the app or the Telegram button.
    // Null when the zone is not commissioned yet or is not on one of the farmer's farms.
    public static async Task<(long FarmId, string Mode, string ZoneName)?> AnswerAutoOfferOnAccessibleZoneAsync(
        NpgsqlConnection connection, Guid profileId, long zoneId, string answer, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("""
            update zone z set auto_offer_answer = $3, auto_offer_answered_at = now(),
                   irrigation_mode = case when $3 = 'automatic' then 'automatic' else z.irrigation_mode end,
                   automation_enabled = case when $3 = 'automatic' then true else z.automation_enabled end
             where z.id = $2 and z.commission_state = 'commissioned'
               and (exists (select 1 from farm f where f.farm_id = z.farm_id and f.owner_id = $1)
                    or exists (select 1 from farm_member m where m.farm_id = z.farm_id and m.profile_id = $1))
            returning z.farm_id, z.irrigation_mode, coalesce(nullif(z.name, ''), 'your zone')
            """, connection);
        cmd.Parameters.AddWithValue(profileId);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(answer);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? (r.GetInt64(0), r.GetString(1), r.GetString(2)) : null;
    }

    public sealed record CaseRow(long Id, long FarmId, string FarmName, Guid? OwnerId, string? OwnerName, string? NextAction,
        DateTimeOffset? FollowUpAt, DateTimeOffset? ServiceAgreedAt, string ServiceStatus, string? Payer, string? PlanDescription,
        long? EnquiryId, string? EnquiryName, string? EnquiryStatus, Guid? FarmerId, string? FarmerName, bool PasswordChanged);

    public static async Task<CaseRow?> CaseAsync(NpgsqlConnection connection, long farmId, CancellationToken ct)
    {
        await EnsureCaseAsync(connection, farmId, ct);
        await using var cmd = new NpgsqlCommand("""
            select c.id, f.farm_id, f.name, c.owner_profile_id, op.name, c.next_action, c.follow_up_at, c.service_agreed_at,
                   c.service_status, c.payer, c.plan_description, c.enquiry_id, e.full_name, e.status,
                   coalesce(c.farmer_profile_id, f.owner_id), fp.name, not coalesce(fp.must_change_password, true)
              from service_case c
              join farm f on f.farm_id = c.farm_id
              left join profile op on op.id = c.owner_profile_id
              left join enquiry e on e.id = c.enquiry_id
              left join profile fp on fp.id = coalesce(c.farmer_profile_id, f.owner_id)
             where c.farm_id = $1
            """, connection);
        cmd.Parameters.AddWithValue(farmId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        DateTimeOffset? Ts(int i) => r.IsDBNull(i) ? null : r.GetFieldValue<DateTimeOffset>(i);
        string? S(int i) => r.IsDBNull(i) ? null : r.GetString(i);
        return new CaseRow(r.GetInt64(0), r.GetInt64(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetGuid(3), S(4), S(5), Ts(6), Ts(7),
            r.GetString(8), S(9), S(10), r.IsDBNull(11) ? null : r.GetInt64(11), S(12), S(13),
            r.IsDBNull(14) ? null : r.GetGuid(14), S(15), !r.IsDBNull(16) && r.GetBoolean(16));
    }

    // Everything Journey.Describe needs for one farm. person: whose terms and tasks count (the
    // farmer looking, or the farm's owner for staff).
    public static async Task<Journey.Facts> FactsAsync(NpgsqlConnection connection, long farmId, Guid? person, bool termsRequired, CancellationToken ct)
    {
        var c = await CaseAsync(connection, farmId, ct);
        var zones = await ZonesAsync(connection, farmId, ct);
        var who = person ?? c?.FarmerId;

        await using var cmd = new NpgsqlCommand("""
            select
              (select count(distinct t.task) from farmer_task t where t.farm_id = $1)::int,
              (select count(*) from help_request h where h.farm_id = $1 and h.status = 'open')::int,
              (select v.scheduled_for from installation_visit v where v.farm_id = $1 and v.status = 'booked' order by v.scheduled_for limit 1),
              (select v.installer_name from installation_visit v where v.farm_id = $1 and v.status = 'booked' order by v.scheduled_for limit 1),
              exists (select 1 from installation_visit v where v.farm_id = $1 and v.status = 'in_progress'),
              exists (select 1 from terms_acceptance a where a.profile_id = $2 and a.document = 'terms' and a.version = $3)
                and exists (select 1 from terms_acceptance a where a.profile_id = $2 and a.document = 'privacy' and a.version = $4),
              not coalesce((select p.must_change_password from profile p where p.id = $2), true)
            """, connection);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)who ?? DBNull.Value);
        cmd.Parameters.AddWithValue(LegalDocuments.Terms.Version);
        cmd.Parameters.AddWithValue(LegalDocuments.Privacy.Version);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        await r.ReadAsync(ct);

        var tracked = zones.Where(z => z.CommissionState != "legacy").ToList();
        var checklistTotal = tracked.Count * Commissioning.ChecklistItems.Count;
        var checklistDone = tracked.Sum(z => Commissioning.ChecklistItems.Count(i => Commissioning.Done(i, z.Facts)));

        return new Journey.Facts(
            HasEnquiry: c?.EnquiryId is not null,
            HasFarm: true,
            HasFarmerAccount: who is not null,
            ServiceAgreed: c?.ServiceAgreedAt is not null,
            PasswordChanged: !r.IsDBNull(6) && r.GetBoolean(6),
            TermsAccepted: !r.IsDBNull(5) && r.GetBoolean(5),
            FarmerTasksDone: r.GetInt32(0),
            OpenHelpRequests: r.GetInt32(1),
            NextVisitAt: r.IsDBNull(2) ? null : r.GetFieldValue<DateTimeOffset>(2),
            NextVisitInstaller: r.IsDBNull(3) ? null : r.GetString(3),
            VisitInProgress: r.GetBoolean(4),
            ZonesTotal: zones.Count,
            ZonesCommissioned: zones.Count(z => z.CommissionState == "commissioned"),
            ZonesLegacy: zones.Count(z => z.CommissionState == "legacy"),
            ActiveKits: zones.Count(z => z.Facts.HasActiveKit),
            // A checklist only exists for zones commissioned through the journey.
            ChecklistDone: checklistDone,
            ChecklistTotal: checklistTotal,
            OwnerName: c?.OwnerName,
            TermsRequired: termsRequired);
    }

    // Who a "help me" goes to: the case owner, else the staff member who onboarded the farm.
    public static async Task<Guid?> HelpOwnerAsync(NpgsqlConnection connection, long farmId, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("""
            select coalesce(
              (select c.owner_profile_id from service_case c where c.farm_id = $1),
              (select o.created_by from onboarding_request o where o.farm_id = $1 order by o.created_at desc limit 1))
            """, connection);
        cmd.Parameters.AddWithValue(farmId);
        return await cmd.ExecuteScalarAsync(ct) as Guid?;
    }

    public static async Task<bool> FarmerCanAccessFarmAsync(NpgsqlConnection connection, long farmId, Guid userId, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("""
            select exists (select 1 from farm f where f.farm_id = $1 and (f.owner_id = $2
                   or exists (select 1 from farm_member m where m.farm_id = f.farm_id and m.profile_id = $2)))
            """, connection);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(userId);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }
}
