import { countExplanation } from "@/lib/why";
import { api, getFarmsNeedingSetup, getMqttPoolHealth, getFailedReportCount } from "@/data/api";
import { esc, fmtInt, fmtPct, fmtPct2, fmtDateTimeSast } from "@/lib/format";
import {
  badge, kpiCard, panel, barChart, lineChart, donut, table,
  pageHeader, routeLink,
} from "@/ui/components";
import { attentionQueue, withErrorState, type AttentionCard } from "@/ui/patterns";
import { healthPanelHtml } from "@/app/health";
import { Icon } from "@/lib/icons";

/* HOME — the queue of what needs a person, then the numbers.
 *
 * WHY THIS CHANGED
 * The dashboard used to open on twelve KPI tiles. Every one of them was a
 * fact and none of them was a task: an admin arriving in the morning could
 * read "3 Active Alerts" and still have no idea what to do first, or where
 * the alerts were. The tiles were also inert - the number told you something
 * was there, and then made you go and find it.
 *
 * So the first thing on the page is now a list of things WAITING FOR A
 * PERSON, each one a button that opens exactly that work. The KPI tiles are
 * still here, below, and every one of them is now clickable and lands on the
 * matching filtered list.
 */
export async function dashboardPage(): Promise<string> {
  return withErrorState("Home", renderDashboard);
}

async function renderDashboard(): Promise<string> {
  const [
    kpis, trends, growth, farmDist, hwDist,
    alerts, maintenance, requests, hardware,
    zonesNeedingSetup, mqttPool, failedReports,
  ] = await Promise.all([
    api.getKpis(), api.getTrends(), api.getGrowth(),
    api.getFarmHealthDistribution(), api.getHardwareStatusDistribution(),
    api.getAlerts(), api.getMaintenance(), api.getServiceRequests(), api.getHardware(),
    // Each of these is allowed to fail on its own: one unavailable queue
    // must not take down the whole of Home.
    getFarmsNeedingSetup().catch(() => []),
    getMqttPoolHealth().catch(() => null),
    getFailedReportCount().catch(() => 0),
  ]);

  const openAlerts = alerts.filter((a) => !["Resolved", "Closed"].includes(a.status));

  const criticalAlerts = openAlerts.filter(
    (a) => a.priority === "Critical" || a.priority === "High",
  );

  const newRequests = requests.filter((r) => r.status === "pending");

  // "Offline" here is the monitor service's judgement (hardware.status),
  // which is the one an admin should act on - a kit quiet long enough to be
  // worth a phone call, not one that missed a single reading.
  const kitsNeedingHelp = hardware.filter(
    (h) => h.status === "Offline" || h.status === "Fault",
  );

  const openJobs = maintenance.filter((m) => m.status !== "Completed").slice(0, 5);

  /* The queue. Order is by how much it costs to ignore: a farmer waiting on
     a request, then a crop at risk, then equipment, then setup gaps, then
     housekeeping. Cards with a count of zero are not rendered at all - an
     empty queue should look empty, not like a list of things that are fine. */
  const attention: AttentionCard[] = [
    {
      title: "New requests waiting",
      count: newRequests.length,
      body: "Farmers waiting to hear back about a new farm or zone.",
      act: "go-requests-pending",
      tone: "bad",
      icon: Icon.inbox,
      why: countExplanation({ label: "New requests waiting", what: "new farm or zone requests have had no reply yet", count: newRequests.length, counted: "service requests", rule: "A request counts here while its status is still pending.", whyHighlighted: "First in the queue: a farmer is waiting on a person.", clears: "Scheduling, completing or closing a request takes it off this count.", query: "service_request where status = pending" }),
    },
    {
      title: "Open critical alerts",
      count: criticalAlerts.length,
      body: "Zones or equipment needing attention now.",
      act: "go-alerts-critical",
      tone: "bad",
      icon: Icon.triangleAlert,
      why: countExplanation({ label: "Open critical alerts", what: "open alerts are marked Critical or High", count: criticalAlerts.length, counted: "alerts", rule: "An alert counts here while it is open (not Resolved or Closed) and its priority is Critical or High.", whyHighlighted: "A crop or a piece of equipment may need attention now.", clears: "Resolving the alert removes it.", query: "alert: status not in (Resolved, Closed) and priority in (Critical, High)" }),
    },
    {
      title: "Kits offline or faulty",
      count: kitsNeedingHelp.length,
      body: "Not reporting. The farm may be watering blind.",
      act: "go-kits-offline",
      tone: "warn",
      icon: Icon.radio,
      why: countExplanation({ label: "Kits offline or faulty", what: "kits are Offline or Fault", count: kitsNeedingHelp.length, counted: "kits", rule: "The equipment monitor marks a kit Offline when it has sent nothing for its offline window, and Fault when a fault was recorded.", whyHighlighted: "A farm with a quiet kit may be watering blind.", clears: "The kit sending readings again, or a technician clearing the fault.", query: "hardware.status in (Offline, Fault) - set by DeviceStatusMonitorService" }),
    },
    {
      title: "Zones missing setup",
      count: zonesNeedingSetup.length,
      // Item 2: advice is never blocked by missing setup any more - it is
      // only less certain - so this no longer says the engine cannot advise.
      body: "No planting date, area, flow rate or location - advice is less certain until added.",
      act: "go-zones-setup",
      tone: "warn",
      icon: Icon.sprout,
      why: countExplanation({ label: "Zones missing setup", what: "zones are missing part of their setup", count: zonesNeedingSetup.length, counted: "zones", rule: "A zone counts when it has no crop, planting date, area or flow rate, or its farm has no location.", whyHighlighted: "Advice for these zones is less certain until the missing detail is added.", clears: "Filling in the missing detail on the zone or the farm.", query: "zone: crop_type, planting_date, area_m2 or flow_rate_lpm null; or farm latitude/longitude null" }),
    },
    {
      title: "Farmers without Telegram",
      count: kpis.farmersNotReceivingAlerts,
      body: "They get no alerts at all until they connect.",
      act: "go-users-no-telegram",
      tone: "warn",
      icon: Icon.userX,
      why: countExplanation({ label: "Farmers without Telegram", what: "farmers have not connected Telegram", count: kpis.farmersNotReceivingAlerts, counted: "farmer accounts", rule: "A farmer counts here when no Telegram chat is linked to their account.", whyHighlighted: "They get no frost, heat or equipment alerts at all.", clears: "The farmer connecting Telegram from the app or with a link code.", query: "profile.telegram_chat_id is null (farmers)" }),
    },
    {
      title: "MQTT logins running low",
      // The card is about the shortage, so the count is how many are LEFT.
      count: mqttPool?.runningLow ? Math.max(mqttPool.freeCount, 1) : 0,
      body: mqttPool?.runningLow
        ? `Only ${mqttPool.freeCount} free. New kits will fall back to the shared login.`
        : "",
      act: "go-mqtt-logins",
      tone: "info",
      icon: Icon.wifi,
      why: countExplanation({ label: "MQTT logins running low", what: "free MQTT logins are left", count: mqttPool?.runningLow ? Math.max(mqttPool.freeCount, 1) : 0, counted: "MQTT login pool", rule: "Shown when the pool of unassigned broker logins is running low.", whyHighlighted: "New kits fall back to the shared login when none are free.", clears: "Adding logins to the pool on the MQTT logins page.", query: "mqtt_credential_pool: unassigned, not burned" }),
    },
    {
      title: "Failed reports",
      count: failedReports,
      body: "A farmer asked for a report and it could not be made.",
      act: "go-reports-failed",
      tone: "info",
      icon: Icon.barChart,
      why: countExplanation({ label: "Failed reports", what: "requested reports could not be made", count: failedReports, counted: "report requests", rule: "A report request counts here when its status is failed.", whyHighlighted: "A farmer asked for a report and did not get it.", clears: "Re-running the report from the Reports page.", query: "report_request where status = failed" }),
    },
  ];

  return `
  ${pageHeader("Home", "What needs attention today, across every farm.",
    `<button class="btn ghost" data-act="export-dashboard">Export to Excel</button>
     <button class="btn ghost" data-act="export-dashboard-pdf">Export PDF</button>`)}

  <section class="attn-section" aria-labelledby="attnHeading">
    <h3 id="attnHeading" class="section-heading">Needs attention</h3>
    ${attentionQueue(attention)}
  </section>

  <h3 class="section-heading">At a glance</h3>

  <!-- Every tile is a link to the list it counts. A number you cannot click
       makes the admin go and find the thing it refers to. -->
  <div class="grid kpis">
    ${kpiCard({ label: "Farms", value: kpis.totalFarms, trend: trends["totalFarms"] ?? undefined, icon: Icon.tractor, act: "go-farms", why: { counts: "farms are registered", rule: "Every farm on the platform. Archived farms are left out unless \"Show archived\" is on in Farms.", query: "farm (archived = status Inactive, hidden by default)" } })}
    ${kpiCard({ label: "Farmers", value: kpis.totalUsers, trend: trends["totalUsers"] ?? undefined, icon: Icon.users, act: "go-users", why: { counts: "farmer accounts exist", rule: "Every farmer account, active or disabled.", query: "profile where role = farmer" } })}
    ${kpiCard({ label: "Kits online", value: kpis.connectedHardware, format: "ratio", total: fmtInt(kpis.totalHardware), trend: trends["connectedHardware"] ?? undefined, icon: Icon.radio, act: "go-kits", why: { counts: "kits are online", rule: "A kit counts as online while the equipment monitor has heard from it inside its offline window.", query: "hardware.status = Online, out of all hardware" } })}
    ${kpiCard({ label: "Open alerts", value: kpis.activeAlerts, trend: trends["activeAlerts"] ?? undefined, icon: Icon.bell, act: "go-alerts", why: { counts: "alerts are open", rule: "Every alert that is not Resolved or Closed, at any priority.", query: "alert.status not in (Resolved, Closed)", clears: "Resolving alerts." } })}
    ${kpiCard({ label: "Open maintenance", value: kpis.openMaintenance, trend: trends["openMaintenance"] ?? undefined, icon: Icon.wrench, act: "go-maintenance", why: { counts: "maintenance jobs are not completed", rule: "Every maintenance job whose status is anything but Completed.", query: "maintenance.status <> Completed", clears: "Completing the job." } })}
    ${kpiCard({ label: "Requests waiting", value: newRequests.length, icon: Icon.inbox, act: "go-requests-pending", why: { counts: "requests are waiting for a reply", rule: "Requests whose status is still pending.", query: "service_request.status = pending", clears: "Scheduling, completing or closing the request." } })}
  </div>

  <!-- Health, from GET /api/admin/health. Rendered server-truthfully: a
       check that cannot be read says so rather than showing a green dot. -->
  <div id="healthPanel">${await healthPanelHtml()}</div>

  <div class="grid split-2">
    ${panel("Growth", "New farmers and farms per month", routeLink("reports", "Full reports →"), `
      <div class="chart-legend">
        <span><i class="sw" style="background:#22c55e"></i>Farmers</span>
        <span><i class="sw" style="background:#38bdf8"></i>Farms</span>
      </div>
      ${lineChart(growth.users, "#22c55e")}
      ${lineChart(growth.farms, "#38bdf8")}
    `)}
    ${panel("Farm health", "Across all registered farms", routeLink("farms", "View farms →"),
      donut(farmDist, ["#22c55e", "#f59e0b", "#ef4444"]))}
  </div>

  <div class="grid split-2">
    ${panel("Kit connectivity", "Hardware status distribution", routeLink("hardware", "View kits →"),
      donut(hwDist, ["#22c55e", "#f59e0b", "#94a3b8", "#ef4444"]))}
    ${panel("Maintenance trend", "Jobs raised per month", "", `
      <div class="chart-legend">
        <span><i class="sw" style="background:#f59e0b"></i>Maintenance</span>
      </div>
      ${barChart(growth.maintenance)}
    `)}
  </div>

  <div class="grid split-2">
    ${panel("Priority alerts", "Needing an administrator", routeLink("alerts", "View all →"),
      table(["Raised", "Alert", "Farm", "Priority", "Status"],
        criticalAlerts.slice(0, 6), (a) => [
          esc(fmtDateTimeSast(a.raised)),
          `<a href="#" data-act="view-alert" data-id="${esc(a.id)}">${esc(a.title)}</a>`,
          esc(a.farm ?? "No farm (test data)"),
          badge(a.priority),
          badge(a.status),
        ], "No open critical alerts."))}

    ${panel("Open maintenance", "Scheduled and overdue jobs", routeLink("maintenance", "View all →"),
      table(["Device", "Farm", "Technician", "Status"], openJobs, (m) => [
        `<span class="mono">${esc(m.device)}</span>`,
        esc(m.farm),
        m.technician ? esc(m.technician) : `<span class="muted">Unassigned</span>`,
        badge(m.status),
      ], "No open maintenance."))}
  </div>

  <p class="page-note">${esc(
    `${fmtInt(kpis.activeUsers)} active accounts · ${fmtInt(kpis.disabledUsers)} disabled` +
    (kpis.platformAvailability > 0 ? ` · platform availability ${fmtPct2(kpis.platformAvailability)}` : ""),
  )}</p>
  `;
}

/* Kept for the uptime row in the health panel. */
export { fmtPct };
