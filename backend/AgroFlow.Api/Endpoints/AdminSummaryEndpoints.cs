using System.Globalization;
using AgroFlow.Api.Auth;
using System.Security.Claims;
using Npgsql;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace AgroFlow.Api.Endpoints;

/// The platform summary as a PDF.
/// Built on the server (unlike the browser-built .xlsx) because a PDF gets printed
/// and filed, so it carries its own figures, timestamp and author.
/// All reads; the counts are done in SQL, so 300 farms is still one query.
public static class AdminSummaryEndpoints
{
    /// SAST (UTC+2, no daylight saving): every date on the page uses it.
    private static readonly TimeSpan Sast = TimeSpan.FromHours(2);

    public static void MapAdminSummaryEndpoints(this WebApplication app)
    {
        // Security: AdminOnlyFilter, not just RequireAuthorization, because farmers have
        // valid tokens too and this lists every farm with its owner.
        app.MapGet("/api/admin/summary.pdf", GetSummaryPdfAsync)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();
    }

    private sealed record SummaryCounts(
        long Farms,
        long ArchivedFarms,
        long Farmers,
        long FarmersWithoutTelegram,
        long Zones,
        long Kits,
        long KitsOnline,
        long OpenAlerts,
        long PendingRequests);

    private sealed record FarmLine(
        string Name, string Owner, string Location, long Zones, long Kits, string Status);

    private sealed record RequestLine(
        string Farmer, string Type, string Location, string Status, DateTimeOffset Submitted,
        string? AssignedTo);

    private static async Task<IResult> GetSummaryPdfAsync(
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.Endpoints.AdminSummaryEndpoints");

        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

            var generatedBy = await ResolveActorNameAsync(connection, user, cancellationToken);
            var counts = await ReadCountsAsync(connection, cancellationToken);
            var farms = await ReadFarmsAsync(connection, cancellationToken);
            var requests = await ReadPendingRequestsAsync(connection, cancellationToken);

            var generated = DateTimeOffset.UtcNow.ToOffset(Sast);

            var bytes = Document.Create(container => container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(36);
                page.DefaultTextStyle(t => t.FontSize(10));

                page.Header().Column(col =>
                {
                    col.Item().Text("AgroFlow platform summary").FontSize(18).SemiBold();
                    col.Item().Text($"Generated {generated:dd MMM yyyy, HH:mm} (SAST)")
                        .FontColor(Colors.Grey.Darken1);
                    col.Item().Text($"By {generatedBy}").FontColor(Colors.Grey.Darken1);
                });

                page.Content().PaddingVertical(14).Column(col =>
                {
                    col.Spacing(14);

                    WriteFigures(col, counts);
                    WriteFarms(col, farms);
                    WriteRequests(col, requests);
                });

                page.Footer().AlignCenter().Text(t =>
                {
                    t.Span("Page ");
                    t.CurrentPageNumber();
                    t.Span(" of ");
                    t.TotalPages();
                });
            })).GeneratePdf();

            var filename = $"agroflow-summary-{generated:yyyy-MM-dd}.pdf";
            return Results.File(bytes, "application/pdf", filename);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Never a bare 500: the details go to the log and the admin gets a sentence.
            var diagnosis = ex is PostgresException pg
                ? pg.SqlState switch
                {
                    "42P01" => "A table this summary reads does not exist. Check that every migration has been applied.",
                    "42703" => "A column this summary reads does not exist. Check that every migration has been applied.",
                    "42501" => "The API's database role is not permitted to read one of these tables.",
                    _ => $"Postgres reported {pg.SqlState}.",
                }
                : "Not a database error - see the exception.";

            logger.LogError(ex, "Building the platform summary PDF failed. {Diagnosis}", diagnosis);

            return Results.Json(
                new { error = "The summary could not be built. Try again shortly." },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    /* ------------------------------------------------------------------ *
     * Reads
     * ------------------------------------------------------------------ */

    private static async Task<string> ResolveActorNameAsync(
        NpgsqlConnection connection, ClaimsPrincipal user, CancellationToken ct)
    {
        if (!Guid.TryParse(user.FindFirstValue("sub"), out var id)) return "an administrator";

        await using var cmd = new NpgsqlCommand(
            "select coalesce(nullif(name, ''), email, 'an administrator') from profile where id = $1",
            connection);
        cmd.Parameters.AddWithValue(id);

        return await cmd.ExecuteScalarAsync(ct) as string ?? "an administrator";
    }

    private static async Task<SummaryCounts> ReadCountsAsync(
        NpgsqlConnection connection, CancellationToken ct)
    {
        // One round trip with independent scalar subqueries.
        // Archived farms have status = 'Inactive' (0036). We compare with lower() because
        // the live data has both 'Active' and 'active'.
        const string sql = """
            select
              (select count(*) from farm where lower(coalesce(status, 'Active')) <> 'inactive'),
              (select count(*) from farm where lower(coalesce(status, 'Active')) = 'inactive'),
              (select count(*) from profile where role = 'farm_user'),
              (select count(*) from profile where role = 'farm_user' and telegram_chat_id is null),
              (select count(*) from zone),
              (select count(*) from hardware),
              (select count(*) from hardware
                where enrollment_status = 'active' and status = 'Online'),
              (select count(*) from alert where status = 'Open'),
              (select count(*) from service_request where status = 'pending')
            """;

        await using var cmd = new NpgsqlCommand(sql, connection);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);

        return new SummaryCounts(
            reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3),
            reader.GetInt64(4), reader.GetInt64(5), reader.GetInt64(6), reader.GetInt64(7),
            reader.GetInt64(8));
    }

    private static async Task<List<FarmLine>> ReadFarmsAsync(
        NpgsqlConnection connection, CancellationToken ct)
    {
        // Archived farms ('Inactive', any case, see 0036) are left out, like the console's lists.
        const string sql = """
            select f.name,
                   coalesce(nullif(p.name, ''), p.email, 'No owner on file'),
                   coalesce(nullif(f.location, ''), 'Not set'),
                   (select count(*) from zone z where z.farm_id = f.farm_id),
                   (select count(*) from hardware h
                     join zone z on z.id = h.zone_id
                    where z.farm_id = f.farm_id),
                   coalesce(f.status, 'Active')
              from farm f
              left join profile p on p.id = f.owner_id
             where lower(coalesce(f.status, 'Active')) <> 'inactive'
             order by f.name
            """;

        var rows = new List<FarmLine>();

        await using var cmd = new NpgsqlCommand(sql, connection);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        while (await reader.ReadAsync(ct))
        {
            rows.Add(new FarmLine(
                reader.GetString(0), reader.GetString(1), reader.GetString(2),
                reader.GetInt64(3), reader.GetInt64(4), reader.GetString(5)));
        }

        return rows;
    }

    private static async Task<List<RequestLine>> ReadPendingRequestsAsync(
        NpgsqlConnection connection, CancellationToken ct)
    {
        const string sql = """
            select coalesce(nullif(p.name, ''), p.email, 'Unknown farmer'),
                   r.request_type,
                   coalesce(nullif(r.location, ''), 'Not stated'),
                   r.status,
                   r.created_at,
                   (select coalesce(nullif(a.name, ''), a.email)
                      from profile a where a.id = r.assigned_to_profile_id)
              from service_request r
              left join profile p on p.id = r.farmer_id
             where r.status <> 'completed'
             order by r.created_at
            """;

        var rows = new List<RequestLine>();

        await using var cmd = new NpgsqlCommand(sql, connection);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        while (await reader.ReadAsync(ct))
        {
            rows.Add(new RequestLine(
                reader.GetString(0),
                reader.GetString(1) == "new_farm" ? "New farm" : "New zone",
                reader.GetString(2),
                reader.GetString(3),
                reader.GetFieldValue<DateTimeOffset>(4),
                reader.IsDBNull(5) ? null : reader.GetString(5)));
        }

        return rows;
    }

    /* ------------------------------------------------------------------ *
     * Layout
     * ------------------------------------------------------------------ */

    private static void WriteFigures(ColumnDescriptor col, SummaryCounts c)
    {
        col.Item().Text("The figures").FontSize(13).SemiBold();

        var onlineShare = c.Kits > 0
            ? (c.KitsOnline * 100.0 / c.Kits).ToString("0.0", CultureInfo.InvariantCulture) + "%"
            : "no kits registered";

        var lines = new (string Label, string Value)[]
        {
            ("Farms on the platform", c.Farms.ToString(CultureInfo.InvariantCulture)),
            ("Farms archived", c.ArchivedFarms.ToString(CultureInfo.InvariantCulture)),
            ("Irrigation zones", c.Zones.ToString(CultureInfo.InvariantCulture)),
            ("Farmer accounts", c.Farmers.ToString(CultureInfo.InvariantCulture)),
            ("Farmers who would receive no alerts", c.FarmersWithoutTelegram.ToString(CultureInfo.InvariantCulture)),
            ("Kits registered", c.Kits.ToString(CultureInfo.InvariantCulture)),
            ("Kits currently online", $"{c.KitsOnline} ({onlineShare})"),
            ("Alerts still open", c.OpenAlerts.ToString(CultureInfo.InvariantCulture)),
            ("Farm requests waiting for a decision", c.PendingRequests.ToString(CultureInfo.InvariantCulture)),
        };

        col.Item().Table(table =>
        {
            table.ColumnsDefinition(x => { x.RelativeColumn(4); x.RelativeColumn(); });

            foreach (var (label, value) in lines)
            {
                table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2)
                    .PaddingVertical(3).Text(label);
                table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2)
                    .PaddingVertical(3).AlignRight().Text(value).SemiBold();
            }
        });

        if (c.FarmersWithoutTelegram > 0)
        {
            // Shown as its own line, not just a number: these farmers get no messages at all,
            // not even urgent ones.
            col.Item().Text(
                $"{c.FarmersWithoutTelegram} farmer account(s) have no Telegram connection, so they " +
                "currently receive no alerts of any kind.")
                .Italic().FontColor(Colors.Red.Darken1);
        }
    }

    private static void WriteFarms(ColumnDescriptor col, List<FarmLine> farms)
    {
        col.Item().Text("Farms").FontSize(13).SemiBold();

        if (farms.Count == 0)
        {
            col.Item().Text("No farms are registered yet.").Italic();
            return;
        }

        col.Item().Table(table =>
        {
            table.ColumnsDefinition(x =>
            {
                x.RelativeColumn(3); x.RelativeColumn(3); x.RelativeColumn(3);
                x.RelativeColumn(); x.RelativeColumn(); x.RelativeColumn(2);
            });

            table.Header(h =>
            {
                h.Cell().Text("Farm").SemiBold();
                h.Cell().Text("Owner").SemiBold();
                h.Cell().Text("Location").SemiBold();
                h.Cell().AlignRight().Text("Zones").SemiBold();
                h.Cell().AlignRight().Text("Kits").SemiBold();
                h.Cell().Text("Status").SemiBold();
            });

            foreach (var f in farms)
            {
                Cell(table).Text(f.Name);
                Cell(table).Text(f.Owner);
                Cell(table).Text(f.Location);
                Cell(table).AlignRight().Text(f.Zones.ToString(CultureInfo.InvariantCulture));
                Cell(table).AlignRight().Text(f.Kits.ToString(CultureInfo.InvariantCulture));
                Cell(table).Text(f.Status);
            }
        });
    }

    private static void WriteRequests(ColumnDescriptor col, List<RequestLine> requests)
    {
        col.Item().Text("Farm requests still open").FontSize(13).SemiBold();

        if (requests.Count == 0)
        {
            col.Item().Text("Nothing is waiting - every request has been completed.").Italic();
            return;
        }

        col.Item().Table(table =>
        {
            table.ColumnsDefinition(x =>
            {
                x.RelativeColumn(3); x.RelativeColumn(2); x.RelativeColumn(3);
                x.RelativeColumn(2); x.RelativeColumn(2); x.RelativeColumn(2);
            });

            table.Header(h =>
            {
                h.Cell().Text("Farmer").SemiBold();
                h.Cell().Text("Request").SemiBold();
                h.Cell().Text("Where").SemiBold();
                h.Cell().Text("Status").SemiBold();
                h.Cell().Text("Submitted").SemiBold();
                h.Cell().Text("Assigned to").SemiBold();
            });

            foreach (var r in requests)
            {
                Cell(table).Text(r.Farmer);
                Cell(table).Text(r.Type);
                Cell(table).Text(r.Location);
                Cell(table).Text(r.Status);
                Cell(table).Text(r.Submitted.ToOffset(Sast).ToString("dd MMM yyyy", CultureInfo.InvariantCulture));
                Cell(table).Text(r.AssignedTo ?? "Nobody yet");
            }
        });
    }

    private static IContainer Cell(TableDescriptor table)
    {
        return table.Cell()
            .BorderBottom(0.5f)
            .BorderColor(Colors.Grey.Lighten2)
            .PaddingVertical(3);
    }
}
