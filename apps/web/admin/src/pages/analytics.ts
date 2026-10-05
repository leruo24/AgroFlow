import { getAdminProfile } from "@/app/auth";
import { api } from "@/data/api";
import { esc, fmtInt, fmtDate, fmtPct, fmtLitres, fmtDateTimeSast } from "@/lib/format";
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
import { emptyState, withErrorState } from "@/ui/patterns";
import { getActivityLog, type AuditRow } from "@/services/agroFlowApi";
import { getReportFarms, type ReportFarm } from "@/services/agroFlowApi";

/* ============================ IRRIGATION DATA ============================ */
/* Historical analytics for administrators — NOT live irrigation control.   */

/* Only events whose zone HAS a flow rate can be added up.
 *
 * IrrigationEvent.litres is null when the zone has no rate on file, and
 * migration 0018 is explicit that this must read as "no estimate available"
 * rather than as zero. Treating null as 0 in a sum is the same mistake in a
 * subtler place: it silently drags a month's total down and the chart shows a
 * dip that never happened. These are left out of the figures instead, and the
 * page says how many were left out. */
function estimable(events: IrrigationEvent[]): (IrrigationEvent & { litres: number })[] {
  return events.filter((e): e is IrrigationEvent & { litres: number } => e.litres !== null);
}

function groupByMonth(events: IrrigationEvent[]): SeriesPoint[] {
  const map = new Map<string, number>();
  for (const e of estimable(events)) {
    const key = e.date.slice(0, 7);
    map.set(key, (map.get(key) ?? 0) + e.litres);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => ({ label: k.slice(5), value: Math.round(v / 1000) }));
}

function groupByFarm(events: IrrigationEvent[]): SeriesPoint[] {
  const map = new Map<string, number>();
  for (const e of estimable(events)) map.set(e.farm, (map.get(e.farm) ?? 0) + e.litres);
  return [...map.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([k, v]) => ({ label: k.split(" ")[0] ?? k, value: Math.round(v / 1000) }));
}

function groupByRegion(events: IrrigationEvent[]): Record<string, number> {
  const map: Record<string, number> = {};

  for (const e of estimable(events)) {
    // "No region on file", not "": an empty key rendered as a nameless slice
    // of the donut that nobody could identify.
    const key = e.region || "No region on file";
    map[key] = (map[key] ?? 0) + e.litres;
  }

  // Rounded to kL once, at the end. Rounding each event first and then
  // summing lost most of the volume: a 400 L event rounds to 0 kL, so a
  // region watering in short bursts reported almost nothing.
  for (const key of Object.keys(map)) {
    map[key] = Math.round((map[key] ?? 0) / 1000);
  }

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

  const withEstimate = estimable(filteredEvents);
  const noEstimate = filteredEvents.length - withEstimate.length;

  const totalLitres = withEstimate.reduce((a, e) => a + e.litres, 0);
  const totalMinutes = filteredEvents.reduce((a, e) => a + e.durationMin, 0);

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
    ${kpiCard({ label: "Water delivered", value: Math.round(totalLitres / 1000), format: "int", trend: { dir: "up", text: "kL in range (estimated)" }, icon: Icon.droplet })}
    ${kpiCard({ label: "Irrigation events", value: filteredEvents.length, icon: Icon.repeat })}
    ${kpiCard({ label: "Total pump time", value: Math.round(totalMinutes / 60), trend: { dir: "up", text: "hours" }, icon: Icon.timer })}
    ${
      /* This tile used to read "Schedule Compliance" and show a percentage
         computed from a field that was hardcoded true - so it always said
         100%. Nothing in the schema records whether an irrigation ran to
         schedule, so the honest tile is the one that says how much of this
         range can be estimated at all. */
      kpiCard({
        label: "Events we can estimate",
        value: filteredEvents.length ? (withEstimate.length / filteredEvents.length) * 100 : 0,
        format: "pct",
        trend: noEstimate > 0
          ? { dir: "down", text: `${noEstimate} zone(s) have no flow rate set` }
          : undefined,
        icon: Icon.circleCheck,
      })
    }
  </div>

  ${
    noEstimate > 0
      ? `<div class="notice">
           ${noEstimate} of these ${filteredEvents.length} events are not in the water figures:
           their zone has no flow rate on file, so no volume can be estimated for them.
           Set a flow rate on the zone and they will be included.
         </div>`
      : ""
  }

  <div class="grid split-2">
    ${panel("Monthly Irrigation Trend", `Estimated water delivered per month (kL) · ${rangeLabel(f)}`, "",
      monthly.length ? lineChart(monthly, "#38bdf8") : `<div class="empty-state">No irrigation events in this range.</div>`)}
    ${panel("Regional Comparison", "Estimated water delivered by region (kL)", "",
      Object.keys(byRegion).length ? donut(byRegion, ["#22c55e", "#38bdf8", "#f59e0b", "#a78bfa", "#ef4444"])
        : `<div class="empty-state">No data.</div>`)}
  </div>

  ${panel("Water Usage by Farm", "Top farms by estimated volume delivered (kL)", "",
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
    table(["Date (SAST)", "Farm", "Zone", "Crop", "Estimated volume", "Pump time"], recent, (e) => [
      fmtDate(e.date),
      esc(e.farm),
      esc(e.zone),
      esc(e.crop || "No crop set"),
      // Never "0 L" for a zone with no flow rate: a zero reads as a pump
      // that ran and delivered nothing.
      e.litres === null
        ? `<span class="muted" title="This zone has no flow rate on file, so no volume can be estimated.">No estimate</span>`
        : fmtLitres(e.litres),
      `${fmtInt(e.durationMin)} min`,
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
  { id: "water-usage", name: "Water Usage Trends", desc: "Estimated volume delivered by farm and region", icon: Icon.barChart },
];

function liveReportsPanel(farms: ReportFarm[] | null): string {
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const to = new Date();
  const from = new Date(Date.now() - 30 * 86400000);

  const body = farms === null
    ? `<div class="empty-state">The live farm list could not load. Check that you are signed in as an administrator and that the API is running.</div>`
    : `
    <div class="compare-grid">
      <div class="filter-field"><label>Farm</label>
        <select id="liveFarm"><option value="">Select a farm</option>${farms.map((f) =>
          `<option value="${f.farm_id}">${esc(f.name)}${f.owner_name ? " · " + esc(f.owner_name) : ""}</option>`).join("")}</select></div>
      <div class="filter-field"><label>Zone (moisture report only)</label>
        <select id="liveZone"><option value="">Select a farm first</option></select></div>
      <div class="filter-field"><label>From</label><input type="date" id="liveFrom" value="${iso(from)}" /></div>
      <div class="filter-field"><label>To</label><input type="date" id="liveTo" value="${iso(to)}" /></div>
    </div>
    ${[
      ["moisture", "Moisture and irrigation over time"],
      ["water-usage", "Water usage - all zones, or pick one (estimated)"],
      ["schedule", "Suggested 7-day irrigation schedule"],
    ].map(([id, label]) => `
      <div class="filter-buttons" style="margin-top:12px">
        <span style="min-width:260px;display:inline-block">${esc(label ?? "")}</span>
        <button class="btn sm" data-act="live-report-view" data-report="${id}">View</button>
        <button class="btn ghost sm" data-act="live-report-pdf" data-report="${id}">PDF</button>
        ${
          // Only water usage has a workbook: it is the report with a table of
          // numbers somebody wants to chart or paste. A schedule is advice
          // and a moisture report is a trace - neither is improved by being
          // a spreadsheet.
          id === "water-usage"
            ? `<button class="btn ghost sm" data-act="live-report-xlsx" data-report="${id}">Excel</button>`
            : ""
        }
      </div>`).join("")}
    <div id="liveReportResult" class="cmp-result"></div>`;

  return panel("Farm Reports (live data)",
    "Real sensor, weather and irrigation records. Water figures are estimated: pump run time x zone flow rate.", "", body);
}

export async function reportsPage(): Promise<string> {
  const [growth, kpis, events, maintenance] = await Promise.all([
    api.getGrowth(), api.getKpis(), api.getIrrigationEvents(), api.getMaintenance(),
  ]);
  const f = getFilter("reports");
  const liveFarms = await getReportFarms().catch(() => null);

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

  // estimable(), not a plain sum: an event whose zone has no flow rate has
  // no volume to add, and counting it as 0 would quietly lower the figure.
  const waterInRange = estimable(filteredEvents).reduce((a, e) => a + e.litres, 0);

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
    ${liveReportsPanel(liveFarms)}
  `;
}

/* =========================== PLATFORM ACTIVITY =========================== */

/* The audit log (migration 0037): who did what, newest first.
 *
 * Every row is one sentence, built on the SERVER so this page, the CSV and
 * the XLSX cannot describe the same action three different ways. */
export async function activityPage(): Promise<string> {
  return withErrorState("Activity", async () => {
    const f = getFilter("activity");

    const log = await getActivityLog({
      // eventType and administrator already exist on FilterState and mean
      // exactly this, so the activity page reuses them rather than widening
      // the shared shape with two near-duplicates.
      ...(f.eventType ? { action: f.eventType } : {}),
      ...(f.administrator ? { actor: f.administrator } : {}),
    });

    if (log.rows.length === 0) {
      return `
      ${pageHeader("Activity", "Who did what, across the platform.")}
      ${emptyState({
        title: "No activity recorded yet",
        body:
          "Every status change, assignment, revoke and archive is recorded here with who did it " +
          "and when, from the moment the activity log table is in place.",
      })}`;
    }

    return `
    ${pageHeader("Activity", "Who did what, across the platform.",
      `<button class="btn ghost" data-act="export-activity-csv">Export CSV</button>
       <button class="btn ghost" data-act="export-activity-xlsx">Export Excel</button>`)}

    ${filterBar({
      page: "activity",
      filter: f,
      searchPlaceholder: "Search this page…",
      selects: [
        { key: "eventType", label: "Action", options: log.actions.map((a) => a.label) },
        { key: "administrator", label: "Administrator", options: log.actors.map((a) => a.label) },
      ],
    })}

    ${panel("Administrator actions", "Newest first",
      resultCount(log.rows.length, log.total, "actions"),
      table(["When", "Who", "What", "Farm"], log.rows, (r) => [
        esc(fmtDateTimeSast(r.createdAt)),
        esc(r.actorName),
        // The summary already names the actor; the What column carries the
        // action so the two columns are not the same sentence twice.
        esc(r.summary.replace(new RegExp("^" + r.actorName + "\\s*"), "")),
        r.farmName ? esc(r.farmName) : `<span class="muted">—</span>`,
      ], "No actions match the current filters."))}
    `;
  });
}

/* A timeline for one item, oldest first - the shape a person reads a history
   in, which is the opposite of the activity list above. */
export function timelineHtml(rows: AuditRow[], emptyText: string): string {
  if (rows.length === 0) return `<p class="muted">${esc(emptyText)}</p>`;

  return `<ol class="timeline">${rows
    .map(
      (r) => `
      <li class="timeline-item">
        <span class="timeline-dot" aria-hidden="true"></span>
        <div>
          <b>${esc(r.summary)}</b>
          <span class="timeline-when">${esc(fmtDateTimeSast(r.createdAt))}</span>
        </div>
      </li>`,
    )
    .join("")}</ol>`;
}

/* ================================ SETTINGS =============================== */

/* Three tabs, down from five.
 *
 * "General", "Notifications", "Platform Defaults" and "Security" are gone
 * entirely. Between them they held about twenty fields, and not one was read
 * by anything - no settings table exists in this schema. Removing them is the
 * honest half of item 2; the other half is that the thresholds which ARE real
 * were invisible, and now are not. */
export const SETTINGS_TABS: SettingsTab[] = [
  "My account", "Platform thresholds", "Backup & Recovery",
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


export function settingsTabBody(tab: SettingsTab): string {
  switch (tab) {
    /* Everything here writes somewhere real: profile goes to
       PUT /api/farmer/profile, the password goes to Supabase Auth, and
       Telegram goes to /api/telegram/me. */
    case "My account": {
      const profile = getAdminProfile();

      return `
      <div class="settings-block">
        <h4>Your details</h4>
        <p class="muted">Signed in as ${esc(profile?.email ?? "an administrator")}.</p>
        <div class="fields">
          <label class="f">Full name
            <input type="text" data-field="myName" value="${esc(profile?.name ?? "")}" />
          </label>
          <label class="f">Phone number
            <input type="text" data-field="myPhone" placeholder="+27 82 000 0000" />
          </label>
        </div>
        <div class="form-foot">
          <button class="btn" data-act="save-my-profile">Save my details</button>
        </div>
      </div>

      <div class="settings-block">
        <h4>Password</h4>
        <p class="muted">
          Changes your sign-in password immediately. You stay signed in on this computer;
          anywhere else you are signed in will need the new one.
        </p>
        <div class="fields">
          <label class="f">New password
            <input type="password" data-field="newPassword" autocomplete="new-password" />
          </label>
          <label class="f">Type it again
            <input type="password" data-field="newPasswordAgain" autocomplete="new-password" />
          </label>
        </div>
        <div class="form-foot">
          <button class="btn" data-act="change-my-password">Change password</button>
        </div>
      </div>

      <div class="settings-block">
        <h4>Telegram</h4>
        <div id="myTelegramStatus">
          <p class="muted">Checking…</p>
        </div>
      </div>`;
    }

    case "Platform thresholds":
      // Filled by loadPlatformThresholds() once the tab renders - these come
      // from the API, which reads the same configuration the services do, so
      // the page cannot drift from what is actually running.
      return `<div id="platformThresholds"><p class="muted">Loading…</p></div>`;

    /* This tab used to state a last cloud backup time, a last local backup
       time, a retention policy and "82% of 500 GB", with a meter drawn from
       that 82 - all of it invented. None of those numbers came from anywhere;
       there is no backup system in this project to report on, and no local
       storage to be 82% full. Three buttons underneath claimed to start a
       backup, restore one and download an archive, and did none of it.

       Fabricated facts are worse than a gap: somebody could have read that
       line and concluded the data was safe. What follows is what is actually
       true about where AgroFlow's data lives. */
    case "Backup & Recovery":
      return `<div class="detail-list">
        <div class="detail-row"><span>Where the data lives</span><b>Supabase Postgres</b></div>
        <div class="detail-row"><span>Who backs it up</span><b>Supabase, on the project's plan</b></div>
        <div class="detail-row"><span>Managed from</span><b>The Supabase dashboard, not here</b></div>
      </div>
      <p class="muted">
        Backups and point-in-time recovery are part of the Supabase project and are configured in
        the Supabase dashboard under Database → Backups. AgroFlow holds no separate copy of the
        data and has nothing of its own to back up or restore, so there is nothing to start from
        this page.
      </p>
      <p class="muted">
        Two things in AgroFlow are deliberately never deleted and so need no backup of their own:
        archiving a farm hides it and keeps every row (migration 0036), and the administrator
        activity log cannot be updated or deleted at all (migration 0037).
      </p>`;
  }
}
