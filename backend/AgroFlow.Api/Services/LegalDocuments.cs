using System.Reflection;

namespace AgroFlow.Api.Services;

// The terms of service and privacy notice the app shows at activation (Part B). Both are DRAFTS
// ("Draft – needs approval") until the team and a lawyer approve them; a new version number means
// every farmer is asked again. The text is embedded in the API (Legal/*.md), so the version the
// farmer accepts is exactly the text the server serves.
public static class LegalDocuments
{
    public sealed record Document(string Key, string Title, string Version, DateOnly Date, string Status, string Resource);

    public static readonly Document Terms = new("terms", "Terms of service", "0.1-draft", new DateOnly(2026, 10, 23), "draft", "terms-of-service.md");
    public static readonly Document Privacy = new("privacy", "Privacy notice", "0.1-draft", new DateOnly(2026, 10, 23), "draft", "privacy-notice.md");

    public static readonly IReadOnlyList<Document> All = new[] { Terms, Privacy };

    public const string DraftLabel = "Draft – needs approval";

    public static Document? Find(string key) => All.FirstOrDefault(d => d.Key == key);

    public static string Text(Document document)
    {
        var assembly = typeof(LegalDocuments).Assembly;
        var name = assembly.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith(document.Resource, StringComparison.Ordinal))
            ?? throw new InvalidOperationException($"The {document.Title} text is missing from the build.");
        using var stream = assembly.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    public static object Describe(Document d, string publicBase) => new
    {
        key = d.Key,
        title = d.Title,
        version = d.Version,
        date = d.Date.ToString("yyyy-MM-dd"),
        status = d.Status,
        statusLabel = d.Status == "draft" ? DraftLabel : "Approved",
        url = $"{publicBase}/api/public/legal/{d.Key}",
    };
}
