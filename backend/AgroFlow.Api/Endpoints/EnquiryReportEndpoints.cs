using System.Globalization;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Reports;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// The "Enquiries & sales follow-up" report, PDF and Excel.
// GET /api/admin/reports/enquiries.pdf|.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD&province=..&handler=<profile id>
// Admin only. It reads no names, phone numbers or emails: it is about how the
// follow-up went, not who asked.
public static class EnquiryReportEndpoints
{
    private static readonly TimeSpan Sast = TimeSpan.FromHours(2);

    public static void MapEnquiryReportEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/reports").RequireAuthorization().AddEndpointFilter<AdminOnlyFilter>();
        admin.MapGet("/enquiries.pdf", (HttpRequest r, NpgsqlDataSource ds, CancellationToken ct) => BuildAsync(r, ds, pdf: true, ct));
        admin.MapGet("/enquiries.xlsx", (HttpRequest r, NpgsqlDataSource ds, CancellationToken ct) => BuildAsync(r, ds, pdf: false, ct));
    }

    /// The period and filters from the query string; null = a sentence saying what is wrong.
    public static (DateOnly From, DateOnly To, string? Province, Guid? Handler, string? Problem) ParseFilters(
        string? from, string? to, string? province, string? handler, DateOnly today)
    {
        var end = today;
        var start = today.AddDays(-29);
        if (!string.IsNullOrWhiteSpace(to) && !DateOnly.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out end))
            return (start, today, null, null, "The end date must be YYYY-MM-DD.");
        if (!string.IsNullOrWhiteSpace(from) && !DateOnly.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out start))
            return (start, end, null, null, "The start date must be YYYY-MM-DD.");
        if (string.IsNullOrWhiteSpace(from)) start = end.AddDays(-29);
        if (start > end) return (start, end, null, null, "The start date is after the end date.");
        if (end.DayNumber - start.DayNumber > 366) return (start, end, null, null, "Choose a period of a year or less.");

        var p = string.IsNullOrWhiteSpace(province) ? null : province.Trim();
        if (p != null && !EnquiryRules.Provinces.Contains(p)) return (start, end, null, null, "Choose a province from the list.");

        Guid? h = null;
        if (!string.IsNullOrWhiteSpace(handler))
        {
            if (!Guid.TryParse(handler, out var g)) return (start, end, p, null, "Choose an admin from the list.");
            h = g;
        }
        return (start, end, p, h, null);
    }

    private static async Task<IResult> BuildAsync(HttpRequest request, NpgsqlDataSource dataSource, bool pdf, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var today = DateOnly.FromDateTime(now.ToOffset(Sast).Date);
        var (from, to, province, handler, problem) = ParseFilters(
            request.Query["from"], request.Query["to"], request.Query["province"], request.Query["handler"], today);
        if (problem != null) return Results.BadRequest(new { error = problem });

        var enquiries = new List<EnquiryFact>();
        var calls = new List<EnquiryCallFact>();
        string? handlerName = null;

        await using var c = await dataSource.OpenConnectionAsync(ct);
        await using (var exists = new NpgsqlCommand("select to_regclass('public.enquiry_call') is not null", c))
        {
            if (await exists.ExecuteScalarAsync(ct) is not true)
                return Results.Conflict(new { error = EnquiryAdminEndpoints.NeedsMigration });
        }

        await using (var cmd = new NpgsqlCommand(
            """
            select e.id, e.created_at, e.province, e.status, e.outcome, e.reason, e.reason_other,
                   e.handled_by_profile_id, (select coalesce(nullif(p.name, ''), p.email) from profile p where p.id = e.handled_by_profile_id),
                   e.first_called_at, e.callback_at, e.no_answer_count, e.farmer_profile_id
              from enquiry e
            """, c))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                enquiries.Add(new EnquiryFact(
                    r.GetInt64(0), r.GetFieldValue<DateTimeOffset>(1), r.GetString(2), r.GetString(3),
                    r.IsDBNull(4) ? null : r.GetString(4), r.IsDBNull(5) ? null : r.GetString(5), r.IsDBNull(6) ? null : r.GetString(6),
                    r.IsDBNull(7) ? null : r.GetGuid(7), r.IsDBNull(8) ? null : r.GetString(8),
                    r.IsDBNull(9) ? null : r.GetFieldValue<DateTimeOffset>(9), r.IsDBNull(10) ? null : r.GetFieldValue<DateTimeOffset>(10),
                    r.GetInt32(11), r.IsDBNull(12) ? null : r.GetGuid(12)));
            }
        }

        await using (var cmd = new NpgsqlCommand("select enquiry_id, called_at, caller_name, outcome from enquiry_call", c))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
                calls.Add(new EnquiryCallFact(r.GetInt64(0), r.GetFieldValue<DateTimeOffset>(1), r.GetString(2), r.GetString(3)));
        }

        if (handler is { } hid)
        {
            await using var cmd = new NpgsqlCommand("select coalesce(nullif(name, ''), email) from profile where id = $1", c);
            cmd.Parameters.AddWithValue(hid);
            handlerName = await cmd.ExecuteScalarAsync(ct) as string;
        }

        var content = EnquiryReport.Compose(enquiries, calls, from, to, now, province, handler, handlerName);
        var stamp = $"{from:yyyy-MM-dd}_{to:yyyy-MM-dd}";
        return pdf
            ? Results.File(EnquiryReportPdf.Build(content, now.ToOffset(Sast)), "application/pdf", $"agroflow-enquiries-{stamp}.pdf")
            : Results.File(EnquiryReportPdf.Workbook(content),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"agroflow-enquiries-{stamp}.xlsx");
    }
}
