import { api } from "@/data/api";
import { esc, fmtInt, fmtDate } from "@/lib/format";
import { getFilter, applyFilters } from "@/lib/filters";
import { HARDWARE_TYPES, PROVINCES } from "@/data/referenceData";
import {
  badge, kpiCard, panel, table, pageHeader, filterBar, resultCount,
} from "@/ui/components";
import { Icon } from "@/lib/icons";

/* ============================== FARM HARDWARE ============================= */

export async function hardwarePage(): Promise<string> {
  const hardware = await api.getHardware();
  const f = getFilter("hardware");

  const filtered = applyFilters(hardware, f, {
    search: (h) => `${h.id} ${h.type} ${h.farm} ${h.firmware}`,
    date: (h) => h.installed,
    farm: (h) => h.farm,
    province: (h) => h.province,
    deviceType: (h) => h.type,
    status: (h) => h.status,
    maintenanceState: (h) => h.maintenanceState,
  });

  const total = hardware.length;
  const online = hardware.filter((h) => h.status === "Online").length;
  const offline = hardware.filter((h) => h.status === "Offline" || h.status === "Fault").length;
  const needsService = hardware.filter((h) => h.maintenanceState === "Due" || h.maintenanceState === "Overdue").length;

  // The number that decides when Devices:LegacyApiKeyEnabled can be turned
  // off: boards claimed before v1.3.0 have no per-device token and are still
  // authenticating with the shared fleet key. Once this is zero, the flag can
  // go. Surfaced as a KPI because it is a one-time migration to finish, not a
  // permanent property of the fleet.
  const legacyKey = hardware.filter((h) => h.tokenStatus === "legacy key").length;
  const revoked = hardware.filter((h) => h.tokenStatus === "revoked").length;

  return `
  ${pageHeader("Farm Hardware", "All registered hardware across every farm on the platform.",
    `<button class="btn ghost" data-act="go-mqtt-logins">MQTT logins</button>
     <button class="btn" data-act="register-hardware">+ Register a kit</button>`)}

  <div class="grid kpis four">
    ${kpiCard({ label: "Total Hardware", value: total, icon: Icon.radio })}
    ${kpiCard({ label: "Online", value: online, format: "ratio", total: fmtInt(total), icon: Icon.circleCheck })}
    ${kpiCard({ label: "Offline / Fault", value: offline, icon: Icon.circleX })}
    ${kpiCard({ label: "Needs Service", value: needsService, icon: Icon.wrench })}
  </div>

  ${legacyKey > 0 || revoked > 0 ? `
  <div class="grid kpis two">
    ${kpiCard({ label: "On the legacy shared key", value: legacyKey, icon: Icon.radio })}
    ${kpiCard({ label: "Revoked", value: revoked, icon: Icon.circleX })}
  </div>
  ${legacyKey > 0 ? `<div class="muted" style="margin:8px 0 16px">
    ${legacyKey} board${legacyKey === 1 ? " has" : "s have"} no per-device token and
    ${legacyKey === 1 ? "is" : "are"} still using the shared key. Re-enrol
    ${legacyKey === 1 ? "it" : "them"} on firmware 1.3.0, then set
    <span class="mono sm">Devices__LegacyApiKeyEnabled=false</span> to close that path.
  </div>` : ""}` : ""}

  ${filterBar({
    page: "hardware",
    filter: f,
    showDateRange: true,
    searchPlaceholder: "Search by device ID, type or farm…",
    selects: [
      { key: "farm", label: "Farm", options: [...new Set(hardware.map((h) => h.farm))] },
      { key: "deviceType", label: "Device type", options: [...HARDWARE_TYPES] },
      { key: "status", label: "Connection", options: ["Online", "Offline", "Degraded", "Fault"] },
      { key: "maintenanceState", label: "Maintenance", options: ["OK", "Due", "Overdue", "Scheduled"] },
    ],
    rightHtml: `<button class="btn ghost sm" data-act="export-hardware">Export CSV</button>`,
  })}

  ${panel("Hardware Inventory", "Registered controllers, pumps, sensors, stations and gateways",
    resultCount(filtered.length, total, "devices"),
    table(["Device ID", "Type", "Farm", "Firmware", "Connection", "Last seen", "Token", "MQTT login", "Status", "Actions"],
      filtered, (h) => [
        `<span class="mono">${esc(h.deviceId ?? h.id)}</span>`,
        esc(h.type),
        esc(h.zoneName ? `${h.farm} · ${h.zoneName}` : h.farm),
        // firmware_version, reported by the board on claim and on every
        // 4-hourly firmware-check. Blank until a board on 1.3.0 has called in.
        `<span class="mono sm">${esc(h.firmware || "—")}</span>`,
        // Deliberately separate from `status` below. This is the 5-minute
        // "is it listening right now" answer that decides whether a command
        // will arrive; `status` is DeviceStatusMonitorService's 30-minute
        // alerting judgement. They legitimately disagree.
        h.online === undefined
          ? `<span class="muted">Unknown</span>`
          : badge(h.online ? "Online" : "Offline", h.online ? "good" : "warn"),
        esc(h.lastSeen ? fmtDate(h.lastSeen) : "Never"),
        h.tokenStatus
          ? badge(h.tokenStatus, h.tokenStatus === "active" ? "good" : "warn")
          : `<span class="muted">Unknown</span>`,
        h.mqttUsername
          ? `<span class="mono sm">${esc(h.mqttUsername)}</span>`
          : `<span class="muted">Shared</span>`,
        badge(h.status),
        // The three new actions are addressed by ZONE, not hardware id: the
        // commands go into irrigation_commands, which is keyed on zone. A
        // board with no zone cannot be commanded at all, so those links are
        // omitted rather than rendered and then failing on click.
        `<span class="row-act">
          <a href="#" data-act="view-device" data-id="${esc(h.id)}">View</a>
          ${h.zoneId ? `
          <a href="#" data-act="device-change-wifi" data-id="${esc(h.id)}">Change WiFi</a>
          <a href="#" data-act="device-open-setup" data-id="${esc(h.id)}">Open setup page</a>
          <a href="#" class="danger" data-act="device-revoke" data-id="${esc(h.id)}">Revoke</a>` : ""}
          <a href="#" data-act="schedule-device-maint" data-id="${esc(h.id)}">Service</a>
          <a href="#" class="danger" data-act="remove-device" data-id="${esc(h.id)}">Remove</a>
        </span>`,
      ], "No hardware matches the current filters."))}
  `;
}

/* =========================== OPERATIONS CENTRE =========================== */

export async function alertsPage(): Promise<string> {
  const alerts = await api.getAlerts();
  const f = getFilter("alerts");

  const filtered = applyFilters(alerts, f, {
    search: (a) => `${a.id} ${a.title} ${a.farm ?? ""} ${a.user ?? ""} ${a.category}`,
    date: (a) => a.raised,
    farm: (a) => a.farm ?? "",
    administrator: (a) => a.assignedTo ?? "",
    status: (a) => a.status,
    priority: (a) => a.priority,
    eventType: (a) => a.category,
  });

  const open = alerts.filter((a) => !["Resolved", "Closed"].includes(a.status));
  const critical = open.filter((a) => a.priority === "Critical").length;
  const unassigned = open.filter((a) => !a.assignedTo).length;
  const escalated = open.filter((a) => a.status === "Escalated").length;

  return `
  ${pageHeader("Operations Centre", "Alerts requiring administrator action. Environmental readings are excluded by design.",
    `<button class="btn ghost" data-act="export-alerts">Export CSV</button>`)}

  <div class="grid kpis four">
    ${kpiCard({ label: "Open Alerts", value: open.length, icon: Icon.bell })}
    ${kpiCard({ label: "Critical", value: critical, icon: Icon.circleX })}
    ${kpiCard({ label: "Unassigned", value: unassigned, icon: Icon.inbox })}
    ${kpiCard({ label: "Escalated", value: escalated, icon: Icon.triangleAlert })}
  </div>

  ${filterBar({
    page: "alerts",
    filter: f,
    showDateRange: true,
    searchPlaceholder: "Search by alert ID, title, farm or user…",
    selects: [
      { key: "eventType", label: "Category", options: ["Account", "Farm Approval", "Hardware", "Connectivity", "Maintenance", "Platform", "Security", "Support"] },
      { key: "priority", label: "Priority", options: ["Critical", "High", "Medium", "Low"] },
      { key: "status", label: "Status", options: ["New", "Assigned", "In Progress", "Escalated", "Waiting for User", "Resolved", "Closed"] },
      { key: "administrator", label: "Assigned to", options: [...new Set(alerts.map((a) => a.assignedTo).filter((x): x is string => !!x))] },
      { key: "farm", label: "Farm", options: [...new Set(alerts.map((a) => a.farm).filter((x): x is string => !!x))] },
    ],
  })}

  ${panel("Alert Queue", "Workflow: New → Assigned → In Progress → Escalated → Waiting → Resolved → Closed",
    resultCount(filtered.length, alerts.length, "alerts"),
    table(["ID", "Raised", "Category", "Alert", "Farm", "User", "Assigned To", "Priority", "Status", "Actions"],
      filtered, (a) => [
        `<span class="mono">${esc(a.id)}</span>`,
        `<span class="mono sm">${esc(a.raised)}</span>`,
        badge(a.category, "info"),
        esc(a.title),
        esc(a.farm ?? "Platform"),
        a.user ? esc(a.user) : `<span class="muted">—</span>`,
        a.assignedTo ? esc(a.assignedTo) : `<span class="muted">Unassigned</span>`,
        badge(a.priority),
        badge(a.status),
        `<span class="row-act">
          <a href="#" data-act="view-alert" data-id="${esc(a.id)}">View</a>
          <a href="#" data-act="assign-alert" data-id="${esc(a.id)}">Assign</a>
          <a href="#" data-act="note-alert" data-id="${esc(a.id)}">Note</a>
          <a href="#" data-act="escalate-alert" data-id="${esc(a.id)}">Escalate</a>
          <a href="#" data-act="priority-alert" data-id="${esc(a.id)}">Priority</a>
          ${["Resolved", "Closed"].includes(a.status)
            ? `<a href="#" data-act="reopen-alert" data-id="${esc(a.id)}">Reopen</a>`
            : `<a href="#" data-act="resolve-alert" data-id="${esc(a.id)}">Resolve</a>
               <a href="#" data-act="close-alert" data-id="${esc(a.id)}">Close</a>`}
        </span>`,
      ], "No alerts match the current filters."))}
  `;
}

/* ============================== MAINTENANCE ============================== */

export async function maintenancePage(): Promise<string> {
  const jobs = await api.getMaintenance();
  const f = getFilter("maintenance");

  const filtered = applyFilters(jobs, f, {
    search: (m) => `${m.id} ${m.device} ${m.farm} ${m.issue} ${m.technician ?? ""}`,
    date: (m) => m.scheduledFor,
    farm: (m) => m.farm,
    province: (m) => m.province,
    status: (m) => m.status,
    priority: (m) => m.priority,
    deviceType: (m) => m.deviceType,
  });

  const scheduled = jobs.filter((m) => m.status === "Scheduled").length;
  const overdue = jobs.filter((m) => m.status === "Overdue").length;
  const upcoming = jobs.filter((m) => m.status === "Upcoming").length;
  const completed = jobs.filter((m) => m.status === "Completed").length;

  return `
  ${pageHeader("Maintenance", "Coordinate technician visits, hardware servicing and completion reports.",
    `<button class="btn" data-act="schedule-maint">+ Schedule Maintenance</button>`)}

  <div class="grid kpis four">
    ${kpiCard({ label: "Scheduled", value: scheduled, icon: Icon.calendar })}
    ${kpiCard({ label: "Overdue", value: overdue, icon: Icon.triangleAlert })}
    ${kpiCard({ label: "Upcoming", value: upcoming, icon: Icon.clock })}
    ${kpiCard({ label: "Completed", value: completed, icon: Icon.circleCheck })}
  </div>

  ${filterBar({
    page: "maintenance",
    filter: f,
    showDateRange: true,
    searchPlaceholder: "Search by job ID, device, farm or technician…",
    selects: [
      { key: "status", label: "Status", options: ["Scheduled", "Overdue", "In Progress", "Upcoming", "Completed"] },
      { key: "priority", label: "Priority", options: ["Critical", "High", "Medium", "Low"] },
      { key: "farm", label: "Farm", options: [...new Set(jobs.map((m) => m.farm))] },
      { key: "province", label: "Province", options: [...PROVINCES] },
      { key: "deviceType", label: "Device type", options: [...HARDWARE_TYPES] },
    ],
    rightHtml: `<button class="btn ghost sm" data-act="export-maintenance">Export CSV</button>`,
  })}

  ${panel("Maintenance Jobs", "Assign technicians, schedule visits and record completion",
    resultCount(filtered.length, jobs.length, "jobs"),
    table(["Job", "Device", "Farm", "Issue", "Priority", "Technician", "Scheduled", "Status", "Report", "Actions"],
      filtered, (m) => [
        `<span class="mono">${esc(m.id)}</span>`,
        `<span class="mono">${esc(m.device)}</span>`,
        esc(m.farm),
        esc(m.issue),
        badge(m.priority),
        m.technician ? esc(m.technician) : `<span class="muted">Unassigned</span>`,
        fmtDate(m.scheduledFor),
        badge(m.status),
        m.reportUploaded ? `<span class="tone-good">✓ Uploaded</span>` : `<span class="muted">—</span>`,
        `<span class="row-act">
          <a href="#" data-act="assign-tech" data-id="${esc(m.id)}">Assign</a>
          <a href="#" data-act="schedule-visit" data-id="${esc(m.id)}">Schedule</a>
          ${m.status !== "Completed" ? `<a href="#" data-act="complete-maint" data-id="${esc(m.id)}">Complete</a>` : ""}
          <a href="#" data-act="upload-report" data-id="${esc(m.id)}">Report</a>
          <a href="#" data-act="replace-hw" data-id="${esc(m.id)}">Replace HW</a>
          <a href="#" data-act="maint-history" data-id="${esc(m.id)}">History</a>
        </span>`,
      ], "No maintenance jobs match the current filters."))}
  `;
}
