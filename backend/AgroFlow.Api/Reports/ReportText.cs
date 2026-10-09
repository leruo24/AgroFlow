using System.Text;

namespace AgroFlow.Api.Reports;

// Text typed by people goes into XML (the workbook sheets and chart SVG), and XML
// 1.0 cannot hold most control characters or half a surrogate pair. One pasted bell
// character could corrupt the workbook, so we drop those and keep everything else,
// including emoji and accents.
internal static class ReportText
{
    public static string Clean(string? text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;

        StringBuilder? sb = null;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            bool keep;
            if (char.IsHighSurrogate(c)) keep = i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]);
            else if (char.IsLowSurrogate(c)) keep = i > 0 && char.IsHighSurrogate(text[i - 1]);
            else keep = c >= 0x20 ? c != '￾' && c != '￿' : c is '\t' or '\n' or '\r';

            if (keep) sb?.Append(c);
            else sb ??= new StringBuilder(text, 0, i, text.Length);
        }
        return sb?.ToString() ?? text;
    }
}
