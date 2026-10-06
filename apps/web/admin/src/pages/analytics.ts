import { getAdminProfile } from "@/app/auth";
import { api } from "@/data/api";
import { esc, fmtInt, fmtDate, fmtLitres, fmtDateTimeSast } from "@/lib/format";
import { getFilter, applyFilters, rangeLabel } from "@/lib/filters";
import {
  PROVINCES, REGIONS, CROPS,
} from "@/data/referenceData";
import {
  kpiCard, panel, table, pageHeader, filterBar, resultCount,
  lineChart, barChart, donut,
} from "@/ui/components";
import type { IrrigationEvent, SeriesPoint, SettingsTab } from "@/types/models";
import { Icon } from "@/lib/icons";
import { emptyState, withErrorState } from "@/ui/patterns";
import { getActivityLog, type AuditRow } from "@/services/agroFlowApi";
import { getReportFarms, type ReportFarm } from "@/services/agroFlowApi";
import { getAttentionThisWeek, type AttentionGroup } from "@/data/api";

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
  const events = await api.getIrrigationEvents();
  const f = getFilter("irrigation");

  const filteredEvents = applyFilters(events, f, {
    search: (e) => `${e.farm} ${e.zone} ${e.crop}`,
    date: (e) => e.date,
    farm: (e) => e.farm,
    province: (e) => e.province,
    region: (e) => e.region,
    crop: (e) => e.crop,
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
    ${kpiCard({ label: "Water delivered", value: Math.round(totalLitres / 1000), format: "int", trend: { dir: "up", text: "kL in range (estimated)" }, icon: Icon.droplet, why: { counts: "kilolitres were delivered in this range (estimated)", rule: "Pump run time times each zone flow rate, summed over the irrigation events in the chosen range. There is no flow meter, so this is an estimate.", query: "sum(runtime_seconds / 60 x zone.flow_rate_lpm) over filtered irrigation_event / 1000" } })}
    ${kpiCard({ label: "Irrigation events", value: filteredEvents.length, icon: Icon.repeat, why: { counts: "pump runs are in this range", rule: "Every irrigation event in the chosen range and filters.", query: "count(irrigation_event) filtered" } })}
    ${kpiCard({ label: "Total pump time", value: Math.round(totalMinutes / 60), trend: { dir: "up", text: "hours" }, icon: Icon.timer, why: { counts: "hours of pump time are in this range", rule: "Pump run time of every irrigation event in the chosen range, in hours.", query: "sum(runtime_seconds) / 3600 over filtered irrigation_event" } })}
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
        why: { counts: "per cent of these events can be turned into litres", rule: "An event can be estimated when its zone has a flow rate on file.", highlighted: "Litre totals leave out the rest.", query: "share of filtered irrigation_event whose zone.flow_rate_lpm is set", clears: "Setting a flow rate on the zones that have none." },
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

  ${
    /* This was a table of schedules with a Cadence, a Compliance meter and
       View/Edit/Delete links. It could never have a row in it: the
       irrigation_schedule table it read was DROPPED in migration 0010, and
       schedules have lived as columns on the zone itself ever since - one per
       zone, not a list. So the panel rendered an empty table under a heading
       promising something, and an admin reading it would conclude no farm had
       a schedule, which is the opposite of true.

       An empty table is not mock data, but it is a false impression, and the
       fix is the same: say what is actually the case and where to go. */
    panel("Watering schedules", "", "", `
      <p>
        Each zone has its own watering schedule, set on the zone rather than kept in a
        separate list. Open a zone from <b>Farms &amp; zones</b> to see or change its
        start time, how long it runs, and whether it waters automatically.
      </p>
      <p class="muted">
        Farmers set these from the app for their own zones. The schedule a zone is on
        is shown on its detail panel, next to the moisture threshold the engine uses.
      </p>`)
  }

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

/* Item 4: the Reports page is about farms, not about the platform.
 *
 * It used to open on ten generic report cards (Device Performance, Support
 * Performance, Hardware Downtime...). "Generate" only showed a message, and
 * every card's Excel exported the same irrigation table whatever its name.
 * Those are gone. What is left all produces real numbers: farm reports
 * (preview = the PDF itself), the farms that need attention this week, a
 * farm's automatic reports, a water-use comparison, and growth charts
 * counted from the records. */

const FARM_KEY = "agroflow.reports.farm";

export function rememberReportFarm(farmId: number): void {
  try { localStorage.setItem(FARM_KEY, String(farmId)); } catch { /* storage unavailable: no pre-fill next time */ }
}

function preferredFarm(farms: ReportFarm[]): number | null {
  let remembered: number | null = null;
  try { remembered = Number(localStorage.getItem(FARM_KEY)) || null; } catch { remembered = null; }
  if (remembered && farms.some((f) => f.farm_id === remembered)) return remembered;
  // No farm picked before: the newest farm, which is the one most likely
  // being set up and checked.
  return farms.length ? Math.max(...farms.map((f) => f.farm_id)) : null;
}

function farmReportsPanel(farms: ReportFarm[] | null, chosen: number | null): string {
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const to = new Date(Date.now() + 2 * 3600_000);
  const from = new Date(to.getTime() - 6 * 86_400_000);

  const body = farms === null
    ? `<div class="empty-state">The farm list could not load. Check that you are signed in as an administrator and that the API is running.</div>`
    : farms.length === 0
      ? `<div class="empty-state">No farms yet. Reports appear here once a farm has been registered.</div>`
      : `
    <div class="compare-grid">
      <div class="filter-field"><label>Farm</label>
        <select id="liveFarm">${farms.map((f) =>
          `<option value="${f.farm_id}" ${f.farm_id === chosen ? "selected" : ""}>${esc(f.name)}${f.owner_name ? " · " + esc(f.owner_name) : ""}</option>`).join("")}</select></div>
      <div class="filter-field"><label>Zone</label>
        <select id="liveZone"><option value="">All zones</option></select></div>
      <div class="filter-field"><label>Period</label>
        <select id="livePeriod">
          <option value="7" selected>Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="custom">Choose dates</option>
        </select></div>
      <div class="filter-field"><label>Report</label>
        <select id="liveType">
          <option value="water-usage">Water usage</option>
          <option value="moisture">Soil moisture (one zone)</option>
          <option value="schedule">Watering schedule &amp; advice (last 7 days and the week ahead)</option>
        </select></div>
      <div class="filter-field live-custom" hidden><label>From</label><input type="date" id="liveFrom" value="${iso(from)}" /></div>
      <div class="filter-field live-custom" hidden><label>To</label><input type="date" id="liveTo" value="${iso(to)}" /></div>
    </div>
    <div class="filter-buttons" style="margin-top:12px">
      <button class="btn sm" data-act="farm-report-preview">Preview</button>
      <button class="btn ghost sm" data-act="farm-report-pdf">PDF</button>
      <button class="btn ghost sm" data-act="farm-report-xlsx">Excel</button>
      <span class="muted" style="margin-left:8px">Excel is the water-usage figures. Preview is the PDF itself.</span>
    </div>
    <div id="liveReportResult" class="cmp-result"></div>`;

  return panel("Farm reports", "What the farmer receives: actions first, then how the farm did. Water is estimated from pump run time x flow rate.", "", body);
}

function attentionPanel(groups: AttentionGroup[] | null): string {
  if (groups === null) {
    return panel("Farms needing attention this week", "", "",
      `<div class="empty-state">This week's advice could not be read. It appears here once the advice engine has run for the farms.</div>`);
  }

  const live = groups.filter((g) => g.farms > 0);
  const body = live.length === 0
    ? `<div class="empty-state">Nothing this week: no farm has crops short of water, over-watering, a faulty kit or unfinished setup in the last 7 days of advice.</div>`
    : `<ul class="attn-list">${live.map((g) => `
        <li><button type="button" class="link-btn" data-act="view-attention" data-id="${esc(g.key)}">
          <b>${g.farms}</b> ${esc(g.farms === 1 ? g.label.replace(/^farms /, "farm ") : g.label)}
        </button></li>`).join("")}</ul>`;

  return panel("Farms needing attention this week",
    "From the same advice the farmers see. Click a line for the farms and zones behind it.", "", body);
}

function autoReportsPanel(farms: ReportFarm[] | null, chosen: number | null): string {
  if (!farms || chosen === null) return "";
  return panel("Automatic reports", "Daily, weekly or monthly PDFs on Telegram for the farm chosen above.", "", `
    <div id="autoReportsSummary" class="muted">Loading this farm's automatic reports…</div>
    <div class="filter-buttons" style="margin-top:12px">
      <button class="btn sm" data-act="edit-auto-reports" data-id="${chosen}" id="autoReportsEdit">Set up automatic reports</button>
    </div>`);
}

function comparisonPanel(): string {
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const day = 86_400_000;
  const now = Date.now() + 2 * 3600_000;
  return panel("Water use comparison", "Estimated water delivered, two periods side by side. Events on zones with no flow rate have no estimate and are left out.", "", `
    <div class="compare-grid">
      <div class="filter-field">
        <label>Compare</label>
        <select id="cmpMode"><option>Farms</option><option>Regions</option><option>Provinces</option></select>
      </div>
      <div class="filter-field"><label>Period A from</label><input type="date" id="cmpAFrom" value="${iso(new Date(now - 59 * day))}" /></div>
      <div class="filter-field"><label>Period A to</label><input type="date" id="cmpATo" value="${iso(new Date(now - 30 * day))}" /></div>
      <div class="filter-field"><label>Period B from</label><input type="date" id="cmpBFrom" value="${iso(new Date(now - 29 * day))}" /></div>
      <div class="filter-field"><label>Period B to</label><input type="date" id="cmpBTo" value="${iso(new Date(now))}" /></div>
    </div>
    <div class="filter-buttons" style="margin-top:12px">
      <button class="btn" data-act="run-comparison">Run comparison</button>
      <button class="btn ghost" data-act="export-comparison">Export result</button>
    </div>
    <div id="cmpResult" class="cmp-result"></div>`);
}

export async function reportsPage(): Promise<string> {
  const [growth, farms, attention] = await Promise.all([
    api.getGrowth(),
    getReportFarms().catch(() => null),
    getAttentionThisWeek().catch(() => null),
  ]);
  const chosen = farms ? preferredFarm(farms) : null;

  return `
  ${pageHeader("Reports", "Farm reports, automatic reports, and the farms that need attention this week.")}

  ${farmReportsPanel(farms, chosen)}

  <div class="grid split-2">
    ${attentionPanel(attention)}
    ${autoReportsPanel(farms, chosen)}
  </div>

  ${comparisonPanel()}

  <div class="grid split-2">
    ${panel("New farmers and farms", "Per month, last 12 months", "", `
      <div class="chart-legend">
        <span><i class="sw" style="background:#22c55e"></i>Farmers</span>
        <span><i class="sw" style="background:#38bdf8"></i>Farms</span>
      </div>
      ${growth.users.length || growth.farms.length
        ? lineChart(growth.users, "#22c55e") + lineChart(growth.farms, "#38bdf8")
        : `<div class="empty-state">No farmer or farm has joined in the last 12 months.</div>`}`)}
    ${panel("Maintenance jobs", "Per month, last 12 months", "",
      growth.maintenance.length
        ? barChart(growth.maintenance)
        : `<div class="empty-state">No maintenance job is dated in the last 12 months.</div>`)}
  </div>
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
