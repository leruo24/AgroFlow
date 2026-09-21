import { api } from "@/data/api";
import { esc, fmtInt, fmtDate, fmtPct, fmtLitres } from "@/lib/format";
import { getFilter, applyFilters, rangeLabel } from "@/lib/filters";
import {
  PROVINCES, REGIONS, CROPS,
} from "@/data/referenceData";
import {
  badge, kpiCard, panel, table, pageHeader, filterBar, resultCount,
  lineChart, barChart, donut, meter,
} from "@/ui/components";
import type { IrrigationEvent, SeriesPoint, SettingsTab } from "@/types/models";
import { Icon } from "@/lib/icons";

/* ============================ IRRIGATION DATA ============================ */
/* Historical analytics for administrators — NOT live irrigation control.   */

function groupByMonth(events: IrrigationEvent[]): SeriesPoint[] {
  const map = new Map<string, number>();
  for (const e of events) {
    const key = e.date.slice(0, 7);
    map.set(key, (map.get(key) ?? 0) + e.litres);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => ({ label: k.slice(5), value: Math.round(v / 1000) }));
}

function groupByFarm(events: IrrigationEvent[]): SeriesPoint[] {
  const map = new Map<string, number>();
  for (const e of events) map.set(e.farm, (map.get(e.farm) ?? 0) + e.litres);
  return [...map.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([k, v]) => ({ label: k.split(" ")[0] ?? k, value: Math.round(v / 1000) }));
}

function groupByRegion(events: IrrigationEvent[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const e of events) map[e.region] = (map[e.region] ?? 0) + Math.round(e.litres / 1000);
  return map;
}

export async function irrigationPage(): Promise<string> {
  const [schedules, events] = await Promise.all([api.getSchedules(), api.getIrrigationEvents()]);
  const f = getFilter("irrigation");

  const filteredEvents = applyFilters(events, f, {
    search: (e) => `${e.farm} ${e.zone} ${e.crop}`,
    date: (e) => e.date,
    farm: (e) => e.farm,
    province: (e) => e.province,
    region: (e) => e.region,
    crop: (e) => e.crop,
  });

  const filteredSchedules = applyFilters(schedules, f, {
    search: (s) => `${s.zone} ${s.farm} ${s.crop} ${s.device}`,
    farm: (s) => s.farm,
    province: (s) => s.province,
    region: (s) => s.region,
    crop: (s) => s.crop,
  });

  const totalLitres = filteredEvents.reduce((a, e) => a + e.litres, 0);
  const totalMinutes = filteredEvents.reduce((a, e) => a + e.durationMin, 0);
  const onSchedule = filteredEvents.filter((e) => e.onSchedule).length;
  const compliance = filteredEvents.length ? (onSchedule / filteredEvents.length) * 100 : 0;

  const monthly = groupByMonth(filteredEvents);
  const byFarm = groupByFarm(filteredEvents);
  const byRegion = groupByRegion(filteredEvents);

  const recent = [...filteredEvents]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 25);

  return `
  ${pageHeader("Irrigation Data", "Historical irrigation analytics collected from farms. This page is read-and-analyse; it does not control irrigation.",
    `<button class="btn ghost" data-act="export-irrigation">Export CSV</button>`)}

  ${filterBar({
    page: "irrigation",
    filter: f,
    showDateRange: true,
    searchPlaceholder: "Search by farm, zone or crop…",
    selects: [
      { key: "farm", label: "Farm", options: [...new Set(events.map((e) => e.farm))] },
      { key: "province", label: "Province", options: [...PROVINCES] },
      { key: "region", label: "Region", options: [...REGIONS] },
      { key: "crop", label: "Crop type", options: [...CROPS] },
    ],
  })}

  <div class="grid kpis four">
    ${kpiCard({ label: "Water Delivered", value: Math.round(totalLitres / 1000), format: "int", trend: { dir: "up", text: "kL in range (estimated)" }, icon: Icon.droplet })}
    ${kpiCard({ label: "Irrigation Events", value: filteredEvents.length, icon: Icon.repeat })}
    ${kpiCard({ label: "Total Duration", value: Math.round(totalMinutes / 60), trend: { dir: "up", text: "hours" }, icon: Icon.timer })}
    ${kpiCard({ label: "Schedule Compliance", value: compliance, format: "pct", icon: Icon.circleCheck })}
  </div>

  <div class="grid split-2">
    ${panel("Monthly Irrigation Trend", `Water delivered per month (kL) · ${rangeLabel(f)}`, "",
      monthly.length ? lineChart(monthly, "#38bdf8") : `<div class="empty-state">No irrigation events in this range.</div>`)}
    ${panel("Regional Comparison", "Water delivered by region (kL)", "",
      Object.keys(byRegion).length ? donut(byRegion, ["#22c55e", "#38bdf8", "#f59e0b", "#a78bfa", "#ef4444"])
        : `<div class="empty-state">No data.</div>`)}
  </div>

  ${panel("Water Usage by Farm", "Top farms by volume delivered (kL)", "",
    byFarm.length ? barChart(byFarm) : `<div class="empty-state">No data in this range.</div>`)}

  ${panel("Irrigation Schedules", "View, edit or remove schedules recorded from farms",
    resultCount(filteredSchedules.length, schedules.length, "schedules"),
    table(["Zone", "Farm", "Crop", "Device", "Cadence", "Duration", "Compliance", "Last Run", "Actions"],
      filteredSchedules, (s) => [
        esc(s.zone),
        esc(s.farm),
        badge(s.crop, "info"),
        `<span class="mono">${esc(s.device)}</span>`,
        esc(s.cadence),
        `${fmtInt(s.durationMin)} min`,
        `<span class="compliance">${meter(s.compliancePct, s.compliancePct > 90 ? "good" : s.compliancePct > 75 ? "warn" : "bad")}<b>${fmtPct(s.compliancePct)}</b></span>`,
        fmtDate(s.lastRun),
        `<span class="row-act">
          <a href="#" data-act="view-schedule" data-id="${s.id}">View</a>
          <a href="#" data-act="edit-schedule" data-id="${s.id}">Edit</a>
          <a href="#" class="danger" data-act="delete-schedule" data-id="${s.id}">Delete</a>
        </span>`,
      ], "No schedules match the current filters."))}

  ${panel("Historical Irrigation Events", `Most recent 25 events in range · ${rangeLabel(f)}`,
    resultCount(Math.min(recent.length, 25), filteredEvents.length, "events"),
    table(["Date", "Farm", "Zone", "Crop", "Volume", "Duration", "On Schedule"], recent, (e) => [
      fmtDate(e.date),
      esc(e.farm),
      esc(e.zone),
      esc(e.crop),
      fmtLitres(e.litres),
      `${fmtInt(e.durationMin)} min`,
      e.onSchedule ? badge("Yes", "good") : badge("Missed", "warn"),
    ], "No irrigation events in this range."))}
  `;
}

/* =========================== REPORTS & ANALYTICS ========================== */

const REPORT_TYPES = [
  { id: "farm-growth", name: "Farm Growth", desc: "New farm registrations over time", icon: Icon.tractor },
  { id: "user-growth", name: "User Growth", desc: "Account creation and activation trend", icon: Icon.users },
  { id: "device-performance", name: "Device Performance", desc: "Uptime and reliability by device type", icon: Icon.radio },
  { id: "hardware-downtime", name: "Hardware Downtime", desc: "Outage duration and root cause", icon: Icon.pause },
  { id: "connectivity", name: "Connectivity", desc: "Gateway and node connection quality", icon: Icon.wifi },
  { id: "maintenance-history", name: "Maintenance History", desc: "Jobs raised, completed and overdue", icon: Icon.wrench },
  { id: "alert-trends", name: "Alert Trends", desc: "Volume and category breakdown", icon: Icon.bell },
  { id: "support-performance", name: "Support Performance", desc: "Response and resolution times", icon: Icon.headphones },
  { id: "irrigation-history", name: "Irrigation History", desc: "Scheduled vs actual irrigation runs", icon: Icon.droplet },
  { id: "water-usage", name: "Water Usage Trends", desc: "Volume delivered by farm and region", icon: Icon.barChart },
];

export async function reportsPage(): Promise<string> {
  const [growth, kpis, events, maintenance] = await Promise.all([
    api.getGrowth(), api.getKpis(), api.getIrrigationEvents(), api.getMaintenance(),
  ]);
  const f = getFilter("reports");

  const filteredEvents = applyFilters(events, f, {
    date: (e) => e.date,
    farm: (e) => e.farm,
    province: (e) => e.province,
    region: (e) => e.region,
  });

  const filteredJobs = applyFilters(maintenance, f, {
    date: (m) => m.scheduledFor,
    farm: (m) => m.farm,
    province: (m) => m.province,
  });

  const waterInRange = filteredEvents.reduce((a, e) => a + e.litres, 0);

  return `
  ${pageHeader("Reports & Analytics", "Generate, compare and export platform reports across farms, regions and time periods.")}

  ${filterBar({
    page: "reports",
    filter: f,
    showDateRange: true,
    searchPlaceholder: "Search report types…",
    selects: [
      { key: "farm", label: "Farm", options: [...new Set([...events.map((e) => e.farm), ...maintenance.map((m) => m.farm)])] },
      { key: "province", label: "Province", options: [...PROVINCES] },
      { key: "region", label: "Region", options: [...REGIONS] },
    ],
  })}

  <div class="grid kpis four">
    ${kpiCard({ label: "Farms Reporting", value: kpis.totalFarms, icon: Icon.tractor })}
    ${kpiCard({ label: "Water in Range", value: Math.round(waterInRange / 1000), trend: { dir: "up", text: "kL" }, icon: Icon.droplet })}
    ${kpiCard({ label: "Maintenance in Range", value: filteredJobs.length, icon: Icon.wrench })}
    ${kpiCard({ label: "Platform Availability", value: kpis.platformAvailability, format: "pct2", icon: Icon.circleCheck })}
  </div>

  <div class="grid split-2">
    ${panel("User Growth", `New accounts per month · ${rangeLabel(f)}`, "", lineChart(growth.users, "#22c55e"))}
    ${panel("Farm Growth", `New farms per month · ${rangeLabel(f)}`, "", lineChart(growth.farms, "#38bdf8"))}
  </div>

  <div class="grid split-2">
    ${panel("Device Connectivity", "Monthly average connectivity (%)", "", lineChart(growth.connectivity, "#a78bfa"))}
    ${panel("Maintenance Volume", "Jobs raised per month", "", barChart(growth.maintenance))}
  </div>

  ${panel("Generate Report", `Reports respect the filters above · ${rangeLabel(f)}`, "", `
    <div class="report-grid">
      ${REPORT_TYPES.map((r) => `
        <div class="report-card reveal">
          <div class="report-ico">${r.icon}</div>
          <div class="report-body">
            <h5>${esc(r.name)}</h5>
            <p>${esc(r.desc)}</p>
          </div>
          <div class="report-actions">
            <button class="btn sm" data-act="generate-report" data-report="${esc(r.name)}">Generate</button>
            <button class="btn ghost sm" data-act="export-report-pdf" data-report="${esc(r.name)}">PDF</button>
            <button class="btn ghost sm" data-act="export-report-excel" data-report="${esc(r.name)}">Excel</button>
            <button class="btn ghost sm" data-act="export-report-csv" data-report="${esc(r.name)}">CSV</button>
          </div>
        </div>`).join("")}
    </div>
  `)}

  ${panel("Comparison Report", "Compare farms or regions across two time periods", "", `
    <div class="compare-grid">
      <div class="filter-field">
        <label>Compare</label>
        <select id="cmpMode"><option>Farms</option><option>Regions</option><option>Provinces</option></select>
      </div>
      <div class="filter-field">
        <label>Metric</label>
        <select id="cmpMetric">
          <option>Water usage</option><option>Device uptime</option>
          <option>Maintenance jobs</option><option>Alert volume</option>
        </select>
      </div>
      <div class="filter-field"><label>Period A from</label><input type="date" id="cmpAFrom" value="2026-04-01" /></div>
      <div class="filter-field"><label>Period A to</label><input type="date" id="cmpATo" value="2026-05-31" /></div>
      <div class="filter-field"><label>Period B from</label><input type="date" id="cmpBFrom" value="2026-06-01" /></div>
      <div class="filter-field"><label>Period B to</label><input type="date" id="cmpBTo" value="2026-07-22" /></div>
    </div>
    <div class="filter-buttons" style="margin-top:12px">
      <button class="btn" data-act="run-comparison">Run comparison</button>
      <button class="btn ghost" data-act="export-comparison">Export result</button>
    </div>
    <div id="cmpResult" class="cmp-result"></div>
  `)}
  `;
}

/* =========================== PLATFORM ACTIVITY =========================== */

/** No activity-log table exists anywhere in the schema (see
    data/api.ts's getActivity()) - this is a genuine "not built yet", not
    an empty result to filter. No filter bar, no table: those would imply
    there's a real feature underneath with nothing in it right now. */
export async function activityPage(): Promise<string> {
  return `
  ${pageHeader("Platform Activity", "History of significant administrator and platform actions.")}

  ${panel("Not yet implemented", "", "", `
    <div class="empty-state">
      Platform Activity has no backing table yet - there is nowhere to
      record or read administrator actions from. This is a gap to build,
      not empty data.
    </div>
  `)}
  `;
}

/* ================================ SETTINGS =============================== */

export const SETTINGS_TABS: SettingsTab[] = [
  "General", "Notifications", "Platform Defaults", "Security", "Backup & Recovery",
];

export async function settingsPage(): Promise<string> {
  return `
  ${pageHeader("Settings", "Platform configuration, access policy and data retention.")}
  ${panel("Configuration", "", "", `
    <div class="tabs" role="tablist">
      ${SETTINGS_TABS.map((t, i) =>
        `<button class="tab ${i === 0 ? "active" : ""}" data-tab="${esc(t)}" role="tab">${esc(t)}</button>`).join("")}
      <span class="tab-underline" id="tabUnderline"></span>
    </div>
    <div id="settingsTabBody" class="tab-body"></div>
  `)}`;
}

function toggleRow(label: string, sub: string, on: boolean): string {
  return `<div class="set-row">
    <div><b>${esc(label)}</b><div class="sub">${esc(sub)}</div></div>
    <span class="toggle ${on ? "on" : ""}" data-toggle role="switch" aria-checked="${on}" tabindex="0"></span>
  </div>`;
}

export function settingsTabBody(tab: SettingsTab): string {
  const save = `<button class="btn" data-act="save-settings">Save changes</button>`;

  switch (tab) {
    case "General":
      return `<div class="fields">
        <label class="f">Platform name<input type="text" value="AgroFlow" /></label>
        <label class="f">Support email<input type="text" value="support@agroflow.co.za" /></label>
        <label class="f">Default province
          <select>${PROVINCES.map((p) => `<option${p === "Western Cape" ? " selected" : ""}>${esc(p)}</option>`).join("")}</select>
        </label>
        <label class="f">Units<select><option>Metric (L, °C, ha)</option><option>Imperial</option></select></label>
        <label class="f">Time zone<select><option>SAST (UTC+2)</option><option>UTC</option></select></label>
        <label class="f">Date format<select><option>YYYY-MM-DD</option><option>DD/MM/YYYY</option></select></label>
      </div><div class="form-foot">${save}</div>`;

    case "Notifications":
      return `<div class="set-rows">
        ${toggleRow("Email notifications", "Alert assignment and escalation notices", true)}
        ${toggleRow("SMS alerts", "Critical platform incidents only", true)}
        ${toggleRow("Daily operations digest", "Summary of open alerts and jobs at 07:00", true)}
        ${toggleRow("Weekly platform report", "Growth, connectivity and maintenance summary", false)}
        ${toggleRow("Farm approval requests", "Notify when a new farm awaits approval", true)}
        ${toggleRow("Failed job notifications", "Backup, sync and scheduled task failures", true)}
      </div><div class="form-foot">${save}</div>`;

    case "Platform Defaults":
      return `<div class="fields">
        <label class="f">Device offline threshold (minutes)<input type="number" value="30" min="5" /></label>
        <label class="f">Maintenance due warning (days)<input type="number" value="14" min="1" /></label>
        <label class="f">Alert auto-escalation (hours)<input type="number" value="24" min="1" /></label>
        <label class="f">Default report period<select><option>Last 30 days</option><option>This quarter</option><option>This year</option></select></label>
      </div>
      <div class="set-rows" style="margin-top:8px">
        ${toggleRow("Auto-assign alerts", "Route new alerts to the on-duty administrator", true)}
        ${toggleRow("Require approval for new farms", "New registrations enter Pending Approval", true)}
      </div>
      <div class="form-foot">${save}</div>`;

    case "Security":
      return `<div class="fields">
        <label class="f">Session timeout (minutes)<input type="number" value="30" min="5" /></label>
        <label class="f">Password minimum length<input type="number" value="12" min="8" /></label>
        <label class="f">Failed login lockout<input type="number" value="5" min="3" /></label>
      </div>
      <div class="set-rows" style="margin-top:8px">
        ${toggleRow("Require 2FA for administrators", "Enforced at next login", true)}
        ${toggleRow("Restrict admin access by IP", "Allow-list only", false)}
        ${toggleRow("Log all administrator actions", "Written to Platform Activity", true)}
      </div>
      <div class="form-foot">
        ${save}
        <button class="btn dark" data-act="manage-roles">Manage roles &amp; permissions</button>
      </div>`;

    case "Backup & Recovery":
      return `<div class="detail-list">
        <div class="detail-row"><span>Last cloud backup</span><b>2026-07-22 04:20</b></div>
        <div class="detail-row"><span>Last local backup</span><b>2026-07-22 03:55</b></div>
        <div class="detail-row"><span>Backup frequency</span><b>Hourly (local) · Daily (cloud)</b></div>
        <div class="detail-row"><span>Retention policy</span><b>30 days rolling</b></div>
        <div class="detail-row"><span>Storage used</span><b>82% of 500 GB</b></div>
      </div>
      ${meter(82, "warn")}
      <div class="form-foot">
        <button class="btn" data-act="backup-now">Back up now</button>
        <button class="btn dark" data-act="restore">Restore from backup</button>
        <button class="btn ghost" data-act="download-backup">Download archive</button>
      </div>`;
  }
}
