/* CSV export helpers. */

/* A farm or farmer called "=HYPERLINK(...)" would become a live formula when the export is
 * opened in Excel. Text a spreadsheet would read as a formula gets a leading apostrophe
 * (the OWASP advice for CSV injection). A plain negative like "-12%" is left alone, and
 * numbers passed as numbers are never touched. */
export function neutraliseFormula(text: string): string {
  if (/^[=+@\t\r]/.test(text)) return `'${text}`;
  if (text.startsWith("-") && !/^-[\d.,\s]+%?$/.test(text)) return `'${text}`;
  return text;
}

export function toCSV(headers: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number): string => {
    const text = typeof v === "number" ? String(v) : neutraliseFormula(String(v ?? ""));
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}

export function downloadCSV(filename: string, csvText: string): void {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}
