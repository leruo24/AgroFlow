using System.Globalization;
using System.IO.Compression;
using System.Text;

namespace AgroFlow.Api.Reports;

/// The cell styles the reports use. Order matters: each one is an index into
/// the `cellXfs` list in styles.xml below.
internal enum XlsxStyle
{
    Normal = 0,
    Title = 1,
    Subtitle = 2,
    SectionHeader = 3,
    TableHeader = 4,
    Bold = 5,
    OneDecimal = 6,
    TwoDecimals = 7,
    Total = 8,
    TotalOneDecimal = 9,
    Note = 10,
    Integer = 11,
    TotalInteger = 12,
}

/// A small .xlsx writer, because the API has no spreadsheet library and the
/// workbook must come from the same place as the PDF.
/// An .xlsx is a zip of XML parts:
///
///   [Content_Types].xml   what each part is
///   _rels/.rels           points at the workbook
///   xl/workbook.xml       names the sheets
///   xl/_rels/...rels      points at each sheet
///   xl/styles.xml         fonts, fills and number formats
///   xl/worksheets/*.xml   the cells
///
/// Strings are written inline (`t="inlineStr"`) instead of through a shared string
/// table, which is the fiddliest part of the format and saves nothing at our size.
internal static class XlsxWriter
{
    internal sealed record Cell(string? Text, double? Number, XlsxStyle Style, string? Formula = null)
    {
        /// A live Excel formula, written without its leading `=`.
        /// Litres are minutes x flow rate as a formula, so a farmer can change the flow rate
        /// on the Summary sheet and every row follows.
        /// No cached <v> is written, so Excel calculates on open. A plain XML reader sees an
        /// empty cell, which is why the totals stay values.
        public static Cell Calc(string formula, XlsxStyle style) =>
            new(null, null, style, formula);

        public static Cell Of(string text, XlsxStyle style = XlsxStyle.Normal) => new(text, null, style);

        public static Cell Of(double value, XlsxStyle style = XlsxStyle.Normal) => new(null, value, style);

        /// A missing value: an empty cell, not 0 or a dash, because a 0 would drag sums and
        /// averages down. Excel's AVERAGE skips blanks.
        public static Cell Blank() => new(null, null, XlsxStyle.Normal);

        public static Cell Maybe(double? value, XlsxStyle style) =>
            value.HasValue ? Of(value.Value, style) : Blank();
    }

    internal sealed class Sheet
    {
        public required string Name { get; init; }

        /// Widths in Excel's character units, one per column from A.
        public double[] ColumnWidths { get; init; } = Array.Empty<double>();

        public List<List<Cell>> Rows { get; } = new();

        public void Add(params Cell[] cells) => Rows.Add(cells.ToList());

        public void AddBlank() => Rows.Add(new List<Cell>());
    }

    public static byte[] Build(IReadOnlyList<Sheet> sheets)
    {
        using var buffer = new MemoryStream();

        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            Write(zip, "[Content_Types].xml", ContentTypes(sheets.Count));
            Write(zip, "_rels/.rels", RootRels());
            Write(zip, "xl/workbook.xml", Workbook(sheets));
            Write(zip, "xl/_rels/workbook.xml.rels", WorkbookRels(sheets.Count));
            Write(zip, "xl/styles.xml", Styles());

            for (var i = 0; i < sheets.Count; i++)
            {
                Write(zip, $"xl/worksheets/sheet{i + 1}.xml", Worksheet(sheets[i]));
            }
        }

        return buffer.ToArray();
    }

    private static void Write(ZipArchive zip, string path, string xml)
    {
        var entry = zip.CreateEntry(path, CompressionLevel.Optimal);
        using var stream = entry.Open();

        // UTF-8 without a byte order mark: Excel refuses to open an XML part that starts
        // with one.
        using var writer = new StreamWriter(stream, new UTF8Encoding(false));
        writer.Write(xml);
    }

    /// XML's five predefined entities. A bare & ("Smith & Son") makes Excel reject the
    /// whole workbook as corrupt.
    private static string E(string? text)
    {
        return ReportText.Clean(text)
            .Replace("&", "&amp;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;")
            .Replace("\"", "&quot;")
            .Replace("'", "&apos;");
    }

    /// Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 characters, and
    /// zone names are user input ("North / Seedlings").
    private static string SafeSheetName(string name)
    {
        var cleaned = new string(name.Select(c => ":\\/?*[]".Contains(c) ? ' ' : c).ToArray());
        cleaned = cleaned.Trim();

        if (cleaned.Length > 31) cleaned = cleaned[..31].Trim();

        return cleaned.Length == 0 ? "Sheet" : cleaned;
    }

    private static string ContentTypes(int sheetCount)
    {
        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sb.Append("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">");
        sb.Append("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>");
        sb.Append("<Default Extension=\"xml\" ContentType=\"application/xml\"/>");
        sb.Append("<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>");
        sb.Append("<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");

        for (var i = 1; i <= sheetCount; i++)
        {
            sb.Append(CultureInfo.InvariantCulture,
                $"<Override PartName=\"/xl/worksheets/sheet{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
        }

        sb.Append("</Types>");
        return sb.ToString();
    }

    private static string RootRels()
    {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
               "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
               "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
               "</Relationships>";
    }

    private static string Workbook(IReadOnlyList<Sheet> sheets)
    {
        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sb.Append("<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" ");
        sb.Append("xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>");

        for (var i = 0; i < sheets.Count; i++)
        {
            sb.Append(CultureInfo.InvariantCulture,
                $"<sheet name=\"{E(SafeSheetName(sheets[i].Name))}\" sheetId=\"{i + 1}\" r:id=\"rId{i + 1}\"/>");
        }

        sb.Append("</sheets></workbook>");
        return sb.ToString();
    }

    private static string WorkbookRels(int sheetCount)
    {
        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sb.Append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");

        for (var i = 1; i <= sheetCount; i++)
        {
            sb.Append(CultureInfo.InvariantCulture,
                $"<Relationship Id=\"rId{i}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{i}.xml\"/>");
        }

        // The styles part is also a workbook relationship, numbered after the sheets.
        // Without it Excel opens the file with every cell unstyled.
        sb.Append(CultureInfo.InvariantCulture,
            $"<Relationship Id=\"rId{sheetCount + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>");

        sb.Append("</Relationships>");
        return sb.ToString();
    }

    /// The colours match the PDF's header and tables. ARGB without a hash, Excel's notation.
    private static string Styles()
    {
        const string brand = "FF184D35";
        const string surface = "FFEDF2EF";

        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sb.Append("<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");

        // 164 is the first id for a custom format; 0-163 are reserved for built-ins.
        sb.Append("<numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"0.0\"/></numFmts>");

        sb.Append("<fonts count=\"5\">");
        sb.Append("<font><sz val=\"11\"/><name val=\"Calibri\"/><color rgb=\"FF222A26\"/></font>");
        sb.Append("<font><b/><sz val=\"11\"/><name val=\"Calibri\"/><color rgb=\"FF222A26\"/></font>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<font><b/><sz val=\"14\"/><name val=\"Calibri\"/><color rgb=\"{brand}\"/></font>");
        sb.Append("<font><b/><sz val=\"11\"/><name val=\"Calibri\"/><color rgb=\"FFFFFFFF\"/></font>");
        sb.Append("<font><sz val=\"10\"/><name val=\"Calibri\"/><color rgb=\"FF6B7A72\"/></font>");
        sb.Append("</fonts>");

        // Fills 0 and 1 are required by the spec, in this order, even though nothing uses fill 1.
        sb.Append("<fills count=\"4\">");
        sb.Append("<fill><patternFill patternType=\"none\"/></fill>");
        sb.Append("<fill><patternFill patternType=\"gray125\"/></fill>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<fill><patternFill patternType=\"solid\"><fgColor rgb=\"{brand}\"/><bgColor indexed=\"64\"/></patternFill></fill>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<fill><patternFill patternType=\"solid\"><fgColor rgb=\"{surface}\"/><bgColor indexed=\"64\"/></patternFill></fill>");
        sb.Append("</fills>");

        sb.Append("<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>");
        sb.Append("<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>");

        // The order here is the XlsxStyle enum; see the note on it.
        sb.Append("<cellXfs count=\"13\">");
        sb.Append("<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>");                                        // Normal
        sb.Append("<xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>");                        // Title
        sb.Append("<xf numFmtId=\"0\" fontId=\"4\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>");                        // Subtitle
        sb.Append("<xf numFmtId=\"0\" fontId=\"1\" fillId=\"3\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>");        // SectionHeader
        sb.Append("<xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>");        // TableHeader
        sb.Append("<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>");                        // Bold
        sb.Append("<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>");              // OneDecimal
        sb.Append("<xf numFmtId=\"2\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>");                // TwoDecimals
        sb.Append("<xf numFmtId=\"0\" fontId=\"1\" fillId=\"3\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>");        // Total
        sb.Append("<xf numFmtId=\"164\" fontId=\"1\" fillId=\"3\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyNumberFormat=\"1\"/>"); // TotalOneDecimal
        sb.Append("<xf numFmtId=\"0\" fontId=\"4\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>");                        // Note
        sb.Append("<xf numFmtId=\"1\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>");                // Integer
        sb.Append("<xf numFmtId=\"1\" fontId=\"1\" fillId=\"3\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyNumberFormat=\"1\"/>");   // TotalInteger
        sb.Append("</cellXfs>");

        sb.Append("<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>");
        sb.Append("</styleSheet>");
        return sb.ToString();
    }

    /// A1, B1 ... Z1, AA1: Excel columns are base 26 with no zero, so this is a loop.
    private static string ColumnName(int index)
    {
        var name = string.Empty;

        for (var i = index; i >= 0; i = i / 26 - 1)
        {
            name = (char)('A' + i % 26) + name;
        }

        return name;
    }

    private static string Worksheet(Sheet sheet)
    {
        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sb.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");

        if (sheet.ColumnWidths.Length > 0)
        {
            sb.Append("<cols>");
            for (var i = 0; i < sheet.ColumnWidths.Length; i++)
            {
                sb.Append(CultureInfo.InvariantCulture,
                    $"<col min=\"{i + 1}\" max=\"{i + 1}\" width=\"{sheet.ColumnWidths[i].ToString("0.##", CultureInfo.InvariantCulture)}\" customWidth=\"1\"/>");
            }
            sb.Append("</cols>");
        }

        sb.Append("<sheetData>");

        for (var r = 0; r < sheet.Rows.Count; r++)
        {
            var row = sheet.Rows[r];
            if (row.Count == 0) continue; // a spacer row needs no element

            sb.Append(CultureInfo.InvariantCulture, $"<row r=\"{r + 1}\">");

            for (var c = 0; c < row.Count; c++)
            {
                var cell = row[c];
                var reference = $"{ColumnName(c)}{r + 1}";
                var style = (int)cell.Style;

                if (cell.Formula is { } formula)
                {
                    sb.Append(CultureInfo.InvariantCulture,
                        $"<c r=\"{reference}\" s=\"{style}\"><f>{E(formula)}</f></c>");
                }
                else if (cell.Number is { } number)
                {
                    // "R" round-trips, and InvariantCulture keeps the decimal point. With a comma
                    // Excel reads the cell as text and totals stop adding it.
                    sb.Append(CultureInfo.InvariantCulture,
                        $"<c r=\"{reference}\" s=\"{style}\"><v>{number.ToString("R", CultureInfo.InvariantCulture)}</v></c>");
                }
                else if (!string.IsNullOrEmpty(cell.Text))
                {
                    sb.Append(CultureInfo.InvariantCulture,
                        $"<c r=\"{reference}\" s=\"{style}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{E(cell.Text)}</t></is></c>");
                }
                else
                {
                    sb.Append(CultureInfo.InvariantCulture, $"<c r=\"{reference}\" s=\"{style}\"/>");
                }
            }

            sb.Append("</row>");
        }

        sb.Append("</sheetData></worksheet>");
        return sb.ToString();
    }
}
