using System.Globalization;
using AgroFlow.Business.Agronomy.RuleBook;
using QuestPDF.Fluent;
using QuestPDF.Infrastructure;

namespace AgroFlow.Api.Reports;

// "Why:" in the PDFs.
// Under each action and verdict there is a short grey line, "Why: <summary> (note 2)",
// and on the last page a numbered "Why we said this" entry with the facts, the rule,
// how sure we are and what would change it. The technical line (FAO-56 page and
// numbers) is printed small in the appendix. Every report uses this one helper.
internal sealed class ReportWhy
{
    private readonly List<Explanation> _notes = new();

    // Each registered explanation -> its note number. Zones with the same reason share
    // one note, so the second line says "as in note N".
    private readonly Dictionary<Explanation, int> _numbers = new(ReferenceEqualityComparer.Instance);
    private readonly Dictionary<string, int> _bySummary = new(StringComparer.Ordinal);

    public IReadOnlyList<Explanation> Notes => _notes;

    /// Registers an explanation before rendering, so the numbering never depends on how
    /// often QuestPDF lays out a page. Null or empty is ignored.
    public void Add(Explanation? explanation)
    {
        if (explanation is null || string.IsNullOrWhiteSpace(explanation.Summary)) return;
        if (_numbers.ContainsKey(explanation)) return;

        if (_bySummary.TryGetValue(explanation.Summary, out var shared))
        {
            _numbers[explanation] = shared;
            return;
        }

        _notes.Add(explanation);
        _numbers[explanation] = _notes.Count;
        _bySummary[explanation.Summary] = _notes.Count;
    }

    /// Writes the grey "Why:" line: in full the first time, "as in note N" after that.
    public void Line(ColumnDescriptor col, Explanation? explanation)
    {
        if (explanation is null || !_numbers.TryGetValue(explanation, out var number)) return;
        var owner = ReferenceEquals(_notes[number - 1], explanation);
        var n = number.ToString(CultureInfo.InvariantCulture);

        col.Item().PaddingTop(2).Text(t =>
        {
            t.Span("Why: ").SemiBold().FontSize(7.5f).FontColor(ReportTheme.Muted);
            if (owner)
            {
                t.Span(explanation.Summary).FontSize(7.5f).FontColor(ReportTheme.Muted);
                t.Span($" (note {n})").FontSize(7.5f).FontColor(ReportTheme.Muted);
            }
            else
            {
                t.Span($"the same reason as note {n}.").FontSize(7.5f).FontColor(ReportTheme.Muted);
            }
        });
    }

    private static readonly System.Text.Json.JsonSerializerOptions Json = new(System.Text.Json.JsonSerializerDefaults.Web);

    /// The explanation carried by one insight in a report's JSON, or null.
    public static Explanation? Parse(System.Text.Json.JsonElement insight)
    {
        if (insight.ValueKind != System.Text.Json.JsonValueKind.Object
            || !insight.TryGetProperty("explanation", out var e)
            || e.ValueKind != System.Text.Json.JsonValueKind.Object)
        {
            return null;
        }

        try { return System.Text.Json.JsonSerializer.Deserialize<Explanation>(e, Json); }
        catch (System.Text.Json.JsonException) { return null; }
    }

    /// Registers every explanation in an "insights" array, in order, and returns them
    /// in the same order (null where there is none).
    public List<Explanation?> AddInsights(System.Text.Json.JsonElement container)
    {
        var perInsight = new List<Explanation?>();
        if (container.ValueKind != System.Text.Json.JsonValueKind.Object
            || !container.TryGetProperty("insights", out var insights)
            || insights.ValueKind != System.Text.Json.JsonValueKind.Array)
        {
            return perInsight;
        }

        foreach (var insight in insights.EnumerateArray())
        {
            var e = Parse(insight);
            Add(e);
            perInsight.Add(e);
        }
        return perInsight;
    }

    /// "Why we said this": one numbered entry per registered explanation.
    public void Appendix(ColumnDescriptor col)
    {
        if (_notes.Count == 0) return;

        ReportShell.Heading(col, "Why we said this");

        for (var i = 0; i < _notes.Count; i++)
        {
            var e = _notes[i];
            col.Item().PaddingBottom(8).Column(c =>
            {
                c.Item().Text($"{(i + 1).ToString(CultureInfo.InvariantCulture)}. {e.Summary}").FontSize(9).SemiBold();

                foreach (var f in e.Facts)
                {
                    c.Item().PaddingLeft(12).Text($"- {f.Label}: {f.Value} ({f.Source})").FontSize(8);
                }

                if (!string.IsNullOrWhiteSpace(e.Rule))
                    c.Item().PaddingLeft(12).PaddingTop(2).Text("The rule: " + e.Rule).FontSize(8);
                if (!string.IsNullOrWhiteSpace(e.Confidence))
                    c.Item().PaddingLeft(12).Text("How sure: " + e.Confidence).FontSize(8);
                if (!string.IsNullOrWhiteSpace(e.WhatWouldChangeIt))
                    c.Item().PaddingLeft(12).Text("What would change it: " + e.WhatWouldChangeIt).FontSize(8);
                if (!string.IsNullOrWhiteSpace(e.Technical))
                    c.Item().PaddingLeft(12).Text("Technical: " + e.Technical).FontSize(7).FontColor(ReportTheme.Muted);
            });
        }
    }
}
