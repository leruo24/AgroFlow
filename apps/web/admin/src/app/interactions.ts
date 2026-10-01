/* Event wiring: filter toolbar, admin actions, detail views, exports. */

import { api } from "@/data/api";
import { toast } from "@/lib/toast";
import { openDrawer } from "@/lib/drawer";
import {
  createFarmer,
  deleteFarm,
  deleteFarmerUser,
  getFarmers,
  inviteFarmer,
  onboardFarmer,
  regenerateTelegramCode,
  registerFarm,
  sendTemporaryPasswordViaTelegram,
  resetTemporaryPassword,
} from "@/services/agroFlowApi";
import QRCode from "qrcode";
import { showErrorModal } from "@/lib/errorModal";
import { toCSV, downloadCSV } from "@/lib/csv";
import { go, refresh, renderSettingsTab, positionTabUnderline, appState } from "@/app/router";
import {
  getFilter, setFilter, resetFilter, resolvePreset, applyFilters, rangeLabel,
} from "@/lib/filters";
import { esc, fmtInt, fmtPct, fmtDate, fmtLitres } from "@/lib/format";
import { TECHNICIANS } from "@/data/referenceData";
import type { DateRangePreset, FilterState, AlertPriority } from "@/types/models";
import { zoneRow } from "@/pages/onboarding";
import { signOut, getAdminProfile } from "@/app/auth";

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
      downloadCSV("agroflow-irrigation.csv", toCSV(["Date", "Farm", "Zone", "Crop", "Province", "Region", "Estimated litres", "Minutes", "On schedule"], rows));
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

async function openUserProfile(id: string): Promise<void> {
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
    // Not healthDot(f.health) here - openDrawer's title is HTML-escaped by
    // design (see lib/drawer.ts's escapeText), so it can't safely carry the
    // dot's markup. Health status is already shown explicitly in the
    // "Farm summary" section below.
    title: f.name,
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
    case "view-user": return openUserProfile(idAttr);
    case "edit-user": {
      const u = api.findUser(idAttr);
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
          void api.updateUser(idAttr, {
            name: v["name"] ?? u.name, email: v["email"] ?? u.email,
            farm: v["farm"] ?? u.farm, phone: v["phone"] ?? u.phone,
          }).then(() => { toast("User updated.", "success"); void refresh(); });
        },
      });
    }
    case "disable-user":
      await api.setUserStatus(idAttr, "Disabled");
      toast("Account disabled.", "warn");
      return void refresh();
    case "enable-user":
      await api.setUserStatus(idAttr, "Active");
      toast("Account enabled.", "success");
      return void refresh();
    case "reset-password": {
      /* Used to call a no-op that toasted "Password reset link sent." while
         sending nothing at all. It now really does send: the bot delivers a
         new temporary password to the farmer's own Telegram, and the app
         forces them to change it at their next sign-in. */
      try {
        const result = await sendTemporaryPasswordViaTelegram(idAttr);

        return toast(result.message, "success");
      } catch (e) {
        showErrorModal(
          e instanceof Error
            ? e.message
            : "Unable to send a new password.",
          "Unable to send a new password",
        );

        return;
      }
    }
    
case "delete-user": {
  const u = api.findUser(idAttr);

  try {
    await deleteFarmerUser(idAttr);

    toast(
      `Deleted ${u?.name ?? "user"}. Farm data was retained.`,
      "warn",
    );

    return void refresh();
  } catch (e) {
    showErrorModal(
      e instanceof Error
        ? e.message
        : "Unable to delete farmer.",
      "Unable to delete farmer",
    );

    return;
  }
}

    case "delete-farm": {
      const farm = api.findFarm(numId);

      if (!farm) {
        showErrorModal(
          "The selected farm could not be found.",
          "Unable to delete farm",
        );
        return;
      }

      return openDrawer({
        title: `Delete ${farm.name}?`,
        subtitle: "This action cannot be undone.",
        bodyHtml: `
          <div class="drawer-section">
            <h6>Delete farm</h6>

            <p>
              This will permanently delete
              <b>${esc(farm.name)}</b>
              and its associated farm data.
            </p>

            <p class="muted">
              The farmer's account and login will be retained.
              Only the farm and its dependent farm data will be removed.
            </p>

            <p class="muted">
              Please make sure this is the farm you intend to remove
              before continuing.
            </p>
          </div>
        `,
        confirmLabel: "Delete Farm",
        onConfirm: () => {
          void deleteFarm(numId)
            .then(() => {
              toast(
                `${farm.name} deleted successfully. Farmer account was retained.`,
                "warn",
              );

              void refresh();
            })
            .catch((e) => {
              showErrorModal(
                e instanceof Error
                  ? e.message
                  : "Unable to delete farm.",
                "Unable to delete farm",
              );
            });
        },
      });
    }




    /* farmer onboarding — real calls to AgroFlow.Api, not demo/mock like the
       rest of this file. Requires an admin to be signed in via Supabase Auth
       (no login flow exists in this dashboard yet - see agroFlowApi.ts). */
    case "create-farmer-direct":
      return openDrawer({
        title: "Create farmer account",
        subtitle: "Admin sets the email and a temporary password directly.",
        fields: [
          { label: "Full name", value: "", editable: true, name: "name" },
          { label: "Email", value: "", editable: true, name: "email" },
          { label: "Temporary password", value: "", editable: true, name: "password" },
          { label: "Farm ID", value: "", editable: true, name: "farmId" },
        ],
        confirmLabel: "Create account",
        onConfirm: (v) => {
          void createFarmer({
            name: v["name"],
            email: v["email"] ?? "",
            temporaryPassword: v["password"] ?? "",
            farmId: Number(v["farmId"]) || 0,
          })
            .then(() => toast(`Farmer account created for ${v["email"]}.`, "success"))
            .catch((err) =>
              toast(err instanceof Error ? err.message : "Failed to create farmer account.", "warn"));
        },
      });
    case "invite-farmer":
      return openDrawer({
        title: "Invite farmer",
        subtitle: "Sends a one-time Supabase Auth magic link — the farmer sets their own password.",
        fields: [
          { label: "Full name", value: "", editable: true, name: "name" },
          { label: "Email", value: "", editable: true, name: "email" },
          { label: "Farm ID", value: "", editable: true, name: "farmId" },
        ],
        confirmLabel: "Send invite",
        onConfirm: (v) => {
          void inviteFarmer({
            name: v["name"],
            email: v["email"] ?? "",
            farmId: Number(v["farmId"]) || 0,
          })
            .then(() => toast(`Invite sent to ${v["email"]}.`, "success"))
            .catch((err) =>
              toast(err instanceof Error ? err.message : "Failed to send invite.", "warn"));
        },
      });

    /* farms */
    case "view-farm": return openFarmDetail(numId);
    case "add-farm": {
  try {
    const farmers = await getFarmers();

    if (farmers.length === 0) {
      showErrorModal(
        "There are no existing farmers available. Register a farmer first.",
        "No farmers available",
      );
      return;
    }

    const farmerOptions = farmers
      .map(
        (farmer) =>
          `<option value="${farmer.id}">
            ${farmer.name || farmer.email} (${farmer.email})
          </option>`,
      )
      .join("");

    openDrawer({
      title: "Register new farm",
      subtitle: "Link a new farm to an existing farmer.",
      wide: true,

      fields: [
        {
          label: "Farm name",
          value: "",
          editable: true,
          name: "farmName",
        },
        {
          label: "Location",
          value: "",
          editable: true,
          name: "location",
        },
        {
          label: "Farm size (hectares)",
          value: "",
          editable: true,
          name: "farmSize",
        },
      ],

      bodyHtml: `
        <div class="drawer-field">
          <span>Farmer / Owner</span>
          <select data-field="ownerId">
            <option value="">Select an existing farmer</option>
            ${farmerOptions}
          </select>
        </div>

        <div class="drawer-field">
          <span>Number of zones</span>
          <input
            type="number"
            min="1"
            max="50"
            value="1"
            data-register-farm-zone-count
          />
        </div>

        <div id="registerFarmZones"></div>
      `,

      confirmLabel: "Register Farm",

      onOpen: () => {
        wireRegisterFarmZones();
      },

      onConfirm: async (v) => {
        const zoneCount = Math.max(
          1,
          Math.min(
            50,
            Number(
              document.querySelector<HTMLInputElement>(
                "[data-register-farm-zone-count]",
              )?.value,
            ) || 1,
          ),
        );

        const zones = Array.from(
          { length: zoneCount },
          (_, i) => ({
            name: v[`zone_name_${i}`] ?? "",
            sizeHectares:
              Number(v[`zone_size_${i}`]) || 0,
            cropType:
              v[`zone_crop_${i}`] ?? "",
          }),
        );

        try {
          await registerFarm({
            ownerId: v["ownerId"] ?? "",
            farm: {
              farmName: v["farmName"] ?? "",
              location: v["location"] ?? "",
              sizeHectares:
                Number(v["farmSize"]) || 0,
              zones,
            },
          });

          toast(
            `${v["farmName"] || "Farm"} registered successfully.`,
            "success",
          );

          return void refresh();
        } catch (e) {
          showErrorModal(
            e instanceof Error
              ? e.message
              : "Unable to register farm.",
            "Unable to register farm",
          );
        }
      },
    });

    return;
  } catch (e) {
    showErrorModal(
      e instanceof Error
        ? e.message
        : "Unable to load farmers.",
      "Unable to load farmers",
    );
    return;
  }
}
        /* onboarding */
    case "onboarding-next": {
      const v = collectFields();
      const err = validateOnboardingStep1(v);
      if (err) return void showOnboardingError(err);
      clearOnboardingError();
      return void goToOnboardingStep(2);
    }
    case "onboarding-back":
      clearOnboardingError();
      return void goToOnboardingStep(1);
    case "onboarding-submit": {
  const v = collectFields();

  const zoneCount = Math.max(
    0,
    Math.min(50, Number(v["zoneCount"]) || 0),
  );

  const err = validateOnboardingStep2(v, zoneCount);

  if (err) {
    return void showOnboardingError(err);
  }

  clearOnboardingError();

 const zones = Array.from(
  { length: zoneCount },
  (_, i) => ({
    name: v[`zone_name_${i}`] ?? "",
    sizeHectares: Number(v[`zone_size_${i}`]) || 0,
    cropType: v[`zone_crop_${i}`] ?? "",
  }),
);

  try {
    const result = await onboardFarmer({
      farmer: {
        fullName: v["fullName"] ?? "",
        email: v["email"] ?? "",
        phone: v["phone"] ?? "",
        
      },

      farm: {
        farmName: v["farmName"] ?? "",
        location: v["location"] ?? "",
        sizeHectares: Number(v["farmSize"]) || 0,
        zones,
      },
    });

    toast(
      "Farmer onboarded successfully.",
      "success",
    );

    /* Do NOT navigate away. The temporary password in this response exists
       nowhere else - the server never stored it - so leaving this screen
       without reading it means it is gone for good, and the only recovery is
       to reset it. The handover step is where the installer finishes the
       job. */
    handoverProfileId = result.profileId;

    await renderHandover(result);

    return void goToOnboardingStep(3);
    } catch (e) {
    showErrorModal(
      e instanceof Error
        ? e.message
        : "Something went wrong.",
      "Unable to onboard farmer",
    );

    return;
  }
}
    case "handover-regenerate": {
      if (!handoverProfileId) return;

      try {
        const issued = await regenerateTelegramCode(handoverProfileId);

        await renderQr(issued.deepLink, issued.expiresAt);

        showHandoverNotice(
          "New code generated. The previous QR code no longer works.",
        );
      } catch (e) {
        showHandoverNotice(
          e instanceof Error ? e.message : "Could not regenerate the code.",
        );
      }

      return;
    }
    case "handover-reset-password": {
      if (!handoverProfileId) return;

      try {
        const reset = await resetTemporaryPassword(handoverProfileId);

        const field = document.getElementById("handoverPassword");
        if (field) field.textContent = reset.temporaryPassword;

        showHandoverNotice(
          "A new temporary password was issued. The previous one no longer works.",
        );
      } catch (e) {
        showHandoverNotice(
          e instanceof Error ? e.message : "Could not reset the password.",
        );
      }

      return;
    }
    case "handover-done":
      handoverProfileId = null;
      return void go("farms");
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
        fields: [{ label: "Administrator", value: "", editable: true, name: "admin" }],
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
        toCSV(["Date", "Farm", "Region", "Crop", "Estimated litres"], rows));
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

function collectFields(): Record<string, string> {
  const values: Record<string, string> = {};
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((el) => {
    values[el.dataset["field"] ?? ""] = el.value;
  });
  return values;
}

/* The farmer whose handover screen is currently open - needed by Regenerate
   code and Reset password, which act on that profile. */
let handoverProfileId: string | null = null;

async function renderHandover(result: {
  email: string;
  temporaryPassword: string;
  telegramDeepLink: string | null;
  telegramCodeExpiresAt: string | null;
  warning: string | null;
}): Promise<void> {
  const email = document.getElementById("handoverEmail");
  if (email) email.textContent = result.email;

  const password = document.getElementById("handoverPassword");
  if (password) password.textContent = result.temporaryPassword;

  await renderQr(result.telegramDeepLink, result.telegramCodeExpiresAt);

  if (result.warning) {
    showHandoverNotice(result.warning);
  } else {
    clearHandoverNotice();
  }
}

/* Draws the t.me deep link as a QR code. A null link means the server has no
   bot username configured - the farmer is then onboarded by reading the
   credentials out, so the QR area says so instead of rendering a dead code. */
async function renderQr(
  deepLink: string | null,
  expiresAt: string | null,
): Promise<void> {
  const canvas = document.getElementById("telegramQr") as HTMLCanvasElement | null;
  const link = document.getElementById("telegramLink") as HTMLAnchorElement | null;
  const expiry = document.getElementById("telegramExpiry");

  if (!deepLink) {
    if (canvas) canvas.style.display = "none";
    if (link) {
      link.removeAttribute("href");
      link.textContent = "Telegram is not configured on the server.";
    }
    if (expiry) expiry.textContent = "";
    return;
  }

  if (link) {
    link.href = deepLink;
    link.textContent = deepLink;
  }

  if (expiry && expiresAt) {
    expiry.textContent = `This code stops working on ${fmtDate(expiresAt)}.`;
  }

  if (!canvas) return;

  canvas.style.display = "";

  try {
    await QRCode.toCanvas(canvas, deepLink, { width: 240, margin: 1 });
  } catch {
    /* A QR that will not draw is not a failed onboarding - the link text
       above it still works, and so does the password. */
    canvas.style.display = "none";
  }
}

function showHandoverNotice(message: string): void {
  const box = document.getElementById("handoverNotice");
  if (!box) return;
  box.textContent = message;
  box.style.display = "block";
}

function clearHandoverNotice(): void {
  const box = document.getElementById("handoverNotice");
  if (!box) return;
  box.style.display = "none";
  box.textContent = "";
}

function showOnboardingError(message: string): void {
  const box = document.getElementById("onboardingError");
  if (!box) return;
  box.textContent = message;
  box.style.display = "block";
}

function clearOnboardingError(): void {
  const box = document.getElementById("onboardingError");
  if (!box) return;
  box.style.display = "none";
  box.textContent = "";
}

function goToOnboardingStep(step: 1 | 2 | 3): void {
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((el) => {
    el.style.display = el.dataset["step"] === String(step) ? "" : "none";
  });
  document.querySelectorAll<HTMLElement>("[data-step-indicator]").forEach((el) => {
    el.classList.toggle("active", el.dataset["stepIndicator"] === String(step));
  });
}

function validateOnboardingStep1(v: Record<string, string>): string | null {
  if (!v["fullName"]?.trim()) return "Full name is required.";

  if (
    !v["email"]?.trim() ||
    !/^\S+@\S+\.\S+$/.test(v["email"])
  ) {
    return "Enter a valid email address.";
  }

  if (!v["phone"]?.trim()) return "Phone number is required.";

  return null;
}

function validateOnboardingStep2(v: Record<string, string>, zoneCount: number): string | null {
  if (!v["farmName"]?.trim()) return "Farm name is required.";
  if (!v["location"]?.trim()) return "Farm location is required.";
  if (!v["farmSize"] || Number(v["farmSize"]) <= 0) return "Enter a valid farm size.";
  if (zoneCount === 0) return "Add at least one zone.";

  for (let i = 0; i < zoneCount; i++) {
    if (!v[`zone_name_${i}`]?.trim()) {
      return `Zone ${i + 1} needs a name.`;
    }

    if (!v[`zone_size_${i}`] || Number(v[`zone_size_${i}`]) <= 0) {
      return `Zone ${i + 1} needs a valid size.`;
    }

    if (!v[`zone_crop_${i}`]?.trim()) {
      return `Zone ${i + 1} needs a crop type.`;
    }
  }

  return null;
}

function wireOnboardingZones(): void {
  const countInput = document.querySelector<HTMLInputElement>("[data-zone-count]");
  const container = document.getElementById("zonesContainer");
  if (!countInput || !container) return;
  if (countInput.dataset["bound"]) return;
  countInput.dataset["bound"] = "1";

  countInput.addEventListener("input", () => {
    const count = Math.max(0, Math.min(50, Number(countInput.value) || 0));
    const existing = collectFields();
    container.innerHTML = Array.from({ length: count }, (_, i) => zoneRow(i)).join("");
    container.querySelectorAll<HTMLInputElement>("[data-field]").forEach((el) => {
      const name = el.dataset["field"] ?? "";
      if (existing[name]) el.value = existing[name];
    });
  });
}

/* --------------------------- binding after render ------------------------ */
function wireRegisterFarmZones(): void {
  const countInput =
    document.querySelector<HTMLInputElement>("[data-register-farm-zone-count]");

  const container =
    document.getElementById("registerFarmZones");

  if (!countInput || !container) return;

  if (countInput.dataset["bound"]) return;

  countInput.dataset["bound"] = "1";

  const renderZones = () => {
    const count = Math.max(
      1,
      Math.min(50, Number(countInput.value) || 1),
    );

    container.innerHTML = Array.from(
      { length: count },
      (_, i) => zoneRow(i),
    ).join("");
  };

  countInput.addEventListener("input", renderZones);

  renderZones();
}

export function wirePageInteractions(): void {
  wireFilters();
 wireOnboardingZones();

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

// main.ts's render() rebuilds the whole shell (a fresh #avatarBtn/
// #avatarMenu) on every sign-in, so initHeader() runs again each time too
// - correct for btn/menu's own listeners (bound to brand-new nodes each
// call), but this one's on `document`, which persists across #root
// clears. Bound at most once, and re-queries the CURRENT avatar elements
// on every firing rather than closing over whichever ones existed the
// first time this ran - those could belong to a shell that's since been
// torn down and rebuilt.
let outsideClickBound = false;

export function initHeader(): void {
  const btn = document.getElementById("avatarBtn");
  const menu = document.getElementById("avatarMenu");
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });

  if (!outsideClickBound) {
    outsideClickBound = true;
    document.addEventListener("click", (e) => {
      const activeBtn = document.getElementById("avatarBtn");
      const activeMenu = document.getElementById("avatarMenu");
      if (!activeBtn || !activeMenu) return;
      if (!activeBtn.contains(e.target as Node) && !activeMenu.contains(e.target as Node)) {
        activeMenu.classList.remove("open");
      }
    });
  }

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    menu.classList.remove("open");
    void signOut().then(() => toast("Signed out.", "info"));
    // Rendering the login screen again is main.ts's job, driven by
    // app/auth.ts's onAuthChange - not this click handler.
  });

  updateHeaderIdentity();
}

/** Reflects the signed-in admin's real name/initials in the header avatar,
    replacing the static "Aisha Patel" placeholder that used to be
    hardcoded in index.html. Called from initHeader() and again by
    main.ts whenever auth state changes. */
export function updateHeaderIdentity(): void {
  const profile = getAdminProfile();
  const btn = document.getElementById("avatarBtn");
  const nameEl = document.querySelector<HTMLElement>("#avatarMenu .menu-head b");
  if (!profile || !btn || !nameEl) return;

  const initials = profile.name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || profile.email[0]?.toUpperCase() || "?";

  btn.textContent = initials;
  btn.title = profile.name || profile.email;
  nameEl.textContent = profile.name || profile.email;
}
