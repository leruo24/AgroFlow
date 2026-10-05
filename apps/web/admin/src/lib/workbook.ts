/* Spreadsheet exports.
 *
 * WHY THIS REPLACED THE CSV
 * The old "Export summary" produced a CSV that opened in Excel with every
 * value crammed into column A, headers included - `Metric,"Value"` sitting in
 * one cell. That is not a bug in the file: Excel splits a CSV on the list
 * separator from the machine's locale, and in South Africa that is a
 * SEMICOLON, not a comma. A comma-separated file is therefore one long string
 * per row to the person opening it.
 *
 * It also exported raw keys - `farmersNotReceivingAlerts` - which is a
 * property name, not a label anybody should have to read.
 *
 * So: a real .xlsx, where there is no separator to guess, numbers are
 * numbers, percentages are percentages, and the labels are sentences.
 *
 * CSV is kept for the ad-hoc table exports, but written properly - see
 * `toExcelSafeCsv` at the bottom.
 */

import ExcelJS from "exceljs";
import { fmtDateTimeSast } from "@/lib/format";
import type { AuditRow } from "@/services/agroFlowApi";

/* AgroFlow green, as Excel wants it: ARGB, no hash. */
const BRAND = "FF184D35";
const BRAND_LIGHT = "FFEAF1ED";

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  row.alignment = { vertical: "middle" };
  row.height = 20;
}

function styleTitle(row: ExcelJS.Row): void {
  row.font = { bold: true, size: 14, color: { argb: BRAND } };
  row.height = 24;
}

function styleSection(row: ExcelJS.Row): void {
  row.font = { bold: true, size: 11, color: { argb: BRAND } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_LIGHT } };
}

/* Browsers cannot write a file; they can follow a link to one. The object URL
   is revoked on a delay rather than immediately, because revoking it in the
   same tick races the download starting in some browsers. */
async function download(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();

  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function stamp(): string {
  return fmtDateTimeSast(new Date().toISOString());
}

/* ------------------------------------------------------------------ *
 * The platform summary (item 7)
 * ------------------------------------------------------------------ */

export type SummarySection = {
  title: string;
  rows: { label: string; value: number | string; format?: "int" | "pct" | "text" }[];
};

export type SummaryWorkbookInput = {
  generatedBy: string;
  sections: SummarySection[];
  farms: {
    name: string; owner: string; location: string;
    zones: number; kitsOnline: number; kitsTotal: number; status: string;
  }[];
  alerts: { raised: string; title: string; farm: string; priority: string; status: string }[];
  requests: {
    farmer: string; type: string; location: string; status: string;
    submitted: string; assignedTo: string; scheduledBy: string; completedBy: string;
  }[];
};

export async function exportSummaryWorkbook(input: SummaryWorkbookInput): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AgroFlow";
  wb.created = new Date();

  /* ---- Summary ---------------------------------------------------- */
  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 52 }, { width: 18 }];

  styleTitle(summary.addRow(["AgroFlow platform summary"]));
  summary.addRow([`Generated ${stamp()} (SAST)`]);
  summary.addRow([`By ${input.generatedBy}`]);
  summary.addRow([]);

  for (const section of input.sections) {
    styleSection(summary.addRow([section.title, ""]));

    for (const r of section.rows) {
      const row = summary.addRow([r.label, r.value]);
      const cell = row.getCell(2);

      // Real types, not strings that look like numbers: a percentage written
      // as "94.2%" cannot be charted or averaged by whoever opens this.
      if (r.format === "pct") {
        cell.numFmt = "0.0%";
      } else if (r.format === "int") {
        cell.numFmt = "#,##0";
      }

      cell.alignment = { horizontal: "right" };
    }

    summary.addRow([]);
  }

  /* ---- Farms ------------------------------------------------------ */
  const farms = wb.addWorksheet("Farms");
  farms.columns = [
    { header: "Farm", key: "name", width: 28 },
    { header: "Owner", key: "owner", width: 24 },
    { header: "Location", key: "location", width: 26 },
    { header: "Zones", key: "zones", width: 10 },
    { header: "Kits online", key: "online", width: 14 },
    { header: "Kits total", key: "total", width: 12 },
    { header: "Status", key: "status", width: 14 },
  ];
  styleHeader(farms.getRow(1));

  for (const f of input.farms) {
    farms.addRow({
      name: f.name, owner: f.owner, location: f.location,
      zones: f.zones, online: f.kitsOnline, total: f.kitsTotal, status: f.status,
    });
  }
  farms.views = [{ state: "frozen", ySplit: 1 }];

  /* ---- Alerts ----------------------------------------------------- */
  const alerts = wb.addWorksheet("Open alerts");
  alerts.columns = [
    { header: "Raised (SAST)", key: "raised", width: 22 },
    { header: "Alert", key: "title", width: 46 },
    { header: "Farm", key: "farm", width: 24 },
    { header: "Priority", key: "priority", width: 12 },
    { header: "Status", key: "status", width: 14 },
  ];
  styleHeader(alerts.getRow(1));
  for (const a of input.alerts) alerts.addRow(a);
  alerts.views = [{ state: "frozen", ySplit: 1 }];

  /* ---- Requests, with the who/when chain -------------------------- */
  const requests = wb.addWorksheet("Requests");
  requests.columns = [
    { header: "Farmer", key: "farmer", width: 24 },
    { header: "Request", key: "type", width: 14 },
    { header: "Location", key: "location", width: 24 },
    { header: "Status", key: "status", width: 13 },
    { header: "Submitted (SAST)", key: "submitted", width: 22 },
    { header: "Assigned to", key: "assignedTo", width: 20 },
    { header: "Scheduled by", key: "scheduledBy", width: 20 },
    { header: "Completed by", key: "completedBy", width: 20 },
  ];
  styleHeader(requests.getRow(1));
  for (const r of input.requests) requests.addRow(r);
  requests.views = [{ state: "frozen", ySplit: 1 }];

  await download(wb, `agroflow-summary-${new Date().toISOString().slice(0, 10)}`);
}

/* ------------------------------------------------------------------ *
 * The activity log (item 5)
 * ------------------------------------------------------------------ */

export async function exportActivityWorkbook(rows: AuditRow[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AgroFlow";
  wb.created = new Date();

  const ws = wb.addWorksheet("Activity");
  ws.columns = [
    { header: "When (SAST)", key: "when", width: 22 },
    { header: "Who", key: "who", width: 22 },
    { header: "What happened", key: "what", width: 62 },
    { header: "Farm", key: "farm", width: 24 },
    { header: "Action code", key: "action", width: 26 },
  ];
  styleHeader(ws.getRow(1));

  for (const r of rows) {
    ws.addRow({
      when: fmtDateTimeSast(r.createdAt),
      who: r.actorName,
      what: r.summary,
      farm: r.farmName ?? "",
      action: r.action,
    });
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "E1" };

  await download(wb, `agroflow-activity-${new Date().toISOString().slice(0, 10)}`);
}

/* ------------------------------------------------------------------ *
 * CSV, written so Excel can actually open it
 * ------------------------------------------------------------------ */

/* Two things make a CSV open correctly in Excel anywhere:
 *
 *   1. A `sep=,` first line. Excel reads this as an instruction and stops
 *      guessing from the locale, which is what put every value in column A
 *      on a South African machine.
 *   2. A UTF-8 BOM. Without it Excel decodes the file as the system
 *      codepage, and any non-ASCII character in a farm name arrives mangled.
 *
 * Both are ignored by every other tool that reads CSV, so this costs nothing
 * elsewhere.
 */
export function toExcelSafeCsv(csv: string): string {
  return `sep=,\r\n${csv}`;
}

export function downloadExcelSafeCsv(filename: string, csv: string): void {
  // ﻿ is the BOM. It must be the first character of the blob, before
  // the sep= line.
  const blob = new Blob(["﻿", toExcelSafeCsv(csv)], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
