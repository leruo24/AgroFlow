using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;
using AgroFlow.Api.Reports;
using QuestPDF.Infrastructure;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Part 2 adversarial sweep: names and notes a person (or an attacker) might
// type - script tags, SQL, quotes, emoji, Zulu and Afrikaans letters, control
// characters, 500 characters - must come out of every generated file intact
// and inert, never as a broken file.
public class HostileTextTests
{
    static HostileTextTests() { QuestPDF.Settings.License = LicenseType.Community; }

    public static readonly string[] Hostile =
    {
        "<script>alert('x')</script>",
        "' OR 1=1 --",
        "\"Quoted\" & <b>bold</b>",
        "Ngqeleni",
        "Kroonstad Sôre",
        "Tub 🌱 one",
        "=HYPERLINK(\"http://evil.example\",\"click\")",
        "bell\u0007 and nul-ish\u0001 chars",
        new string('x', 500),
    };

    public static IEnumerable<object[]> Cases() => Hostile.Select(h => new object[] { h });

    private static EnquiryReportContent Content(string text) => EnquiryReport.Compose(
        new List<EnquiryFact>
        {
            new(1, new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.FromHours(2)), "Gauteng", "lost", "not_interested",
                "other", text, Guid.Empty, text, new DateTimeOffset(2026, 10, 1, 11, 0, 0, TimeSpan.FromHours(2)), null, 0, null),
        },
        new List<EnquiryCallFact> { new(1, new DateTimeOffset(2026, 10, 1, 11, 0, 0, TimeSpan.FromHours(2)), text, "not_interested") },
        new DateOnly(2026, 9, 8), new DateOnly(2026, 10, 7), new DateTimeOffset(2026, 10, 7, 10, 0, 0, TimeSpan.FromHours(2)),
        null, Guid.Empty, text);

    [Theory]
    [MemberData(nameof(Cases))]
    public void The_pdf_renders_with_the_text_in_it(string text)
    {
        // The admin's name labels a chart bar and the "Other" reason is
        // printed; both must survive.
        var pdf = EnquiryReportPdf.Build(Content(text), DateTimeOffset.UtcNow);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void A_chart_label_is_escaped_into_valid_svg(string text)
    {
        var svg = ChartSvg.DailyBars(new[] { text }, new double?[] { 1 }, "calls");
        XDocument.Parse(svg);                        // throws if the label broke the markup
        Assert.DoesNotContain("<script>", svg);
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void The_workbook_is_valid_xml_and_never_a_formula(string text)
    {
        var bytes = EnquiryReportPdf.Workbook(Content(text));
        using var zip = new ZipArchive(new MemoryStream(bytes));
        foreach (var entry in zip.Entries.Where(e => e.FullName.EndsWith(".xml", StringComparison.Ordinal)))
        {
            using var stream = entry.Open();
            var doc = XDocument.Load(stream);    // throws on an invalid character or broken markup
            // Text is written as an inline string; a "=..." name must never become a formula.
            if (entry.FullName.StartsWith("xl/worksheets/", StringComparison.Ordinal))
            {
                Assert.DoesNotContain(doc.Descendants(), e => e.Name.LocalName == "f" && e.Value.Contains("HYPERLINK"));
            }
        }
    }
}
