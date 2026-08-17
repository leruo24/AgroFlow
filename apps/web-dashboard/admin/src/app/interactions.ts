/* Event wiring: filter toolbar, admin actions, detail views, exports. */

import { api } from "@/data/api";
import { toast } from "@/lib/toast";
import { openDrawer } from "@/lib/drawer";
import { toCSV, downloadCSV } from "@/lib/csv";
import { go, refresh, renderSettingsTab, positionTabUnderline, appState } from "@/app/router";
import {
  getFilter, setFilter, resetFilter, resolvePreset, applyFilters, rangeLabel,
} from "@/lib/filters";
import { esc, fmtInt, fmtPct, fmtDate, fmtLitres, healthDot } from "@/lib/format";
import { ADMINS, TECHNICIANS } from "@/data/mock";
import type { DateRangePreset, FilterState, AlertPriority } from "@/types/models";

/* ----------------------------- filter toolbar ---------------------------- */

let filterDebounce: number | undefined;

function wireFilters(): void {
  const page = appState.activePage;

  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-filter-key]").forEach((el) => {
    if (el.dataset["bound"]) return;
    el.dataset["bound"] = "1";

    const key = el.dataset["filterKey"] as keyof FilterState;
    const isText = el instanceof HTMLInputElement && el.type === "text";
    const evt = isText ? "input" : "change";

    el.addEventListener(evt, () => {
      const value = el.value;

      if (key === "preset") {
        const preset = value as DateRangePreset;
        const resolved = resolvePreset(preset);
        // Custom keeps whatever from/to the user has typed.
        if (preset === "custom") setFilter(page, { preset });
        else setFilter(page, { preset, from: resolved.from, to: resolved.to });
        void refresh();
        return;
      }

      if (key === "from" || key === "to") {
        setFilter(page, { [key]: value, preset: "custom" } as Partial<FilterState>);
        void refresh();
        return;
      }

      setFilter(page, { [key]: value } as Partial<FilterState>);

      if (isText) {
        // Debounce free-text so typing stays smooth, and keep focus/caret.
        window.clearTimeout(filterDebounce);
        filterDebounce = window.setTimeout(() => {
          const caret = (el as HTMLInputElement).selectionStart;
          void refresh().then(() => {
            const next = document.querySelector<HTMLInputElement>('[data-filter-key="search"]');
            if (next) {
              next.focus();
              if (caret !== null) next.setSelectionRange(caret, caret);
            }
          });
        }, 260);
      } else {
        void refresh();
      }
    });
  });
}

/* -------------------------------- exports -------------------------------- */

async function exportCurrent(kind: string): Promise<void> {
  const page = appState.activePage;
  const f = getFilter(page);

  switch (kind) {
    case "users": {
      const rows = applyFilters(await api.getUsers(), f, {
        search: (u) => `${u.name} ${u.email} ${u.farm}`,
        date: (u) => u.dateJoined, farm: (u) => u.farm, status: (u) => u.status,
      }).map((u) => [u.name, u.email, u.farm, u.status, u.dateJoined, u.lastActive]);
      downloadCSV("agroflow-users.csv", toCSV(["Name", "Email", "Farm", "Status", "Joined", "Last active"], rows));
      break;
    }
    case "farms": {
      const rows = applyFilters(await api.getFarms(), f, {
        search: (x) => `${x.name} ${x.owner}`, date: (x) => x.registered,
        province: (x) => x.province, region: (x) => x.region, status: (x) => x.status,
      }).map((x) => [x.name, x.owner, x.province, x.region, x.users, x.devices, x.health, x.status, x.registered]);
      downloadCSV("agroflow-farms.csv", toCSV(["Farm", "Owner", "Province", "Region", "Users", "Devices", "Health", "Status", "Registered"], rows));
      break;
    }
    case "hardware": {
      const rows = applyFilters(await api.getHardware(), f, {
        search: (h) => `${h.id} ${h.type} ${h.farm}`, date: (h) => h.installed,
        farm: (h) => h.farm, deviceType: (h) => h.type, status: (h) => h.status,
        maintenanceState: (h) => h.maintenanceState,
      }).map((h) => [h.id, h.type, h.farm, h.province, h.firmware, h.battery ?? "Mains", h.uptimePct, h.status, h.maintenanceState, h.installed]);
      downloadCSV("agroflow-hardware.csv", toCSV(["Device", "Type", "Farm", "Province", "Firmware", "Battery", "Uptime %", "Status", "Maintenance", "Installed"], rows));
      break;
    }
    case "alerts": {
      const rows = applyFilters(await api.getAlerts(), f, {
        search: (a) => `${a.id} ${a.title}`, date: (a) => a.raised, farm: (a) => a.farm ?? "",
        administrator: (a) => a.assignedTo ?? "", status: (a) => a.status,
        priority: (a) => a.priority, eventType: (a) => a.category,
      }).map((a) => [a.id, a.raised, a.category, a.title, a.farm ?? "Platform", a.user ?? "", a.assignedTo ?? "", a.priority, a.status]);
      downloadCSV("agroflow-alerts.csv", toCSV(["ID", "Raised", "Category", "Alert", "Farm", "User", "Assigned", "Priority", "Status"], rows));
      break;
    }
    case "maintenance": {
      const rows = applyFilters(await api.getMaintenance(), f, {
        search: (m) => `${m.id} ${m.device}`, date: (m) => m.scheduledFor,
        farm: (m) => m.farm, status: (m) => m.status, priority: (m) => m.priority,
        deviceType: (m) => m.deviceType,
      }).map((m) => [m.id, m.device, m.deviceType, m.farm, m.issue, m.priority, m.technician ?? "", m.scheduledFor, m.status, m.completedOn ?? ""]);
      downloadCSV("agroflow-maintenance.csv", toCSV(["Job", "Device", "Type", "Farm", "Issue", "Priority", "Technician", "Scheduled", "Status", "Completed"], rows));
      break;
    }
    case "irrigation": {
      const rows = applyFilters(await api.getIrrigationEvents(), f, {
        date: (e) => e.date, farm: (e) => e.farm, province: (e) => e.province,
        region: (e) => e.region, crop: (e) => e.crop,
      }).map((e) => [e.date, e.farm, e.zone, e.crop, e.province, e.region, e.litres, e.durationMin, e.onSchedule ? "Yes" : "No"]);
      downloadCSV("agroflow-irrigation.csv", toCSV(["Date", "Farm", "Zone", "Crop", "Province", "Region", "Litres", "Minutes", "On schedule"], rows));
      break;
    }
    case "activity": {
      const rows = applyFilters(await api.getActivity(), f, {
        search: (a) => `${a.administrator} ${a.eventType}`, date: (a) => a.timestamp,
        administrator: (a) => a.administrator, farm: (a) => a.farm ?? "",
        eventType: (a) => a.eventType, status: (a) => a.outcome,
      }).map((a) => [a.timestamp, a.administrator, a.eventType, a.farm ?? "Platform", a.target ?? "", a.outcome]);
      downloadCSV("agroflow-platform-activity.csv", toCSV(["Timestamp", "Administrator", "Action", "Farm", "Affected", "Outcome"], rows));
      break;
    }
    case "dashboard": {
      const k = await api.getKpis();
      const rows = Object.entries(k).map(([key, value]) => [key, String(value)]);
      downloadCSV("agroflow-platform-summary.csv", toCSV(["Metric", "Value"], rows));
      break;
    }
  }
  toast(`Export complete — filters applied (${rangeLabel(f)}).`, "success");
}

/* ------------------------------ detail views ----------------------------- */

async function openUserProfile(id: number): Promise<void> {
  const u = api.findUser(id);
  if (!u) return;
  const schedules = await api.getSchedules();
  const userSchedules = schedules.filter((s) => u.scheduleIds.includes(s.id));

  const section = (title: string, body: string): string =>
    `<div class="drawer-section"><h6>${esc(title)}</h6>${body}</div>`;

  const list = (items: string[]): string =>
    items.length
      ? `<ul class="drawer-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`
      : `<p class="muted">None recorded.</p>`;

  openDrawer({
    title: u.name,
    subtitle: `${u.email} · ${u.farm}`,
    wide: true,
    bodyHtml: [
      section("Personal information", `
        <div class="detail-list">
          <div class="detail-row"><span>Email</span><b>${esc(u.email)}</b></div>
          <div class="detail-row"><span>Phone</span><b>${esc(u.phone)}</b></div>
          <div class="detail-row"><span>Status</span><b>${esc(u.status)}</b></div>
          <div class="detail-row"><span>Date joined</span><b>${esc(fmtDate(u.dateJoined))}</b></div>
          <div class="detail-row"><span>Last active</span><b>${esc(u.lastActive)}</b></div>
        </div>`),
      section("Assigned farm", `<p><b>${esc(u.farm)}</b></p>`),
      section("Registered hardware", list(u.hardware.map((h) => `<span class="mono">${esc(h)}</span>`))),
      section("Irrigation schedules", list(userSchedules.map((s) =>
        `${esc(s.zone)} — ${esc(s.cadence)} <span class="muted">(${fmtPct(s.compliancePct)} compliance)</span>`))),
      section("Recent support history", list(u.support.map((t) =>
        `<span class="mono">${esc(t.id)}</span> ${esc(t.subject)} — <b>${esc(t.status)}</b> <span class="muted">${esc(t.when)}</span>`))),
      section("Account activity", `<p class="muted">Last sign-in ${esc(u.lastActive)}. Full history in Platform Activity.</p>`),
      section("Administrator notes", list(u.notes.map((n) =>
        `${esc(n.note)} <span class="muted">— ${esc(n.author)}, ${esc(n.when)}</span>`))),
    ].join(""),
    confirmLabel: "Add note",
    onConfirm: () => toast("Note added (demo).", "success"),
  });
}

async function openFarmDetail(id: number): Promise<void> {
  const f = api.findFarm(id);
  if (!f) return;
  const [users, hardware, alerts, maintenance, schedules] = await Promise.all([
    api.getUsers(), api.getHardware(), api.getAlerts(), api.getMaintenance(), api.getSchedules(),
  ]);

  const farmUsers = users.filter((u) => u.farm === f.name);
  const farmHw = hardware.filter((h) => h.farm === f.name);
  const farmAlerts = alerts.filter((a) => a.farm === f.name);
  const farmJobs = maintenance.filter((m) => m.farm === f.name);
  const farmSched = schedules.filter((s) => s.farm === f.name);

  const section = (title: string, body: string): string =>
    `<div class="drawer-section"><h6>${esc(title)}</h6>${body}</div>`;
  const list = (items: string[]): string =>
    items.length ? `<ul class="drawer-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`
                 : `<p class="muted">None recorded.</p>`;

  openDrawer({
    title: `${healthDot(f.health)} ${f.name}`,
    subtitle: `${f.owner} · ${f.province} · ${f.region}`,
    wide: true,
    bodyHtml: [
      section("Farm summary", `
        <div class="detail-list">
          <div class="detail-row"><span>Health status</span><b>${esc(f.health)}</b></div>
          <div class="detail-row"><span>Account status</span><b>${esc(f.status)}</b></div>
          <div class="detail-row"><span>Size</span><b>${fmtInt(f.hectares)} ha</b></div>
          <div class="detail-row"><span>Registered</span><b>${esc(fmtDate(f.registered))}</b></div>
          <div class="detail-row"><span>Last activity</span><b>${esc(f.lastActivity)}</b></div>
          <div class="detail-row"><span>Device connectivity</span><b>${fmtPct(f.healthFactors.deviceConnectivity)}</b></div>
          <div class="detail-row"><span>Gateway</span><b>${f.healthFactors.gatewayOnline ? "Online" : "Offline"}</b></div>
          <div class="detail-row"><span>Sensor availability</span><b>${fmtPct(f.healthFactors.sensorsAvailable)}</b></div>
        </div>`),
      section(`Users (${farmUsers.length})`, list(farmUsers.map((u) =>
        `${esc(u.name)} <span class="muted">${esc(u.email)}</span> — <b>${esc(u.status)}</b>`))),
      section(`Installed hardware (${farmHw.length})`, list(farmHw.map((h) =>
        `<span class="mono">${esc(h.id)}</span> ${esc(h.type)} — <b>${esc(h.status)}</b>`))),
      section(`Irrigation schedules (${farmSched.length})`, list(farmSched.map((s) =>
        `${esc(s.zone)} · ${esc(s.crop)} — ${esc(s.cadence)}`))),
      section(`Maintenance history (${farmJobs.length})`, list(farmJobs.map((m) =>
        `<span class="mono">${esc(m.id)}</span> ${esc(m.issue)} — <b>${esc(m.status)}</b>`))),
      section(`Alerts (${farmAlerts.length})`, list(farmAlerts.map((a) =>
        `<span class="mono">${esc(a.id)}</span> ${esc(a.title)} — <b>${esc(a.status)}</b>`))),
      section("Device inventory", `
        <div class="detail-list">
          ${Object.entries(farmHw.reduce<Record<string, number>>((acc, h) => {
            acc[h.type] = (acc[h.type] ?? 0) + 1; return acc;
          }, {})).map(([type, n]) =>
            `<div class="detail-row"><span>${esc(type)}</span><b>${fmtInt(n)}</b></div>`).join("")
            || `<p class="muted">No hardware registered.</p>`}
        </div>`),
    ].join(""),
    confirmLabel: f.status === "Pending Approval" ? "Approve farm" : "Generate farm report",
    onConfirm: () => {
      if (f.status === "Pending Approval") {
        void api.approveFarm(f.id).then(() => {
          toast(`${f.name} approved.`, "success");
          void refresh();
        });
      } else {
        void api.logReportGenerated(`${f.name} farm report`);
        toast("Farm report generated (demo).", "success");
      }
    },
  });
}

/* ------------------------------ action router ---------------------------- */

async function handleAction(el: HTMLElement): Promise<void> {
  const act = el.dataset["act"];
  const idAttr = el.dataset["id"] ?? "";
  const numId = Number(idAttr);

  switch (act) {
    /* filters */
    case "clear-filters":
      resetFilter(appState.activePage);
      toast("Filters cleared.", "info");
      return void refresh();

    /* users */
    case "view-user": return openUserProfile(numId);
    case "edit-user": {
      const u = api.findUser(numId);
      if (!u) return;
      return openDrawer({
        title: `Edit ${u.name}`,
        subtitle: u.email,
        fields: [
          { label: "Full name", value: u.name, editable: true, name: "name" },
          { label: "Email", value: u.email, editable: true, name: "email" },
          { label: "Assigned farm", value: u.farm, editable: true, name: "farm" },
          { label: "Phone", value: u.phone, editable: true, name: "phone" },
        ],
        confirmLabel: "Save changes",
        onConfirm: (v) => {
          void api.updateUser(numId, {
            name: v["name"] ?? u.name, email: v["email"] ?? u.email,
            farm: v["farm"] ?? u.farm, phone: v["phone"] ?? u.phone,
          }).then(() => { toast("User updated.", "success"); void refresh(); });
        },
      });
    }
    case "disable-user":
      await api.setUserStatus(numId, "Disabled");
      toast("Account disabled.", "warn");
      return void refresh();
    case "enable-user":
      await api.setUserStatus(numId, "Active");
      toast("Account enabled.", "success");
      return void refresh();
    case "reset-password":
      await api.resetPassword(numId);
      return toast("Password reset link sent.", "success");
    case "delete-user": {
      const u = api.findUser(numId);
      await api.deleteUser(numId);
      toast(`Deleted ${u?.name ?? "user"}.`, "warn");
      return void refresh();
    }
    case "add-user":
      return openDrawer({
        title: "Add user",
        fields: [
          { label: "Full name", value: "", editable: true, name: "name" },
          { label: "Email", value: "", editable: true, name: "email" },
          { label: "Assigned farm", value: "", editable: true, name: "farm" },
        ],
        confirmLabel: "Create account",
        onConfirm: (v) => toast(`Account for ${v["name"] || "user"} created (demo).`, "success"),
      });

    /* farms */
    case "view-farm": return openFarmDetail(numId);
    case "add-farm":
      return openDrawer({
        title: "Register farm",
        fields: [
          { label: "Farm name", value: "", editable: true, name: "name" },
          { label: "Owner", value: "", editable: true, name: "owner" },
          { label: "Province", value: "Western Cape", editable: true, name: "province" },
        ],
        confirmLabel: "Register",
        onConfirm: (v) => toast(`${v["name"] || "Farm"} registered — pending approval.`, "success"),
      });

    /* hardware */
    case "view-device": {
      const h = api.findHardware(idAttr);
      if (!h) return;
      return openDrawer({
        title: h.id,
        subtitle: `${h.type} · ${h.farm}`,
        fields: [
          { label: "Status", value: h.status },
          { label: "Maintenance", value: h.maintenanceState },
          { label: "Firmware", value: h.firmware },
          { label: "Battery", value: h.battery === null ? "Mains powered" : `${h.battery}%` },
          { label: "Uptime", value: fmtPct(h.uptimePct) },
          { label: "Installed", value: fmtDate(h.installed) },
          { label: "Last seen", value: h.lastSeen },
        ],
        confirmLabel: "Restart device",
        onConfirm: () => {
          void api.restartDevice(h.id).then(() => { toast(`${h.id} restarted.`, "success"); void refresh(); });
        },
      });
    }
    case "restart-device":
      await api.restartDevice(idAttr);
      toast(`${idAttr} restart command sent.`, "success");
      return void refresh();
    case "remove-device":
      await api.removeDevice(idAttr);
      toast(`${idAttr} removed from platform.`, "warn");
      return void refresh();
    case "replace-device": {
      const h = api.findHardware(idAttr);
      if (!h) return;
      return openDrawer({
        title: `Replace ${h.id}`,
        subtitle: `${h.type} · ${h.farm}`,
        fields: [{ label: "New device ID", value: "", editable: true, name: "newId" }],
        confirmLabel: "Replace",
        onConfirm: (v) => {
          void api.replaceDevice(idAttr, v["newId"] ?? "").then(() => {
            toast("Hardware replaced.", "success"); void refresh();
          });
        },
      });
    }
    case "schedule-device-maint":
      return openDrawer({
        title: `Schedule service — ${idAttr}`,
        fields: [
          { label: "Technician", value: TECHNICIANS[0], editable: true, name: "tech" },
          { label: "Date", value: "2026-07-29", editable: true, name: "date" },
        ],
        confirmLabel: "Schedule",
        onConfirm: () => toast("Maintenance scheduled (demo).", "success"),
      });
    case "add-device":
      return openDrawer({
        title: "Register hardware",
        fields: [
          { label: "Device ID", value: "ESP32-", editable: true, name: "id" },
          { label: "Type", value: "ESP32 Controller", editable: true, name: "type" },
          { label: "Farm", value: "", editable: true, name: "farm" },
        ],
        confirmLabel: "Register",
        onConfirm: (v) => toast(`${v["id"] || "Device"} registered (demo).`, "success"),
      });

    /* alerts */
    case "view-alert": {
      const a = api.findAlert(idAttr);
      if (!a) return;
      return openDrawer({
        title: a.id,
        subtitle: a.title,
        wide: true,
        bodyHtml: `
          <div class="drawer-section"><h6>Details</h6>
            <div class="detail-list">
              <div class="detail-row"><span>Raised</span><b>${esc(a.raised)}</b></div>
              <div class="detail-row"><span>Category</span><b>${esc(a.category)}</b></div>
              <div class="detail-row"><span>Farm</span><b>${esc(a.farm ?? "Platform")}</b></div>
              <div class="detail-row"><span>User</span><b>${esc(a.user ?? "—")}</b></div>
              <div class="detail-row"><span>Assigned to</span><b>${esc(a.assignedTo ?? "Unassigned")}</b></div>
              <div class="detail-row"><span>Priority</span><b>${esc(a.priority)}</b></div>
              <div class="detail-row"><span>Status</span><b>${esc(a.status)}</b></div>
            </div>
          </div>
          <div class="drawer-section"><h6>Notes</h6>
            ${a.notes.length
              ? `<ul class="drawer-list">${a.notes.map((n) =>
                  `<li>${esc(n.note)} <span class="muted">— ${esc(n.author)}, ${esc(n.when)}</span></li>`).join("")}</ul>`
              : `<p class="muted">No notes recorded.</p>`}
          </div>`,
        confirmLabel: "Resolve alert",
        onConfirm: () => {
          void api.setAlertStatus(a.id, "Resolved").then(() => {
            toast(`${a.id} resolved.`, "success"); void refresh();
          });
        },
      });
    }
    case "assign-alert":
      return openDrawer({
        title: `Assign ${idAttr}`,
        fields: [{ label: "Administrator", value: ADMINS[0], editable: true, name: "admin" }],
        confirmLabel: "Assign",
        onConfirm: (v) => {
          void api.assignAlert(idAttr, v["admin"] ?? "").then(() => {
            toast("Alert assigned.", "success"); void refresh();
          });
        },
      });
    case "note-alert":
      return openDrawer({
        title: `Add note — ${idAttr}`,
        fields: [{ label: "Note", value: "", editable: true, name: "note" }],
        confirmLabel: "Add note",
        onConfirm: (v) => {
          void api.addAlertNote(idAttr, v["note"] ?? "").then(() => {
            toast("Note added.", "success"); void refresh();
          });
        },
      });
    case "priority-alert":
      return openDrawer({
        title: `Change priority — ${idAttr}`,
        fields: [{ label: "Priority (Critical / High / Medium / Low)", value: "High", editable: true, name: "p" }],
        confirmLabel: "Update",
        onConfirm: (v) => {
          const p = (v["p"] ?? "Medium") as AlertPriority;
          void api.setAlertPriority(idAttr, p).then(() => {
            toast(`Priority set to ${p}.`, "success"); void refresh();
          });
        },
      });
    case "escalate-alert":
      await api.setAlertStatus(idAttr, "Escalated");
      toast(`${idAttr} escalated.`, "warn");
      return void refresh();
    case "resolve-alert":
      await api.setAlertStatus(idAttr, "Resolved");
      toast(`${idAttr} resolved.`, "success");
      return void refresh();
    case "close-alert":
      await api.setAlertStatus(idAttr, "Closed");
      toast(`${idAttr} closed.`, "success");
      return void refresh();
    case "reopen-alert":
      await api.setAlertStatus(idAttr, "In Progress");
      toast(`${idAttr} reopened.`, "info");
      return void refresh();

    /* maintenance */
    case "assign-tech":
      return openDrawer({
        title: `Assign technician — ${idAttr}`,
        fields: [{ label: "Technician", value: TECHNICIANS[0], editable: true, name: "tech" }],
        confirmLabel: "Assign",
        onConfirm: (v) => {
          void api.assignTechnician(idAttr, v["tech"] ?? "").then(() => {
            toast("Technician assigned.", "success"); void refresh();
          });
        },
      });
    case "schedule-visit":
      return openDrawer({
        title: `Schedule visit — ${idAttr}`,
        fields: [{ label: "Visit date", value: "2026-07-29", editable: true, name: "date" }],
        confirmLabel: "Schedule",
        onConfirm: (v) => {
          void api.scheduleVisit(idAttr, v["date"] ?? "").then(() => {
            toast("Visit scheduled.", "success"); void refresh();
          });
        },
      });
    case "complete-maint":
      await api.completeMaintenance(idAttr);
      toast("Maintenance marked complete.", "success");
      return void refresh();
    case "upload-report":
      await api.uploadMaintenanceReport(idAttr);
      toast("Maintenance report uploaded.", "success");
      return void refresh();
    case "replace-hw": {
      const m = api.findMaintenance(idAttr);
      return openDrawer({
        title: `Replace hardware — ${m?.device ?? idAttr}`,
        fields: [{ label: "Replacement device ID", value: "", editable: true, name: "newId" }],
        confirmLabel: "Record replacement",
        onConfirm: () => toast("Hardware replacement recorded.", "success"),
      });
    }
    case "maint-history": {
      const m = api.findMaintenance(idAttr);
      if (!m) return;
      const all = await api.getMaintenance();
      const history = all.filter((x) => x.device === m.device);
      return openDrawer({
        title: `History — ${m.device}`,
        subtitle: m.farm,
        bodyHtml: `<ul class="drawer-list">${history.map((h) =>
          `<li><span class="mono">${esc(h.id)}</span> ${esc(h.issue)} — <b>${esc(h.status)}</b>
           <span class="muted">${esc(fmtDate(h.scheduledFor))}</span></li>`).join("")}</ul>`,
      });
    }
    case "schedule-maint":
      return openDrawer({
        title: "Schedule maintenance",
        fields: [
          { label: "Device ID", value: "", editable: true, name: "device" },
          { label: "Issue", value: "", editable: true, name: "issue" },
          { label: "Technician", value: TECHNICIANS[0], editable: true, name: "tech" },
          { label: "Date", value: "2026-07-29", editable: true, name: "date" },
        ],
        confirmLabel: "Schedule",
        onConfirm: () => toast("Maintenance scheduled (demo).", "success"),
      });

    /* irrigation schedules */
    case "view-schedule": {
      const s = api.findSchedule(numId);
      if (!s) return;
      return openDrawer({
        title: s.zone,
        subtitle: `${s.farm} · ${s.crop}`,
        fields: [
          { label: "Device", value: s.device },
          { label: "Cadence", value: s.cadence },
          { label: "Duration", value: `${s.durationMin} min` },
          { label: "Compliance", value: fmtPct(s.compliancePct) },
          { label: "Last run", value: fmtDate(s.lastRun) },
          { label: "Active", value: s.active ? "Yes" : "No" },
        ],
      });
    }
    case "edit-schedule": {
      const s = api.findSchedule(numId);
      if (!s) return;
      return openDrawer({
        title: `Edit ${s.zone}`,
        subtitle: s.farm,
        fields: [
          { label: "Cadence", value: s.cadence, editable: true, name: "cadence" },
          { label: "Duration (minutes)", value: String(s.durationMin), editable: true, name: "duration" },
        ],
        confirmLabel: "Save changes",
        onConfirm: (v) => {
          void api.updateSchedule(numId, {
            cadence: v["cadence"] ?? s.cadence,
            durationMin: Number(v["duration"] ?? s.durationMin) || s.durationMin,
          }).then(() => { toast("Schedule updated.", "success"); void refresh(); });
        },
      });
    }
    case "delete-schedule":
      await api.deleteSchedule(numId);
      toast("Schedule deleted.", "warn");
      return void refresh();

    /* reports */
    case "generate-report": {
      const name = el.dataset["report"] ?? "Report";
      await api.logReportGenerated(name);
      return toast(`${name} generated for ${rangeLabel(getFilter("reports"))}.`, "success");
    }
    case "export-report-pdf":
    case "export-report-excel": {
      const name = el.dataset["report"] ?? "Report";
      const fmt = act === "export-report-pdf" ? "PDF" : "Excel";
      await api.logReportGenerated(`${name} (${fmt})`);
      return toast(`${name} exported as ${fmt} (demo).`, "info");
    }
    case "export-report-csv": {
      const name = el.dataset["report"] ?? "Report";
      const f = getFilter("reports");
      const events = applyFilters(await api.getIrrigationEvents(), f, {
        date: (e) => e.date, farm: (e) => e.farm,
        province: (e) => e.province, region: (e) => e.region,
      });
      const rows = events.slice(0, 500).map((e) => [e.date, e.farm, e.region, e.crop, e.litres]);
      downloadCSV(`agroflow-${name.toLowerCase().replace(/\s+/g, "-")}.csv`,
        toCSV(["Date", "Farm", "Region", "Crop", "Litres"], rows));
      await api.logReportGenerated(`${name} (CSV)`);
      return toast(`${name} exported.`, "success");
    }
    case "run-comparison": return runComparison();
    case "export-comparison": return toast("Comparison exported (demo).", "info");

    /* exports */
    case "export-users": return exportCurrent("users");
    case "export-farms": return exportCurrent("farms");
    case "export-hardware": return exportCurrent("hardware");
    case "export-alerts": return exportCurrent("alerts");
    case "export-maintenance": return exportCurrent("maintenance");
    case "export-irrigation": return exportCurrent("irrigation");
    case "export-activity": return exportCurrent("activity");
    case "export-dashboard": return exportCurrent("dashboard");

    /* settings */
    case "save-settings": return toast("Settings saved.", "success");
    case "manage-roles": return toast("Role manager opened (demo).", "info");
    case "backup-now": return toast("Backup started…", "info");
    case "restore": return toast("Restore workflow started (demo).", "warn");
    case "download-backup": return toast("Backup archive download started (demo).", "info");
  }
}

/* ---------------------------- comparison report -------------------------- */

async function runComparison(): Promise<void> {
  const get = (id: string): string =>
    (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";

  const mode = get("cmpMode");
  const metric = get("cmpMetric");
  const aFrom = get("cmpAFrom"), aTo = get("cmpATo");
  const bFrom = get("cmpBFrom"), bTo = get("cmpBTo");

  const events = await api.getIrrigationEvents();
  const inWindow = (d: string, from: string, to: string): boolean =>
    (!from || d >= from) && (!to || d <= to);

  const keyOf = (e: (typeof events)[number]): string =>
    mode === "Regions" ? e.region : mode === "Provinces" ? e.province : e.farm;

  const sum = (from: string, to: string): Record<string, number> => {
    const acc: Record<string, number> = {};
    for (const e of events) {
      if (!inWindow(e.date, from, to)) continue;
      acc[keyOf(e)] = (acc[keyOf(e)] ?? 0) + e.litres;
    }
    return acc;
  };

  const a = sum(aFrom, aTo);
  const b = sum(bFrom, bTo);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

  const host = document.getElementById("cmpResult");
  if (!host) return;

  if (keys.length === 0) {
    host.innerHTML = `<div class="empty-state">No data in the selected periods.</div>`;
    return;
  }

  host.innerHTML = `
    <div class="cmp-head">${esc(metric)} · ${esc(mode)} — Period A (${esc(aFrom)} → ${esc(aTo)}) vs Period B (${esc(bFrom)} → ${esc(bTo)})</div>
    <div class="table-wrap"><table>
      <thead><tr><th>${esc(mode)}</th><th>Period A</th><th>Period B</th><th>Change</th></tr></thead>
      <tbody>${keys.map((k) => {
        const av = a[k] ?? 0, bv = b[k] ?? 0;
        const delta = av === 0 ? (bv > 0 ? 100 : 0) : ((bv - av) / av) * 100;
        const cls = delta > 0 ? "up" : delta < 0 ? "down" : "muted";
        const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
        return `<tr>
          <td>${esc(k)}</td>
          <td>${esc(fmtLitres(av))}</td>
          <td>${esc(fmtLitres(bv))}</td>
          <td class="${cls}">${arrow} ${Math.abs(delta).toFixed(1)}%</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;

  toast("Comparison generated.", "success");
}

/* --------------------------- binding after render ------------------------ */

export function wirePageInteractions(): void {
  wireFilters();

  document.querySelectorAll<HTMLElement>("[data-go]").forEach((a) => {
    if (a.dataset["bound"]) return;
    a.dataset["bound"] = "1";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      void go(a.dataset["go"] ?? "dashboard");
    });
  });

  document.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
    if (el.dataset["bound"]) return;
    el.dataset["bound"] = "1";
    el.addEventListener("click", (e) => {
      // Let inner action links win over a clickable card wrapper.
      const inner = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (inner && inner !== el) return;
      e.preventDefault();
      e.stopPropagation();
      void handleAction(el);
    });
  });

  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => {
    if (t.dataset["bound"]) return;
    t.dataset["bound"] = "1";
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      positionTabUnderline();
      renderSettingsTab(t.dataset["tab"] ?? "General");
    });
  });

  document.querySelectorAll<HTMLElement>("[data-toggle]").forEach((t) => {
    if (t.dataset["bound"]) return;
    t.dataset["bound"] = "1";
    const flip = (): void => {
      t.classList.toggle("on");
      t.setAttribute("aria-checked", String(t.classList.contains("on")));
    };
    t.addEventListener("click", flip);
    t.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); }
    });
  });

  // Header search mirrors the active page's search filter.
  const headerSearch = document.getElementById("headerSearch") as HTMLInputElement | null;
  const pageSearch = document.querySelector<HTMLInputElement>('[data-filter-key="search"]');
  if (headerSearch) {
    headerSearch.disabled = !pageSearch;
    headerSearch.placeholder = pageSearch ? "Search this page…" : "No search on this page";
    headerSearch.value = pageSearch?.value ?? "";
    headerSearch.oninput = pageSearch
      ? (): void => {
          setFilter(appState.activePage, { search: headerSearch.value });
          window.clearTimeout(filterDebounce);
          filterDebounce = window.setTimeout(() => {
            void refresh().then(() => {
              const h = document.getElementById("headerSearch") as HTMLInputElement | null;
              h?.focus();
            });
          }, 280);
        }
      : null;
  }
}

/* ------------------------------ header chrome ---------------------------- */

export function initHeader(): void {
  const btn = document.getElementById("avatarBtn");
  const menu = document.getElementById("avatarMenu");
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!btn.contains(e.target as Node) && !menu.contains(e.target as Node)) {
      menu.classList.remove("open");
    }
  });
  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    menu.classList.remove("open");
    toast("Signed out.", "info");
  });
}
