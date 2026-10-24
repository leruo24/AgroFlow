import { dismissButton, hiddenBy, historyList, viewOf, viewToggle, type Dismissal } from "@/lib/dismiss";
import { getAdminDismissals } from "@/services/agroFlowApi";
import { api } from "@/data/api";
import { getAdminProfile } from "@/app/auth";
import { contextPhotoHtml } from '@/ui/agroflowImages';
import { handlingCell } from "@/ui/patterns";
import { esc, fmtInt, fmtDate, fmtDateTimeSast } from "@/lib/format";
import { getFilter, applyFilters } from "@/lib/filters";
import { HARDWARE_TYPES, PROVINCES } from "@/data/referenceData";
import {
  badge, kpiCard, panel, table, pageHeader, filterBar, resultCount,
} from "@/ui/components";
import { Icon } from "@/lib/icons";

/* FARM HARDWARE */

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

  // Boards claimed before v1.3.0 have no per-device token and still use the shared fleet
  // key. When this count reaches zero, Devices:LegacyApiKeyEnabled can be turned off.
  const legacyKey = hardware.filter((h) => h.tokenStatus === "legacy key").length;
  const revoked = hardware.filter((h) => h.tokenStatus === "revoked").length;

  return `
  ${pageHeader("Farm Hardware", "All registered hardware across every farm on the platform.",
    `<button class="btn ghost" data-act="go-mqtt-logins">MQTT logins</button>
     <button class="btn" data-act="register-hardware">+ Register a kit</button>`)}

  <div class="grid kpis four">
    ${kpiCard({ label: "Total Hardware", value: total, icon: Icon.radio, why: { counts: "kits are registered", rule: "Every kit on the platform, whatever its state.", query: "hardware" } })}
    ${kpiCard({ label: "Online", value: online, format: "ratio", total: fmtInt(total), icon: Icon.circleCheck, why: { counts: "kits are online", rule: "A kit is online while the equipment monitor has heard from it inside its offline window.", query: "hardware.status = Online" } })}
    ${kpiCard({ label: "Offline / Fault", value: offline, icon: Icon.circleX, why: { counts: "kits are offline or faulty", rule: "Offline: nothing heard inside the offline window. Fault: a fault was recorded.", highlighted: "A quiet kit means its zone is not being watched.", query: "hardware.status in (Offline, Fault)" } })}
    ${kpiCard({ label: "Needs Service", value: needsService, icon: Icon.wrench, why: { counts: "kits need service", rule: "Kits whose maintenance is Due or Overdue.", query: "hardware.maintenanceState in (Due, Overdue)" } })}
  </div>

  ${legacyKey > 0 || revoked > 0 ? `
  <div class="grid kpis two">
    ${kpiCard({ label: "On the legacy shared key", value: legacyKey, icon: Icon.radio, why: { counts: "kits still use the shared fleet key", rule: "Boards claimed before firmware v1.3.0 have no token of their own and still use the shared key.", highlighted: "Once this is zero the shared key can be switched off.", query: "hardware.tokenStatus = legacy key", clears: "Re-claiming the kit with current firmware." } })}
    ${kpiCard({ label: "Revoked", value: revoked, icon: Icon.circleX, why: { counts: "kits have been revoked", rule: "Kits whose access was revoked by an administrator.", query: "hardware.tokenStatus = revoked" } })}
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
    table(["Device ID", "Type", "Farm", "Firmware", "Connection", "Last seen", "Token", "MQTT login", "Actions"],
      filtered, (h) => [
        `<span class="mono">${esc(h.deviceId ?? h.id)}</span>`,
        esc(h.type),
        esc(h.zoneName ? `${h.farm} · ${h.zoneName}` : h.farm),
        // firmware_version, reported by the board on claim and on every 4-hourly firmware check.
        // Blank until a board on 1.3.0 has called in.
        `<span class="mono sm">${esc(h.firmware || "—")}</span>`,
        // The one connectivity badge: the 5-minute "is it listening now" answer that decides
        // whether a command will arrive (api.ts derives h.status from the same value).
        h.online === undefined
          ? `<span class="muted">Unknown</span>`
          : badge(h.online ? "Online" : "Offline", h.online ? "good" : "warn"),
        // With the kit's backlog when it has readings still to upload (it was offline).
        esc(h.lastSeen ? fmtDate(h.lastSeen) : "Never") +
          (h.offlineBacklog && h.offlineBacklog > 0
            ? `<div class="muted sm" data-backlog="${esc(h.id)}">${fmtInt(h.offlineBacklog)} reading${h.offlineBacklog === 1 ? "" : "s"} waiting to upload</div>`
            : ""),
        h.tokenStatus
          ? badge(h.tokenStatus, h.tokenStatus === "active" ? "good" : "warn")
          : `<span class="muted">Unknown</span>`,
        h.mqttUsername
          ? `<span class="mono sm">${esc(h.mqttUsername)}</span>`
          : `<span class="muted">Shared</span>`,
        // These actions go by zone, not hardware id: the commands go into irrigation_commands,
        // which is keyed on zone. A board with no zone cannot be commanded, so the links are left out.
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

/* OPERATIONS CENTRE */

export async function alertsPage(): Promise<string> {
  const [alerts, dismissals] = await Promise.all([
    api.getAlerts(),
    // Dismissed alerts leave the queue but stay in its history.
    getAdminDismissals().catch(() => [] as Dismissal[]),
  ]);
  const view = viewOf("alerts");
  const isCritical = (p: string): boolean => p === "Critical" || p === "High";
  const me = getAdminProfile()?.id;
  const f = getFilter("alerts");

  const filtered = applyFilters(alerts.filter((a) => !hiddenBy(dismissals, "alert", String(a.id), isCritical(a.priority), null)), f, {
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
    ${kpiCard({ label: "Open Alerts", value: open.length, icon: Icon.bell, why: { counts: "alerts are open", rule: "Every alert not Resolved or Closed.", query: "alert.status not in (Resolved, Closed)", clears: "Resolving alerts." } })}
    ${kpiCard({ label: "Critical", value: critical, icon: Icon.circleX, why: { counts: "open alerts are Critical", rule: "Open alerts whose priority is Critical.", highlighted: "These need someone now.", query: "open alert with priority = Critical" } })}
    ${kpiCard({ label: "Unassigned", value: unassigned, icon: Icon.inbox, why: { counts: "open alerts have nobody on them", rule: "Open alerts with no administrator assigned.", highlighted: "Nobody is responsible for these yet.", query: "open alert with assigned_to null", clears: "Assigning the alert." } })}
    ${kpiCard({ label: "Escalated", value: escalated, icon: Icon.triangleAlert, why: { counts: "open alerts are escalated", rule: "Open alerts whose status is Escalated.", query: "alert.status = Escalated" } })}
  </div>

  ${filterBar({
    page: "alerts",
    filter: f,
    showDateRange: true,
    searchPlaceholder: "Search by alert ID, title, farm or user…",
    selects: [
      { key: "eventType", label: "Category", options: ["Account", "Farm Approval", "Hardware", "Connectivity", "Maintenance", "Platform", "Security", "Support"] },
      { key: "priority", label: "Priority", options: ["Critical", "High", "Medium", "Low"] },
      { key: "status", label: "Status", options: ["New", "In Progress", "Escalated", "Resolved"] },
      { key: "administrator", label: "Handled by", options: [...new Set(alerts.map((a) => a.assignedTo).filter((x): x is string => !!x))] },
      { key: "farm", label: "Farm", options: [...new Set(alerts.map((a) => a.farm).filter((x): x is string => !!x))] },
    ],
  })}

  ${panel("Alert Queue", "New → In progress (somebody is handling it) → Resolved. Every step is recorded with who did it.",
    `${viewToggle("alerts")} ${resultCount(filtered.length, alerts.length, "alerts")}`,
    (view === "dismissed" ? "" : table(["ID", "Raised (SAST)", "Category", "Alert", "Farm", "Farmer", "Handled by", "Priority", "Status", "Actions"],
      filtered, (a) => [
        `<span class="mono">${esc(a.id)}</span>`,
        // fmtDateTimeSast, not the raw ISO column.
        `<span class="sm">${esc(fmtDateTimeSast(a.raised))}</span>`,
        badge(a.category, "info"),
        esc(a.title),
        esc(a.farm ?? "Platform"),
        a.user ? esc(a.user) : `<span class="muted">No farmer on file</span>`,
        handlingCell("alerts", a, me, a.status === "Resolved"),
        badge(a.priority),
        badge(a.status),
        `<span class="row-act">
          <a href="#" data-act="view-alert" data-id="${esc(a.id)}">View</a>
          <a href="#" data-act="note-alert" data-id="${esc(a.id)}">Note</a>
          <a href="#" data-act="escalate-alert" data-id="${esc(a.id)}">Escalate</a>
          ${["Resolved", "Closed"].includes(a.status)
            ? `<a href="#" data-act="reopen-alert" data-id="${esc(a.id)}">Reopen</a>`
            : `<a href="#" data-act="resolve-alert" data-id="${esc(a.id)}">Resolve</a>
               <a href="#" data-act="close-alert" data-id="${esc(a.id)}">Close</a>`}
          ${dismissButton({ kind: "alert", key: String(a.id), title: a.title, raisedAt: a.raised, critical: isCritical(a.priority) })}
        </span>`,
      ], "No alerts match the current filters."))
    + (view === "active" ? "" : `<h4 class="sub-heading">Dismissed</h4>${historyList(dismissals, "alert", "No alert has been dismissed.")}`))}
  `;
}

/* MAINTENANCE */

export async function maintenancePage(): Promise<string> {
  const jobs = await api.getMaintenance();
  const me = getAdminProfile()?.id;
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
  ${contextPhotoHtml('tanks')}

  <div class="grid kpis four">
    ${kpiCard({ label: "Scheduled", value: scheduled, icon: Icon.calendar, why: { counts: "maintenance jobs are scheduled", rule: "Jobs whose status is Scheduled.", query: "maintenance.status = Scheduled" } })}
    ${kpiCard({ label: "Overdue", value: overdue, icon: Icon.triangleAlert, why: { counts: "maintenance jobs are overdue", rule: "Jobs whose status is Overdue.", highlighted: "A promised visit is late.", query: "maintenance.status = Overdue" } })}
    ${kpiCard({ label: "Upcoming", value: upcoming, icon: Icon.clock, why: { counts: "maintenance jobs are upcoming", rule: "Jobs whose status is Upcoming.", query: "maintenance.status = Upcoming" } })}
    ${kpiCard({ label: "Completed", value: completed, icon: Icon.circleCheck, why: { counts: "maintenance jobs are completed", rule: "Jobs whose status is Completed.", query: "maintenance.status = Completed" } })}
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

  ${panel("Maintenance Jobs", "Schedule visits and record completion - whoever does it is on the record",
    resultCount(filtered.length, jobs.length, "jobs"),
    table(["Job", "Device", "Farm", "Issue", "Handled by", "Scheduled", "Status", "Actions"],
      filtered, (m) => [
        `<span class="mono">${esc(m.id)}</span>`,
        `<span class="mono">${esc(m.device)}</span>`,
        esc(m.farm),
        esc(m.issue),
        handlingCell("maintenance", m, me, m.status === "Completed"),
        fmtDate(m.scheduledFor),
        badge(m.status),
        `<span class="row-act">
          <a href="#" data-act="maint-history" data-id="${esc(m.id)}">Timeline</a>
          <a href="#" data-act="note-maint" data-id="${esc(m.id)}">Note</a>
          ${m.status !== "Completed"
            ? `<a href="#" data-act="schedule-visit" data-id="${esc(m.id)}">Schedule</a>
               <a href="#" data-act="complete-maint" data-id="${esc(m.id)}">Complete</a>`
            : `<span class="muted">Completed${m.resolvedByName ? ` by ${esc(m.resolvedByName)}` : ""}</span>`}
        </span>`,
      ], "No maintenance jobs match the current filters."))}
  `;
}
