import { api } from "@/data/api";
import { esc, fmtInt, fmtPct, fmtPct2 } from "@/lib/format";
import {
  badge, kpiCard, panel, barChart, lineChart, donut, table,
  pageHeader, routeLink, meter,
} from "@/ui/components";

export async function dashboardPage(): Promise<string> {
  const [kpis, trends, growth, health, farmDist, hwDist, alerts, maintenance, activity] =
    await Promise.all([
      api.getKpis(), api.getTrends(), api.getGrowth(), api.getSystemHealth(),
      api.getFarmHealthDistribution(), api.getHardwareStatusDistribution(),
      api.getAlerts(), api.getMaintenance(), api.getActivity(),
    ]);

  const openAlerts = alerts
    .filter((a) => !["Resolved", "Closed"].includes(a.status))
    .sort((a, b) => {
      const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      return order[a.priority] - order[b.priority];
    })
    .slice(0, 6);

  const openJobs = maintenance.filter((m) => m.status !== "Completed").slice(0, 5);
  const recentActivity = activity.slice(0, 7);

  return `
  ${pageHeader("Dashboard", "Platform oversight across all farms, users and hardware.",
    `<button class="btn ghost" data-act="export-dashboard">Export summary</button>`)}

  <div class="grid kpis">
    ${kpiCard({ label: "Total Farms", value: kpis.totalFarms, trend: trends["totalFarms"] ?? undefined, icon: "🚜" })}
    ${kpiCard({ label: "Total Users", value: kpis.totalUsers, trend: trends["totalUsers"] ?? undefined, icon: "👥" })}
    ${kpiCard({ label: "Connected Hardware", value: kpis.connectedHardware, format: "ratio", total: fmtInt(kpis.totalHardware), trend: trends["connectedHardware"] ?? undefined, icon: "📡" })}
    ${kpiCard({ label: "Active Alerts", value: kpis.activeAlerts, trend: trends["activeAlerts"] ?? undefined, icon: "🚨" })}
    ${kpiCard({ label: "Open Maintenance", value: kpis.openMaintenance, trend: trends["openMaintenance"] ?? undefined, icon: "🛠️" })}
    ${kpiCard({ label: "System Uptime", value: kpis.systemUptime, format: "pct", trend: trends["systemUptime"] ?? undefined, icon: "✅" })}
  </div>

  <div class="grid kpis secondary">
    ${kpiCard({ label: "Device Connectivity", value: kpis.deviceConnectivity, format: "pct", trend: trends["deviceConnectivity"] ?? undefined })}
    ${kpiCard({ label: "Platform Availability", value: kpis.platformAvailability, format: "pct2", trend: trends["platformAvailability"] ?? undefined })}
    ${kpiCard({ label: "New Farms This Month", value: kpis.newFarmsThisMonth, trend: trends["newFarmsThisMonth"] ?? undefined })}
    ${kpiCard({ label: "New Users This Week", value: kpis.newUsersThisWeek, trend: trends["newUsersThisWeek"] ?? undefined })}
  </div>

  <div class="grid split-2">
    ${panel("Platform Growth", "New users and farms per month", routeLink("reports", "Full reports →"), `
      <div class="chart-legend">
        <span><i class="sw" style="background:#22c55e"></i>Users</span>
        <span><i class="sw" style="background:#38bdf8"></i>Farms</span>
      </div>
      ${lineChart(growth.users, "#22c55e")}
      ${lineChart(growth.farms, "#38bdf8")}
    `)}
    ${panel("Farm Health", "Across all registered farms", routeLink("farms", "View farms →"),
      donut(farmDist, ["#22c55e", "#f59e0b", "#ef4444"]))}
  </div>

  <div class="grid split-2">
    ${panel("Device Connectivity", "Hardware status distribution", routeLink("hardware", "View hardware →"),
      donut(hwDist, ["#22c55e", "#f59e0b", "#94a3b8", "#ef4444"]))}
    ${panel("Maintenance & Support Trend", "Jobs raised vs support tickets per month", "", `
      <div class="chart-legend">
        <span><i class="sw" style="background:#f59e0b"></i>Maintenance</span>
        <span><i class="sw" style="background:#a78bfa"></i>Support</span>
      </div>
      ${barChart(growth.maintenance)}
    `)}
  </div>

  ${panel("System Health", "Core platform services", routeLink("alerts", "Operations centre →"), `
    <div class="health-grid">
      ${Object.entries(health).map(([name, svc]) => `
        <div class="health-card">
          <div class="health-top">
            <span class="dot-r ${svc.ok ? "dot-good" : "dot-bad dot-throb"}"></span>
            <b>${esc(name)}</b>
          </div>
          <div class="health-status">${esc(svc.status)}</div>
          ${svc.latencyMs !== null ? `<div class="health-latency">${fmtInt(svc.latencyMs)} ms</div>` : ""}
        </div>`).join("")}
    </div>
    <div class="uptime-row">
      <span>30-day uptime</span>${meter(kpis.systemUptime)}<b>${fmtPct(kpis.systemUptime)}</b>
    </div>
  `)}

  <div class="grid split-2">
    ${panel("Priority Alerts", "Requiring administrator action", routeLink("alerts", "View all →"),
      table(["ID", "Alert", "Farm", "Priority", "Status"], openAlerts, (a) => [
        `<span class="mono">${esc(a.id)}</span>`,
        esc(a.title),
        esc(a.farm ?? "Platform"),
        badge(a.priority),
        badge(a.status),
      ], "No open alerts."))}

    ${panel("Open Maintenance", "Scheduled and overdue jobs", routeLink("maintenance", "View all →"),
      table(["Device", "Farm", "Technician", "Status"], openJobs, (m) => [
        `<span class="mono">${esc(m.device)}</span>`,
        esc(m.farm),
        m.technician ? esc(m.technician) : `<span class="muted">Unassigned</span>`,
        badge(m.status),
      ], "No open maintenance."))}
  </div>

  ${panel("Recent Platform Activity", "Latest administrator actions", routeLink("activity", "Platform activity →"),
    table(["Time", "Administrator", "Action", "Target", "Outcome"], recentActivity, (a) => [
      `<span class="mono sm">${esc(a.timestamp)}</span>`,
      esc(a.administrator),
      esc(a.eventType),
      esc(a.target ?? "—"),
      badge(a.outcome),
    ]))}

  <p class="page-note">${esc(`${fmtInt(kpis.activeUsers)} active accounts · ${fmtInt(kpis.disabledUsers)} disabled · platform availability ${fmtPct2(kpis.platformAvailability)}`)}</p>
  `;
}
