# Bugs found in the Part 2 test pass

Every bug the Part 2 sweep found: what a person would have seen, why, the
fix, and the test that now stops it coming back. The fix commit is the
`part 2 (n)` commit named in the last column's file history; each row names
it once committed.

| # | Symptom | Root cause | Fix | Guarding test |
|---|---|---|---|---|
| 1 | The public "Get a call back" form (landing page and app login, item 6c) answered **401 "Missing or invalid X-Api-Key header"** to everyone, so no enquiry could ever be sent. Its own tests passed because they mocked the API. | The device shared-key gate in `Program.cs` lets through only a fixed list of path prefixes; `/api/public` was not on it. | `/api/public` added to the gate's list. | `ApiContractTests.The_public_enquiry_form_is_reachable_without_a_login_or_device_key` (real pipeline, in memory) |
| 2 | A farm or farmer named `=HYPERLINK("http://…")` (or `@…`, `+…`, `-cmd|…`) became a **live formula** when an admin opened any CSV export in Excel - CSV injection. | `toCSV` quoted values but did not neutralise a leading formula character. | `neutraliseFormula`: such text gets a leading `'`; plain negative numbers like `-12%` and real numbers are untouched. | `hostile.spec.ts` "the activity CSV neutralises formulas…" (fails with the fix removed - checked) |
| 3 | A control character in a name or note (a pasted bell or backspace) made **Excel reject the whole workbook as corrupt**, and made the **PDF fail** on its chart. | XML 1.0 cannot hold most control characters; the workbook and SVG escapers only escaped `& < > " '`. | `ReportText.Clean` drops XML-invalid characters (keeps tab/LF/CR, emoji, accents) in both escapers. | `HostileTextTests` (workbook XML parses; chart SVG parses; PDF renders) |
| 4 | **Any emoji in a farm, zone or admin name made the PDF fail** ("glyph(s) not available in the configured fonts"). Every report carries those names. | QuestPDF's glyph check throws by default when the font has no glyph. | `CheckIfAllTextGlyphsAreAvailable = false` in `Program.cs` and the shared `ReportShell`: the character prints as a blank box, the report is made. | `HostileTextTests.The_pdf_renders_with_the_text_in_it("Tub 🌱 one")` |
