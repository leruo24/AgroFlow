/* Event wiring: filter toolbar, admin actions, detail views, exports. */

import { api, getFarmAlertHistory, getShowArchivedFarms, setShowArchivedFarms } from "@/data/api";
import { toast } from "@/lib/toast";
import { openDrawer, closeDrawer, beginPanelIntent, currentPanelIntent } from "@/lib/drawer";
import {
  createFarmer,
  deleteFarm,
  deleteFarmerUser,
  getFarmers,
  inviteFarmer,
  onboardFarmer,
  issueLinkCodeForFarmer,
  regenerateTelegramCode,
  registerFarm,
  sendTemporaryPasswordViaTelegram,
  resetTemporaryPassword,
  deviceChangeWifi,
  deviceOpenSetup,
  deviceRevoke,
  addMqttLogins,
  createEnrollmentCode,
  getReportSchedule,
  saveReportSchedule,
  archiveFarm,
  restoreFarm,
  runAdviceNow,
  assignRequest,
  getActivityLog,
  getEntityTimeline,
  KIT_TYPES,
  getPlatformConfig,
  updateMyProfile,
  getMyTelegramStatus,
  requestMyTelegramCode,
  disconnectMyTelegram,
  type AuditRow,
} from "@/services/agroFlowApi";
import QRCode from "qrcode";
import { showErrorModal } from "@/lib/errorModal";
import { showQrModal } from "@/lib/qrModal";
import { picker, detailList, wizard, errorState } from "@/ui/patterns";
import { exportActivityWorkbook, exportSummaryWorkbook, exportRowsWorkbook, downloadExcelSafeCsv } from "@/lib/workbook";
import { timelineHtml } from "@/pages/analytics";
import { requestTimeline, formatCrop } from "@/pages/requests";
import { toCSV } from "@/lib/csv";
import { navigate, showPage, refresh, renderSettingsTab, positionTabUnderline, appState, onSettingsTabRendered } from "@/app/router";
import { refreshHealthPanel } from "@/app/health";
import {
  getFilter, setFilter, resetFilter, resolvePreset, applyFilters, rangeLabel,
} from "@/lib/filters";
import { esc, fmtInt, fmtPct, fmtDate, fmtLitres, fmtDateTimeSast } from "@/lib/format";
import { TECHNICIANS, ZONE_CROPS } from "@/data/referenceData";
import type { AdminAlert, DateRangePreset, Farm, FilterState, AlertPriority, ServiceRequest } from "@/types/models";
import { zoneRow } from "@/pages/onboarding";
import { locationPickerHtml, mountLocationPicker } from "@/lib/map";
import { telegramState } from "@/pages/users";
import { signOut, getAdminProfile, refreshAdminProfile, changeMyPassword } from "@/app/auth";
import { getReportZones, getReportJson, downloadReportPdf, downloadSummaryPdf, downloadReportFile } from "@/services/agroFlowApi";
import { getWhy, whyHtml, whyLink, asExplanation, WHY_LINK_TEXT } from "@/lib/why";


/* ------------------------------- pickers -------------------------------- */

/* A picker is a search box over a list of real options. Choosing one writes
   its value into the hidden field the wizard reads, so a form can never end
   up holding a farm name that does not exist - which is the whole reason
   these replaced the free-text fields. */
function wirePickers(): void {
  document.querySelectorAll<HTMLElement>("[data-picker]").forEach((host) => {
    if (host.dataset["bound"]) return;
    host.dataset["bound"] = "1";

    const name = host.dataset["picker"] ?? "";
    const search = host.querySelector<HTMLInputElement>(".picker-search");
    const hidden = host.querySelector<HTMLInputElement>('[data-field="' + name + '"]');

    search?.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();

      host.querySelectorAll<HTMLElement>(".picker-option").forEach((opt) => {
        const hay = opt.dataset["search"] ?? "";
        opt.hidden = q.length > 0 && !hay.includes(q);
      });
    });

    host.querySelectorAll<HTMLButtonElement>(".picker-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        if (opt.disabled) return;

        host.querySelectorAll(".picker-option").forEach((o) => {
          o.classList.remove("is-selected");
          o.setAttribute("aria-selected", "false");
        });

        opt.classList.add("is-selected");
        opt.setAttribute("aria-selected", "true");

        if (hidden) hidden.value = opt.dataset["value"] ?? "";

        // Tell the wizard a choice was made, so a later step can rebuild
        // itself from it (zones depend on the farm, farms on the farmer).
        host.dispatchEvent(
          new CustomEvent("picker:change", {
            bubbles: true,
            detail: { name, value: opt.dataset["value"] ?? "" },
          }),
        );
      });
    });
  });
}

/* ------------------------------- wizards -------------------------------- */

/* Steps, validation per step, and Back that keeps what was entered.
   Validation is deliberately per step: one long form that validates at the
   end tells the admin about a mistake they made six fields ago. */
function wireWizards(): void {
  document.querySelectorAll<HTMLElement>("[data-wizard]").forEach((wiz) => {
    if (wiz.dataset["bound"]) return;
    wiz.dataset["bound"] = "1";

    const total = Number(wiz.dataset["steps"] ?? "1");
    const back = wiz.querySelector<HTMLButtonElement>("[data-wizard-back]");
    const next = wiz.querySelector<HTMLButtonElement>("[data-wizard-next]");
    const confirmBtn = wiz.querySelector<HTMLButtonElement>("[data-wizard-confirm]");
    const errorEl = wiz.querySelector<HTMLElement>("[data-wizard-error]");
    const counter = wiz.querySelector<HTMLElement>("[data-wizard-current]");

    const showError = (message: string | null): void => {
      if (!errorEl) return;
      errorEl.textContent = message ?? "";
      errorEl.hidden = message === null;
    };

    const render = (): void => {
      const step = Number(wiz.dataset["step"] ?? "0");

      wiz.querySelectorAll<HTMLElement>("[data-wizard-step]").forEach((el) => {
        el.classList.toggle("is-current", Number(el.dataset["wizardStep"]) === step);
      });

      wiz.querySelectorAll<HTMLElement>("[data-rail]").forEach((el) => {
        const i = Number(el.dataset["rail"]);
        el.classList.toggle("is-current", i === step);
        el.classList.toggle("is-done", i < step);
      });

      if (back) back.disabled = step === 0;
      if (counter) counter.textContent = String(step + 1);

      // The last step is the review step, so Next becomes Confirm there.
      const last = step === total - 1;
      if (next) next.hidden = last;
      if (confirmBtn) confirmBtn.hidden = !last;

      showError(null);
    };

    /* Every field marked data-required must have a value before Next.
       Returns the first problem in plain words, or null. */
    const validateSection = (section: HTMLElement | null): string | null => {
      if (!section) return null;

      const fields = section.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-required]");

      for (const el of Array.from(fields)) {
        if (!el.value.trim()) {
          return el.dataset["requiredMessage"] ?? "Please complete this step before continuing.";
        }
      }

      return null;
    };

    const validateStep = (): string | null => {
      const step = Number(wiz.dataset["step"] ?? "0");
      return validateSection(wiz.querySelector<HTMLElement>('[data-wizard-step="' + step + '"]'));
    };

    /* Confirm re-checks EVERY step, not just the review step it sits on.
       A field can be emptied after it was passed - clearing a farm name and
       walking forward again would otherwise write a nameless farm. The
       listener is on capture so it can stop the click before the delegated
       data-act handler on document sees it. */
    const findFirstProblem = (): { step: number; message: string } | null => {
      const sections = Array.from(
        wiz.querySelectorAll<HTMLElement>("[data-wizard-step]"),
      ).sort((a, b) => Number(a.dataset["wizardStep"]) - Number(b.dataset["wizardStep"]));

      for (const section of sections) {
        const message = validateSection(section);
        if (message) return { step: Number(section.dataset["wizardStep"]), message };
      }

      return null;
    };

    confirmBtn?.addEventListener(
      "click",
      (event) => {
        const problem = findFirstProblem();
        if (!problem) return;

        event.preventDefault();
        event.stopPropagation();

        // Jump back to the step that is actually wrong rather than reporting
        // it on the review screen, where the field is not even visible.
        wiz.dataset["step"] = String(problem.step);
        render();
        showError(problem.message);
      },
      true,
    );

    next?.addEventListener("click", () => {
      const problem = validateStep();
      if (problem) {
        showError(problem);
        return;
      }

      const step = Number(wiz.dataset["step"] ?? "0");
      wiz.dataset["step"] = String(Math.min(step + 1, total - 1));
      render();
    });

    back?.addEventListener("click", () => {
      // Nothing is cleared: going back and forward keeps every value,
      // because re-typing a farm details is exactly the frustration this
      // whole pattern exists to remove.
      const step = Number(wiz.dataset["step"] ?? "0");
      wiz.dataset["step"] = String(Math.max(step - 1, 0));
      render();
    });

    render();
  });
}

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
      /* The telegram mapper has to be here too, or filtering the list to
         "Not connected" and hitting Export would quietly hand back every
         user - and that export is exactly the chase list someone wants. */
      const rows = applyFilters(await api.getUsers(), f, {
        search: (u) => `${u.name} ${u.email} ${u.farm}`,
        date: (u) => u.dateJoined, farm: (u) => u.farm, status: (u) => u.status,
        telegram: (u) => telegramState(u),
      }).map((u) => [u.name, u.email, u.phone, u.farm, u.status, telegramState(u), u.dateJoined, u.lastActive]);
      downloadExcelSafeCsv("agroflow-users.csv", toCSV(
        ["Name", "Email", "Phone", "Farm", "Status", "Alerts", "Joined", "Last active"], rows));
      break;
    }
    case "farms": {
      const rows = applyFilters(await api.getFarms(), f, {
        search: (x) => `${x.name} ${x.owner}`, date: (x) => x.registered,
        province: (x) => x.province, region: (x) => x.region, status: (x) => x.status,
      }).map((x) => [x.name, x.owner, x.province, x.region, x.users, x.devices, x.health, x.status, x.registered]);
      downloadExcelSafeCsv("agroflow-farms.csv", toCSV(["Farm", "Owner", "Province", "Region", "Users", "Devices", "Health", "Status", "Registered"], rows));
      break;
    }
    case "hardware": {
      const rows = applyFilters(await api.getHardware(), f, {
        search: (h) => `${h.id} ${h.type} ${h.farm}`, date: (h) => h.installed,
        farm: (h) => h.farm, deviceType: (h) => h.type, status: (h) => h.status,
        maintenanceState: (h) => h.maintenanceState,
      // Uptime and battery are not measured anywhere, so they say so
      // rather than exporting 0 and an assumed "Mains".
      }).map((h) => [h.id, h.type, h.farm, h.province, h.firmware,
                     h.battery === null ? "Not reported" : h.battery,
                     "Not measured", h.status, h.maintenanceState, h.installed]);
      downloadExcelSafeCsv("agroflow-hardware.csv", toCSV(["Device", "Type", "Farm", "Province", "Firmware", "Battery", "Uptime", "Status", "Maintenance", "Installed"], rows));
      break;
    }
    case "alerts": {
      const rows = applyFilters(await api.getAlerts(), f, {
        search: (a) => `${a.id} ${a.title}`, date: (a) => a.raised, farm: (a) => a.farm ?? "",
        administrator: (a) => a.assignedTo ?? "", status: (a) => a.status,
        priority: (a) => a.priority, eventType: (a) => a.category,
      }).map((a) => [a.id, a.raised, a.category, a.title, a.farm ?? "Platform", a.user ?? "", a.assignedTo ?? "", a.priority, a.status]);
      downloadExcelSafeCsv("agroflow-alerts.csv", toCSV(["ID", "Raised", "Category", "Alert", "Farm", "User", "Assigned", "Priority", "Status"], rows));
      break;
    }
    case "maintenance": {
      const rows = applyFilters(await api.getMaintenance(), f, {
        search: (m) => `${m.id} ${m.device}`, date: (m) => m.scheduledFor,
        farm: (m) => m.farm, status: (m) => m.status, priority: (m) => m.priority,
        deviceType: (m) => m.deviceType,
      }).map((m) => [m.id, m.device, m.deviceType, m.farm, m.issue, m.priority, m.technician ?? "", m.scheduledFor, m.status, m.completedOn ?? ""]);
      downloadExcelSafeCsv("agroflow-maintenance.csv", toCSV(["Job", "Device", "Type", "Farm", "Issue", "Priority", "Technician", "Scheduled", "Status", "Completed"], rows));
      break;
    }
    case "irrigation": {
      const rows = applyFilters(await api.getIrrigationEvents(), f, {
        date: (e) => e.date, farm: (e) => e.farm, province: (e) => e.province,
        region: (e) => e.region, crop: (e) => e.crop,
        // "No estimate" rather than an empty cell or a 0: the person reading
        // the file has to be able to tell a zone with no flow rate from a
        // pump that ran and delivered nothing. The "On schedule" column is
        // gone - nothing in the schema records it, and it was exporting a
        // hardcoded "Yes" for every row.
      }).map((e) => [
        e.date, e.farm, e.zone, e.crop, e.province, e.region,
        e.litres === null ? "No estimate" : e.litres,
        e.durationMin,
      ]);
      downloadExcelSafeCsv("agroflow-irrigation.csv", toCSV(
        ["Date (SAST)", "Farm", "Zone", "Crop", "Province", "Region", "Estimated litres", "Pump minutes"],
        rows));
      break;
    }
    case "activity": {
      const rows = applyFilters(await api.getActivity(), f, {
        search: (a) => `${a.administrator} ${a.eventType}`, date: (a) => a.timestamp,
        administrator: (a) => a.administrator, farm: (a) => a.farm ?? "",
        eventType: (a) => a.eventType, status: (a) => a.outcome,
      }).map((a) => [a.timestamp, a.administrator, a.eventType, a.farm ?? "Platform", a.target ?? "", a.outcome]);
      downloadExcelSafeCsv("agroflow-platform-activity.csv", toCSV(["Timestamp", "Administrator", "Action", "Farm", "Affected", "Outcome"], rows));
      break;
    }
    /* The platform summary, as a real .xlsx.
     *
     * WHAT THIS REPLACED
     * `Object.entries(kpis)` straight into a two-column CSV. The labels were
     * therefore property names - "farmersNotReceivingAlerts" - and the file
     * opened in Excel with both columns crammed into column A, because Excel
     * splits a CSV on the locale's list separator and ours is a semicolon.
     * It was, in practice, unreadable.
     *
     * A workbook has no separator to guess, numbers stay numbers and
     * percentages stay percentages, so whoever opens it can chart or average
     * the figures instead of re-typing them. */
    case "dashboard": {
      const profile = getAdminProfile();

      const [k, allFarms, allAlerts, allRequests] = await Promise.all([
        api.getKpis(),
        api.getFarms(),
        api.getAlerts(),
        // A summary is still worth having if the request list is the one
        // thing that fails; the Requests sheet simply comes out empty.
        api.getServiceRequests().catch(() => [] as ServiceRequest[]),
      ]);

      const openAlerts = allAlerts.filter((a) => !["Resolved", "Closed"].includes(a.status));

      await exportSummaryWorkbook({
        generatedBy: profile?.name || profile?.email || "an administrator",
        sections: [
          {
            title: "Farms and farmers",
            rows: [
              { label: "Farms on the platform", value: k.totalFarms, format: "int" },
              { label: "Farmer accounts", value: k.totalUsers, format: "int" },
              { label: "Accounts active", value: k.activeUsers, format: "int" },
              {
                // The one figure on this sheet that is a problem rather than
                // a statistic: these farmers receive nothing at all - no
                // weather warning, no equipment failure, no password reset.
                label: "Farmers who would receive no alerts (Telegram not connected)",
                value: k.farmersNotReceivingAlerts,
                format: "int",
              },
            ],
          },
          {
            title: "Kits",
            rows: [
              { label: "Kits registered", value: k.totalHardware, format: "int" },
              { label: "Kits reporting in", value: k.connectedHardware, format: "int" },
              {
                label: "Share of kits online",
                // Excel's percent format multiplies by 100, so the value
                // stored has to be the fraction, not the figure shown.
                value: k.totalHardware > 0 ? k.connectedHardware / k.totalHardware : 0,
                format: "pct",
              },
            ],
          },
          {
            title: "Outstanding work",
            rows: [
              { label: "Alerts still open", value: k.activeAlerts, format: "int" },
              { label: "Maintenance jobs not finished", value: k.openMaintenance, format: "int" },
              {
                label: "Farm requests waiting for a decision",
                value: allRequests.filter((r) => r.status === "pending").length,
                format: "int",
              },
            ],
          },
        ],

        farms: allFarms.map((f) => ({
          name: f.name,
          owner: f.owner,
          location: [f.region, f.province].filter(Boolean).join(", ") || "Not set",
          zones: f.zones?.length ?? 0,
          kitsOnline: 0,
          kitsTotal: f.devices,
          status: f.status,
        })),

        alerts: openAlerts.map((a) => ({
          raised: a.raised,
          title: a.title,
          farm: a.farm ?? "Platform",
          priority: a.priority,
          status: a.status,
        })),

        requests: allRequests.map((r) => ({
          farmer: r.farmerName,
          type: r.requestType === "new_farm" ? "New farm" : "New zone",
          location: r.location ?? "Not stated",
          status: r.status,
          submitted: fmtDateTimeSast(r.createdAt),
          assignedTo: r.assignedToName ?? "Nobody yet",
          scheduledBy: r.scheduledByName ?? "",
          completedBy: r.completedByName ?? "",
        })),
      });

      // Its own message: this export ignores the page filters, unlike every
      // other one here, because it is a snapshot of the whole platform.
      return void toast("Platform summary exported.", "success");
    }
  }
  toast(`Export complete — filters applied (${rangeLabel(f)}).`, "success");
}

/* The same summary as a PDF, for printing, filing or attaching to an email.
   Built by the API, not here - see downloadSummaryPdf. */
async function exportSummaryPdf(): Promise<void> {
  try {
    await downloadSummaryPdf();
    toast("Platform summary PDF downloaded.", "success");
  } catch (error) {
    showErrorModal(
      "Could not build the summary PDF",
      error instanceof Error ? error.message : "The summary could not be built. Try again shortly.",
    );
  }
}

/* ------------------------------ detail views ----------------------------- */

async function openUserProfile(id: string): Promise<void> {
  const intent = currentPanelIntent();
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
    intent,
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
    /* No confirm button. This drawer is a read of one farmer's record, and
       its "Add note" claimed to save a note that was never written anywhere -
       profile has no notes column and nothing was holding it even for the
       session. The Administrator notes section above still shows whatever is
       on the record. */
  });
}

async function openFarmDetail(id: number): Promise<void> {
  const intent = currentPanelIntent();
  const f = api.findFarm(id);
  if (!f) return;
  const [users, hardware, alerts, maintenance, schedules, alertHistory, autoReports, farmZones] = await Promise.all([
    api.getUsers(), api.getHardware(), api.getAlerts(), api.getMaintenance(), api.getSchedules(),
    // Read-only, and allowed to fail: the rest of the drawer must still open
    // if 0033 has not been applied or the query is refused.
    getFarmAlertHistory(id).catch((e: unknown) => {
      console.warn("Could not load alert history for farm", id, e);
      return [];
    }),
    // A farm with no schedule row is the NORMAL state - automatic reports are
    // off until an admin turns them on - so this failing must not stop the
    // drawer opening either.
    getReportSchedule(id).catch((e: unknown) => {
      console.warn("Could not load the report schedule for farm", id, e);
      return null;
    }),
    // REAL zones, from the API. The "Irrigation schedules" section below is
    // still the pre-existing mock working copy (irrigation_schedule was
    // dropped in 0010), so its ids are not zone ids and cannot be used to
    // run the engine against anything.
    getReportZones(id).catch((e: unknown) => {
      console.warn("Could not load zones for farm", id, e);
      return [];
    }),
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
    intent,
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

      // What the farmer has actually been told, and whether they looked at
      // it. The section above is the OPEN alert queue; this is the record,
      // and the "Seen"/"Dismissed" column is the only way to tell whether the
      // channel is working at all. Read-only on purpose: an admin marking a
      // farmer's alert as read would destroy that evidence.
      section(
        `Alerts & advice seen by the farmer (${alertHistory.length})`,
        alertHistory.length
          ? `<div class="table-wrap"><table>
               <thead><tr><th>When</th><th>Zone</th><th>Type</th><th>Message</th><th>Status</th></tr></thead>
               <tbody>${alertHistory.slice(0, 50).map((h) => `
                 <tr>
                   <td>${esc(fmtDate(h.createdAt))}</td>
                   <td>${esc(h.zoneName)}</td>
                   <td>${h.kind === "alert" ? "Alert" : "Advice"}</td>
                   <td>${esc(h.message)}</td>
                   <td>${h.seen
                     ? `<span class="muted">${esc(h.status)}</span>`
                     : `<b>New</b>`}</td>
                 </tr>`).join("")}
               </tbody>
             </table>
             ${alertHistory.length > 50
               ? `<p class="muted">Showing the 50 most recent of ${alertHistory.length}.</p>`
               : ""}
             <p class="muted">
               "New" means nobody has opened it in the app. Advice is marked Dismissed when the
               farmer clears it; it has no separate read state.
             </p>
           </div>`
          : `<p class="muted">Nothing has been sent to this farm yet.</p>`),
      // The engine, per zone, on demand. Placed above the auto-report
      // summary because during a setup visit this is the thing somebody
      // actually clicks - it is how you prove the installation works before
      // leaving the farm.
      section(`Zones (${farmZones.length})`,
        farmZones.length
          ? `<div class="table-wrap"><table>
               <thead><tr><th>Zone</th><th>Crop</th><th>Advice</th></tr></thead>
               <tbody>${farmZones.map((z) => `
                 <tr>
                   <td>${esc(z.name)}</td>
                   <td>${esc(z.cropType ?? "Not set")}</td>
                   <td>
                     <a href="#" class="row-act" data-act="run-advice" data-id="${z.zoneId}">
                       Run advice now
                     </a>
                   </td>
                 </tr>`).join("")}
               </tbody></table>
             <p class="muted">
               Runs the FAO-56 engine for that zone today and shows what it worked out, including
               anything still missing from its setup. Advisory only - it never starts a pump.
             </p></div>`
          : `<p class="muted">No zones on this farm yet.</p>`),

      // AUTO REPORTS. Shown as a summary with an Edit action rather than an
      // inline form: the drawer is already long, and this is a setting
      // changed once when a farm is set up, not something read on every
      // visit.
      section("Automatic reports", `
        <div class="detail-list">
          <div class="detail-row">
            <span>Status</span>
            <b>${autoReports?.enabled ? esc(autoReports.description) : "Off"}</b>
          </div>
          <div class="detail-row">
            <span>Last sent</span>
            <b>${autoReports?.lastRunAt ? esc(fmtDate(autoReports.lastRunAt)) : "Never"}</b>
          </div>
        </div>
        <p class="muted">
          Off by default. The farmer can stop these themselves from the app at any time;
          only an administrator can switch them back on.
        </p>
        <button class="btn ghost sm" data-act="edit-auto-reports" data-id="${id}">
          ${autoReports?.enabled ? "Change automatic reports" : "Set up automatic reports"}
        </button>`),

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
        // This used to say a report had been generated. Nothing was: the
        // call it made is a no-op. Real farm reports are produced by the
        // live report section of the Reports page, against the API, so this
        // takes the admin there instead of claiming work it did not do.
        toast(`Choose ${f.name} under Reports to produce a report for it.`, "info");
        void navigate("reports");
      }
    },
  });
}

/* ------------------------------ action router ---------------------------- */

/* An alert's history as a timeline.
 *
 * Built from the alert's own fields and its notes rather than from the audit
 * log, for the same reason requests.ts does it: this is the CURRENT state of
 * one alert, and the audit log is the history of admin actions across the
 * platform. The two answer different questions.
 *
 * Steps that have not happened are still shown, greyed, so an admin can see
 * what is outstanding rather than only what is done. */
function alertTimeline(a: AdminAlert): string {
  const step = (label: string, when: string | null, done: boolean): string => `
    <li class="timeline-item${done ? "" : " is-pending"}">
      <span class="timeline-dot" aria-hidden="true"></span>
      <div>
        <b>${esc(label)}</b>
        <span class="timeline-when">${when ? esc(when) : "not yet"}</span>
      </div>
    </li>`;

  const resolved = ["Resolved", "Closed"].includes(a.status);

  // Notes sit in the middle of the chain in the order they were written.
  // api.addAlertNote unshifts, so the newest is first - reversed here because
  // a timeline reads downwards through time.
  const notes = [...a.notes].reverse().map((n) => `
    <li class="timeline-item">
      <span class="timeline-dot" aria-hidden="true"></span>
      <div>
        <b>Note by ${esc(n.author)}</b>
        <span class="timeline-when">${esc(n.when)}</span>
        <p class="muted">${esc(n.note)}</p>
      </div>
    </li>`).join("");

  return `<ol class="timeline">
    ${step("Raised", a.raised, true)}
    ${a.assignedTo ? step(`Assigned to ${a.assignedTo}`, null, true) : step("Assigned", null, false)}
    ${notes}
    ${step(a.status === "Closed" ? "Closed" : "Resolved", null, resolved)}
  </ol>`;
}

/* Today as yyyy-mm-dd in SAST (UTC+2, no DST).
   Shifting before slicing the ISO string is what makes this right: at 01:30
   on the 6th in Johannesburg, toISOString() still reads the 5th, so a visit
   booked late at night would default to yesterday. */
function todayIso(): string {
  return new Date(Date.now() + 2 * 60 * 60_000).toISOString().slice(0, 10);
}

/* Re-points an element at a different action so one case can delegate to
   another without duplicating it. The clone is not inserted in the document;
   handleAction only ever reads data-act and data-id off it. */
function withAct(el: HTMLElement, act: string): HTMLElement {
  const proxy = document.createElement("span");
  proxy.dataset["act"] = act;
  const id = el.dataset["id"];
  if (id) proxy.dataset["id"] = id;
  return proxy;
}

async function handleAction(el: HTMLElement): Promise<void> {
  const act = el.dataset["act"];
  const idAttr = el.dataset["id"] ?? "";
  const numId = Number(idAttr);

  switch (act) {
    /* item 2c: "Why am I seeing this?" - every link in the console opens here */
    case "why": {
      const e = getWhy(idAttr);
      if (!e) return;
      return openDrawer({ title: WHY_LINK_TEXT, subtitle: e.summary, wide: true, bodyHtml: whyHtml(e) });
    }

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
    case "send-link-code": {
      /* Follow-up for a farmer who never pressed Start in the bot. Reuses the
         handover screen's QR renderer so the team sees exactly what the
         farmer needs to scan, and can read the link out over the phone
         instead if that is easier. */
      const u = api.findUser(idAttr);

      try {
        const issued = await issueLinkCodeForFarmer(idAttr);

        showQrModal(
          u?.name ?? "this farmer",
          issued.deepLink,
          issued.expiresAt,
        );

        return;
      } catch (e) {
        showErrorModal(
          e instanceof Error
            ? e.message
            : "Unable to generate a Telegram link.",
          "Unable to generate a Telegram link",
        );

        return;
      }
    }
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
    case "create-farmer-direct": {
      const farmList = await api.getFarms().catch(() => []);

      return openDrawer({
        title: "Create farmer account",
        subtitle: "Admin sets the email and a temporary password directly.",
        fields: [
          { label: "Full name", value: "", editable: true, name: "name" },
          { label: "Email", value: "", editable: true, name: "email" },
          { label: "Temporary password", value: "", editable: true, name: "password" },
        ],
        // A farm id is a bigint nobody knows by heart. Typed wrong - and a
        // digit out is easy - the new account is attached to a stranger's
        // farm, with access to their readings.
        bodyHtml: picker({
          name: "farmId",
          label: "Farm",
          placeholder: "Search farms…",
          emptyText: "No farms on file yet. The account can be created without one.",
          options: farmList.map((f) => ({
            value: String(f.id),
            label: f.name,
            secondary: `${f.owner} · ${f.region || f.province || "Location not set"}`,
          })),
        }),
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
    }
    case "invite-farmer": {
      const farmList = await api.getFarms().catch(() => []);

      return openDrawer({
        title: "Invite farmer",
        subtitle: "Sends a one-time Supabase Auth magic link — the farmer sets their own password.",
        bodyHtml: picker({
          name: "farmId",
          label: "Farm",
          placeholder: "Search farms…",
          emptyText: "No farms on file yet. The invitation can be sent without one.",
          options: farmList.map((f) => ({
            value: String(f.id),
            label: f.name,
            secondary: `${f.owner} · ${f.region || f.province || "Location not set"}`,
          })),
        }),
        fields: [
          { label: "Full name", value: "", editable: true, name: "name" },
          { label: "Email", value: "", editable: true, name: "email" },
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
    }

    /* farms */
    case "view-farm": return openFarmDetail(numId);
    /* Register a kit, as five steps instead of a zone id typed from memory.
     *
     * WHAT WAS WRONG BEFORE
     * An enrollment code could only be made from a scheduled request, and
     * only ever for a zone chosen out of one farm's list. Registering a kit
     * for anything else meant going to the request queue and finding a row
     * that fitted - or there was no route at all. The zone is what the claim
     * resolves, so getting it wrong attaches a farmer's kit to somebody
     * else's block and the soil readings arrive against the wrong crop.
     *
     * Each picker narrows the next: a farmer's farms, that farm's zones. The
     * farm list is filtered on ownerId, not on the owner's name - two
     * farmers can share a name. */
    case "register-hardware": {
      let farmers;
      let farms;
      try {
        [farmers, farms] = await Promise.all([getFarmers(), api.getFarms()]);
      } catch (e) {
        showErrorModal(
          "Could not load the farmer and farm lists",
          e instanceof Error ? e.message : "The lists could not be retrieved.",
        );
        return;
      }

      // Only farmers who have somewhere to put a kit. Offering the rest
      // leads to an empty farm step with nothing to explain it.
      const withFarms = farmers.filter((f) => farms.some((farm) => farm.ownerId === f.id));

      if (withFarms.length === 0) {
        showErrorModal(
          "No farms to register a kit to",
          "A kit is enrolled onto a zone, and a zone belongs to a farm. Register a farm first.",
        );
        return;
      }

      return openDrawer({
        title: "Register hardware",
        wide: true,
        bodyHtml: wizard({
          id: "register-hardware",
          title: "Register a kit",
          subtitle: "Five steps. The code is created at the end.",
          confirmLabel: "Create the enrollment code",
          confirmAct: "wizard-register-hardware",
          steps: [
            {
              title: "Farmer",
              hint: "Whose kit this is.",
              bodyHtml: picker({
                name: "kitOwnerId",
                label: "Farmer",
                required: true,
                requiredMessage: "Choose whose kit this is.",
                placeholder: "Search by name or email…",
                options: withFarms.map((f) => ({
                  value: f.id,
                  label: f.name,
                  secondary: f.email,
                })),
              }),
            },
            {
              title: "Farm",
              hint: "Which of their farms.",
              bodyHtml: `
                <div id="kitFarmPicker">
                  <p class="muted">Choose a farmer first.</p>
                  <input type="hidden" data-field="kitFarmId" value="" data-required
                    data-required-message="Choose the farm this kit is going to." />
                </div>`,
            },
            {
              title: "Zone",
              hint: "The block this kit will water. This is what the kit is actually attached to.",
              bodyHtml: `
                <div id="kitZonePicker">
                  <p class="muted">Choose a farm first.</p>
                  <input type="hidden" data-field="kitZoneId" value="" data-required
                    data-required-message="Choose the zone this kit will water." />
                </div>`,
            },
            {
              title: "Kit",
              hint: "What is being installed, and what to call it.",
              bodyHtml: `
                ${picker({
                  name: "kitType",
                  label: "Kit type",
                  required: true,
                  requiredMessage: "Choose the kit type.",
                  value: KIT_TYPES[0].value,
                  options: KIT_TYPES.map((k) => ({
                    value: k.value,
                    label: k.label,
                    secondary: k.secondary,
                  })),
                  hint: "Only kits whose firmware can complete the claim are listed.",
                })}
                <label class="f">
                  Name for this kit (optional)
                  <input type="text" data-field="kitName" placeholder="e.g. North Block controller" />
                  <span class="muted">Left blank, it is named after its zone.</span>
                </label>`,
            },
            {
              title: "Review",
              hint: "Check this, then create the code.",
              bodyHtml: `<div id="kitReview" class="review-pane"></div>`,
            },
          ],
        }),

        onOpen: () => {
          wirePickers();
          wireWizards();
          wireKitWizard(farms);
        },
      });
    }

    case "wizard-register-hardware": {
      const v = collectFields();
      const zoneId = Number(v["kitZoneId"]);
      if (!zoneId) return void toast("Choose the zone this kit will water.", "warn");

      try {
        const result = await createEnrollmentCode({
          zoneId,
          deviceName: v["kitName"]?.trim() || undefined,
          deviceType: v["kitType"] || KIT_TYPES[0].value,
        });

        closeDrawer();

        // A modal, not a toast. This is a credential the installer has to
        // write down, and a toast disappears while they look for a pen.
        showErrorModal(
          "Enrollment code",
          `${result.enrollmentCode}\n\n` +
            `Give this to the installer. They enter it on the kit's setup page, once.\n` +
            `It expires ${fmtDate(result.expiresAt)} and cannot be shown again - nothing stores it in a readable form.`,
        );

        return void refresh();
      } catch (e) {
        showErrorModal(
          "Could not create the enrollment code",
          e instanceof Error ? e.message : "The code could not be created.",
        );
        return;
      }
    }

    /* Register a new farm, as four steps instead of one long form.
     *
     * WHAT WAS WRONG WITH THE FORM IT REPLACES
     * Nine fields in one drawer, the owner as a <select> of every farmer, the
     * location as free text, and the crop as a text input. Three things went
     * wrong routinely: a mistyped crop ("Grapes") produced a zone the FAO-56
     * engine cannot advise on and nothing said so; a farm got no coordinates
     * at all, so its weather lookup had nothing to go on; and a validation
     * error arrived after all nine fields were filled.
     *
     * Now: pick the farmer, place the farm on a map, describe the zones from
     * a crop list the engine actually knows, and see all of it before
     * anything is written. */
    case "add-farm": {
      let farmers;
      try {
        farmers = await getFarmers();
      } catch (e) {
        showErrorModal(
          "Could not load the farmer list",
          e instanceof Error ? e.message : "The farmer list could not be retrieved.",
        );
        return;
      }

      if (farmers.length === 0) {
        showErrorModal(
          "No farmers yet",
          "A farm belongs to a farmer, so there is nobody to register this one to. Create a farmer account first.",
        );
        return;
      }

      return openDrawer({
        title: "Register a new farm",
        wide: true,
        bodyHtml: wizard({
          id: "register-farm",
          title: "Register a new farm",
          subtitle: "Four steps. Nothing is saved until the last one.",
          confirmLabel: "Register the farm",
          confirmAct: "wizard-register-farm",
          steps: [
            {
              title: "Farmer",
              hint: "Who this farm belongs to.",
              bodyHtml: picker({
                name: "ownerId",
                label: "Farmer",
                required: true,
                requiredMessage: "Choose the farmer this farm belongs to.",
                placeholder: "Search by name or email…",
                hint: "Only existing farmer accounts can own a farm.",
                options: farmers.map((f) => ({
                  value: f.id,
                  label: f.name,
                  secondary: f.email,
                })),
              }),
            },
            {
              title: "Farm details",
              hint: "Where it is and how big it is.",
              bodyHtml: `
                <div class="fields">
                  <label class="f">
                    Farm name
                    <input
                      type="text"
                      data-field="farmName"
                      data-required
                      data-required-message="Give the farm a name."
                      placeholder="Sunrise Valley Farm"
                    />
                  </label>
                  <label class="f">
                    Nearest town or district
                    <input
                      type="text"
                      data-field="location"
                      data-required
                      data-required-message="Say roughly where the farm is."
                      placeholder="Ceres, Western Cape"
                    />
                  </label>
                  <label class="f">
                    Farm size (hectares)
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      data-field="farmSize"
                      data-required
                      data-required-message="Enter the farm size in hectares."
                      placeholder="0"
                    />
                  </label>
                </div>
                ${locationPickerHtml({})}`,
            },
            {
              title: "Zones",
              hint: "One per irrigated block. Each one gets its own advice.",
              bodyHtml: `
                <label class="f">
                  How many zones?
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value="1"
                    data-register-farm-zone-count
                  />
                </label>
                <div id="registerFarmZones"></div>`,
            },
            {
              title: "Review",
              hint: "Check this, then register.",
              bodyHtml: `<div id="registerFarmReview" class="review-pane"></div>`,
            },
          ],
        }),

        onOpen: () => {
          wirePickers();
          wireRegisterFarmZones();
          wireWizards();
          wireRegisterFarmReview();

          /* The map lives on step 2, which is display:none when the drawer
             opens, so it is mounted now and told to re-measure when the step
             becomes visible. Mounting it lazily on first reveal would be
             neater but needs an observer per wizard; this is one call. */
          const mapHost = document.querySelector<HTMLElement>("[data-map-pick]");
          if (mapHost) void mountLocationPicker(mapHost);
        },
      });
    }

    /* The wizard's Confirm. wireWizards has already re-validated every step,
       so what is missing here can only be something the steps do not mark
       required - the zone arithmetic the API also enforces. Checked here too
       so the admin is told in the drawer rather than by a 400. */
    case "wizard-register-farm": {
      const v = collectFields();

      const zoneCount = registerFarmZoneCount();
      const zones = Array.from({ length: zoneCount }, (_, i) => ({
        name: (v[`zone_name_${i}`] ?? "").trim(),
        sizeHectares: Number(v[`zone_size_${i}`]) || 0,
        cropType: v[`zone_crop_${i}`] ?? "",
      }));

      const problem = validateRegisterFarmZones(zones, Number(v["farmSize"]) || 0);
      if (problem) return void toast(problem, "warn");

      const latitude = v["latitude"] ? Number(v["latitude"]) : null;
      const longitude = v["longitude"] ? Number(v["longitude"]) : null;

      try {
        await registerFarm({
          ownerId: v["ownerId"] ?? "",
          farm: {
            farmName: (v["farmName"] ?? "").trim(),
            location: (v["location"] ?? "").trim(),
            sizeHectares: Number(v["farmSize"]) || 0,
            latitude,
            longitude,
            zones,
          },
        });

        closeDrawer();
        toast(`${v["farmName"] || "The farm"} is registered.`, "success");
        return void refresh();
      } catch (e) {
        showErrorModal(
          "Could not register the farm",
          e instanceof Error ? e.message : "The farm could not be registered.",
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
      return void navigate("farms");
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
          // Never "0.0%". Nothing measures per-kit uptime - there is no
          // telemetry table for it - and a zero reads as a kit that has
          // never once been up, which is a fault report, not a blank.
          { label: "Uptime", value: "Not measured" },
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

    /* ---- firmware v1.3.0 device actions -------------------------------
       All three are addressed by ZONE, not hardware id: the commands go
       into irrigation_commands, which is keyed on zone. The table omits
       these links for a board with no zone, so findHardware always has one
       here - the guard is for a stale render, not an expected state.

       Each one confirms first. Change WiFi takes a kit off the network,
       open setup exposes a local setup page, and revoke cuts a board off
       permanently: none of them should happen on a mis-click. */
    case "device-change-wifi": {
      const h = api.findHardware(idAttr);
      if (!h?.zoneId) return void toast("This device is not assigned to a zone.", "warn");

      return openDrawer({
        title: `Change WiFi — ${esc(h.deviceId ?? h.id)}`,
        subtitle: `${h.farm}${h.zoneName ? ` · ${h.zoneName}` : ""}`,
        bodyHtml: `<div class="muted">
            The kit will forget its current WiFi and open its own setup network. Watering keeps
            running in the meantime, on the readings it already has.
            <br><br>
            Somebody has to be AT the kit to finish this: join its setup network on a phone and
            enter the new WiFi details. Until they do, the setup page keeps reopening.
          </div>`,
        confirmLabel: "Change WiFi",
        onConfirm: () => {
          void deviceChangeWifi(h.zoneId as number)
            .then((result) => {
              // The network name and password are the whole point of the
              // success message: whoever is standing at the kit needs them.
              toast(
                `Sent. Join "${result.setupNetworkName}" (password ${result.setupNetworkPassword}) to finish.`,
                "success",
              );
              void refresh();
            })
            .catch((error: unknown) => {
              showErrorModal(
                "Could not change the kit's WiFi",
                error instanceof Error ? error.message : "The kit could not be reached.",
              );
            });
        },
      });
    }

    case "device-open-setup": {
      const h = api.findHardware(idAttr);
      if (!h?.zoneId) return void toast("This device is not assigned to a zone.", "warn");

      return openDrawer({
        title: `Open setup page — ${esc(h.deviceId ?? h.id)}`,
        subtitle: `${h.farm}${h.zoneName ? ` · ${h.zoneName}` : ""}`,
        bodyHtml: `<div class="muted">
            The kit opens its setup page but KEEPS its current WiFi, so it stays online.
            <br><br>
            If the kit is offline this command waits for it: it sits pending and is delivered
            when the board next connects.
          </div>`,
        confirmLabel: "Open setup page",
        onConfirm: () => {
          void deviceOpenSetup(h.zoneId as number)
            .then((result) => {
              toast(`Sent. The setup page is at "${result.setupNetworkName}".`, "success");
              void refresh();
            })
            .catch((error: unknown) => {
              showErrorModal(
                "Could not open the kit's setup page",
                error instanceof Error ? error.message : "The kit could not be reached.",
              );
            });
        },
      });
    }

    case "device-revoke": {
      const h = api.findHardware(idAttr);
      if (!h?.zoneId) return void toast("This device is not assigned to a zone.", "warn");

      return openDrawer({
        title: `Revoke ${esc(h.deviceId ?? h.id)}`,
        subtitle: `${h.farm}${h.zoneName ? ` · ${h.zoneName}` : ""}`,
        bodyHtml: `<div class="muted">
            <b>This cuts the board off immediately and cannot be undone.</b>
            <br><br>
            Its device token stops working, so every reading and command acknowledgement it
            sends is refused. After three refusals the board wipes its own credentials and
            reopens its setup page, which means it needs a NEW enrollment code to come back.
            <br><br>
            Its MQTT login is burned at the same time. You will then need to change that
            password in the HiveMQ console and add it back to the pool - this system cannot
            change a HiveMQ password on the free plan.
            <br><br>
            Do this for a kit that has been lost or stolen. For a kit whose WiFi has simply
            changed, use Change WiFi instead.
          </div>`,
        confirmLabel: "Revoke this device",
        onConfirm: () => {
          void deviceRevoke(h.zoneId as number)
            .then((result) => {
              // Shown as a modal, not a toast: the HiveMQ step is a manual
              // job the admin has to actually go and do, and a toast
              // disappears.
              showErrorModal("Device revoked", result.notice);
              void refresh();
            })
            .catch((error: unknown) => {
              showErrorModal(
                "Could not revoke the device",
                error instanceof Error ? error.message : "The device could not be revoked.",
              );
            });
        },
      });
    }

    case "edit-auto-reports": {
      const farmId = Number(idAttr);
      if (!farmId) return;

      const [current, zones] = await Promise.all([
        getReportSchedule(farmId).catch(() => null),
        getReportZones(farmId).catch(() => []),
      ]);

      const types = current?.reportTypes ?? ["water_usage"];
      const chosenZones = current?.zoneIds ?? null;

      const checkbox = (value: string, label: string, checked: boolean): string =>
        `<label class="drawer-field" style="flex-direction:row;align-items:center;gap:8px">
           <input type="checkbox" data-report-type="${value}" ${checked ? "checked" : ""} />
           <span>${esc(label)}</span>
         </label>`;

      return openDrawer({
        title: "Automatic reports",
        subtitle: api.findFarm(farmId)?.name ?? `Farm ${farmId}`,
        wide: true,
        bodyHtml: `
          <div class="drawer-section">
            <h6>Send automatically</h6>
            <label class="drawer-field" style="flex-direction:row;align-items:center;gap:8px">
              <input type="checkbox" id="autoReportsEnabled" ${current?.enabled ? "checked" : ""} />
              <span>Automatic reports on</span>
            </label>
            <p class="muted">
              Off by default. Weekly reports go out on Monday at 07:00; monthly ones on the 1st
              at 07:00, South African time. They cover the week or month that has just finished.
            </p>
          </div>

          <div class="drawer-section">
            <h6>How often</h6>
            <label class="drawer-field">
              <span>Frequency</span>
              <select id="autoReportsFrequency" class="input">
                <option value="weekly" ${current?.frequency !== "monthly" ? "selected" : ""}>
                  Weekly (Monday 07:00)
                </option>
                <option value="monthly" ${current?.frequency === "monthly" ? "selected" : ""}>
                  Monthly (1st, 07:00)
                </option>
              </select>
            </label>
          </div>

          <div class="drawer-section">
            <h6>Which reports</h6>
            ${checkbox("water_usage", "Water usage", types.includes("water_usage"))}
            ${checkbox("moisture", "Soil moisture", types.includes("moisture"))}
            ${checkbox("schedule", "Watering schedule & advice", types.includes("schedule"))}
            <p class="muted">
              Soil moisture is per zone, so a farm with four zones gets four of those. The other
              two cover the whole farm.
            </p>
          </div>

          <div class="drawer-section">
            <h6>Which zones</h6>
            <label class="drawer-field">
              <span>Zones</span>
              <select id="autoReportsZones" class="input" multiple size="${Math.min(6, Math.max(3, zones.length + 1))}">
                <option value="all" ${chosenZones === null ? "selected" : ""}>All zones</option>
                ${zones.map((z) =>
                  `<option value="${z.zoneId}" ${chosenZones?.includes(z.zoneId) ? "selected" : ""}>
                     ${esc(z.name)}
                   </option>`).join("")}
              </select>
            </label>
            <p class="muted">
              Leave "All zones" selected to include any zone added later.
            </p>
          </div>

          <div class="drawer-section">
            <p class="muted">
              Delivered in the app always, and on Telegram as well for a farmer who has connected
              it. The farmer can stop these themselves at any time.
            </p>
          </div>
        `,
        confirmLabel: "Save",
        onConfirm: () => {
          const enabled =
            (document.getElementById("autoReportsEnabled") as HTMLInputElement | null)?.checked ?? false;
          const frequency =
            ((document.getElementById("autoReportsFrequency") as HTMLSelectElement | null)?.value ??
              "weekly") as "weekly" | "monthly";

          const reportTypes = [...document.querySelectorAll<HTMLInputElement>("[data-report-type]")]
            .filter((el) => el.checked)
            .map((el) => el.dataset["reportType"] ?? "")
            .filter(Boolean);

          const zoneSelect = document.getElementById("autoReportsZones") as HTMLSelectElement | null;
          const picked = [...(zoneSelect?.selectedOptions ?? [])].map((o) => o.value);
          // "All zones" wins if it is selected at all - null means every
          // zone, including ones added later, which is almost always what is
          // meant. An empty array would mean "no zones" and send nothing.
          const zoneIds = picked.includes("all") || picked.length === 0
            ? null
            : picked.map(Number).filter(Number.isFinite);

          if (enabled && reportTypes.length === 0) {
            toast("Choose at least one report to send.", "warn");
            return;
          }

          void saveReportSchedule(farmId, { enabled, frequency, reportTypes, zoneIds })
            .then((saved) => {
              toast(saved.enabled ? saved.description : "Automatic reports are off.", "success");
              void refresh();
            })
            .catch((error: unknown) => {
              showErrorModal(
                "Could not save the automatic reports",
                error instanceof Error ? error.message : "The setting could not be saved.",
              );
            });
        },
      });
    }

    case "toggle-archived-farms":
      setShowArchivedFarms(!getShowArchivedFarms());
      return void refresh();

    /* ARCHIVE, not delete. The confirm text spells out the difference
       because the two buttons sit next to each other and the farm being
       archived is usually test data somebody is trying to tidy away - which
       is exactly the moment a mis-click is most likely and most costly. */
    case "archive-farm": {
      const farmId = Number(idAttr);
      const farm = api.findFarm(farmId);
      if (!farm) return;

      return openDrawer({
        title: `Archive ${farm.name}`,
        subtitle: `${farm.owner} · ${farm.province}`,
        bodyHtml: `<div class="muted">
            This hides the farm and its zones from the farm list, from reports and from
            automatic reports.
            <br><br>
            <b>Nothing is deleted.</b> Every sensor reading, watering event and alert is kept,
            and you can bring the farm back at any time with "Show archived" then Restore.
            <br><br>
            Use this for test and demo farms. Use Delete only when the data itself should go.
          </div>`,
        confirmLabel: "Archive this farm",
        onConfirm: () => {
          void archiveFarm(farmId)
            .then((r) => {
              toast(r.message, "success");
              void refresh();
            })
            .catch((error: unknown) => {
              showErrorModal(
                "Could not archive the farm",
                error instanceof Error ? error.message : "The farm could not be archived.",
              );
            });
        },
      });
    }

    case "restore-farm": {
      const farmId = Number(idAttr);
      if (!farmId) return;

      await restoreFarm(farmId)
        .then((r) => toast(r.message, "success"))
        .catch((error: unknown) =>
          showErrorModal(
            "Could not restore the farm",
            error instanceof Error ? error.message : "The farm could not be restored.",
          ),
        );

      return void refresh();
    }

    /* "Run advice now" on a zone. The point is to be able to SHOW the
       engine working during setup and the presentation, so the result is
       laid out as the numbers somebody checking it reads in order - and,
       when it cannot answer, the named missing fields rather than a blank
       panel. */
    case "run-advice": {
      const zoneId = Number(idAttr);
      if (!zoneId) return void toast("No zone selected.", "warn");

      toast("Running the advice engine…", "success");

      try {
        const r = await runAdviceNow(zoneId);

        const row = (label: string, value: string): string =>
          `<div class="detail-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;

        const num = (v: number | null, unit: string): string =>
          v === null ? "Not known" : `${v} ${unit}`;

        return openDrawer({
          title: `Advice for ${r.zoneName}`,
          subtitle: `Engine run for ${r.ranFor}`,
          wide: true,
          bodyHtml: `
            <div class="drawer-section">
              <h6>Crop and season</h6>
              <div class="detail-list">
                ${row("Crop", r.crop ?? "Not set")}
                ${row("Stage", r.stage ?? "Not known")}
                ${row("Day of season", r.dayOfSeason === null ? "Not known" : String(r.dayOfSeason))}
                ${row("Soil", r.soilWasDefaulted ? `${r.soil} (defaulted)` : r.soil)}
              </div>
            </div>

            <div class="drawer-section">
              <h6>Water need today</h6>
              <div class="detail-list">
                ${row("Crop used today (ETc)", num(r.etcTodayMm, "mm"))}
                ${row("Reference (ET0)", num(r.etoTodayMm, "mm"))}
                ${row("Soil water used up", num(r.depletionMm, "mm"))}
                ${row("Can be used before stress", num(r.readilyAvailableMm, "mm"))}
                ${row("Soil can hold", num(r.totalAvailableMm, "mm"))}
                ${row("Suggested water", num(r.recommendedLitres, "L"))}
                ${row("Suggested run time", r.recommendedMinutes === null ? "Not known" : `${r.recommendedMinutes} min`)}
                ${row("Soil moisture", num(r.moisturePercent, "%"))}
              </div>
            </div>

            <div class="drawer-section">
              <h6>Next watering</h6>
              <div class="detail-list">
                ${row("Days until needed", r.daysToNextWatering === null ? "Not known" : String(r.daysToNextWatering))}
                ${row("Expected date", r.nextWateringDate ?? "Not known")}
                ${row("Water balance ran", r.balanceRan ? "Yes" : "No")}
              </div>
            </div>

            ${r.setupMissing.length ? `
              <div class="drawer-section">
                <h6>Still needed before the engine can advise fully</h6>
                <ul class="drawer-list">
                  ${r.setupMissing.map((m) => `<li>${esc(m)}</li>`).join("")}
                </ul>
              </div>` : ""}

            ${r.limitations.length ? `
              <div class="drawer-section">
                <h6>Limitations</h6>
                <ul class="drawer-list">
                  ${r.limitations.map((m) => `<li>${esc(m)}</li>`).join("")}
                </ul>
              </div>` : ""}

            <div class="drawer-section">
              <h6>Advice written for the farmer (${r.insights.length})</h6>
              ${r.insights.length
                ? `<ul class="drawer-list">${r.insights.map((i) =>
                    `<li><b>${esc(i.severity)}</b> — ${esc(i.message)} ${whyLink(asExplanation(i.explanation))}</li>`).join("")}</ul>`
                : `<p class="muted">Nothing to tell the farmer today.</p>`}
            </div>

            <p class="muted">
              Advisory only. This writes the same rows the nightly pass writes and never
              starts or stops a pump.
            </p>`,
        });
      } catch (error) {
        showErrorModal(
          "The advice engine could not run",
          error instanceof Error ? error.message : "The engine did not answer.",
        );
        return;
      }
    }

    /* ---- Home: the attention queue and the KPI tiles ----------------
       Each one lands on the list it counts, already filtered, so the admin
       never arrives at a page and has to find the thing again. */
    case "go-requests-pending":
      setFilter("requests", { status: "pending" });
      return void showPage("requests");

    case "go-alerts-critical":
      setFilter("alerts", { priority: "Critical" });
      return void showPage("alerts");

    case "go-kits-offline":
      setFilter("hardware", { status: "Offline" });
      return void showPage("hardware");

    case "go-zones-setup":
      // Farms and zones, where the list itself highlights which field each
      // zone is missing.
      return void navigate("farms");

    case "go-users-no-telegram":
      setFilter("users", { search: "" });
      return void showPage("users");

    case "go-reports-failed":
      return void navigate("reports");

    case "go-farms":
      return void navigate("farms");
    case "go-users":
      return void navigate("users");
    case "go-kits":
      return void navigate("hardware");
    case "go-alerts":
      return void navigate("alerts");
    case "go-maintenance":
      return void navigate("maintenance");

    /* ---- Health ------------------------------------------------------ */
    case "open-health":
      // Home holds the card. If we are already there, scroll to it rather
      // than re-rendering the page under the admin.
      if (appState.activePage === "dashboard") {
        document.getElementById("systemHealth")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      return void navigate("dashboard");

    case "refresh-health":
      await refreshHealthPanel();
      return;

    /* The one rule this enforces: never a frozen page. Any page that failed
       to load renders a Retry that comes back here. */
    case "retry-page":
      return void refresh();

    /* One request, end to end: what was asked for, who has touched it, and
       every recorded change to it.
       The state chain comes off the row (service_request's own columns); the
       history below it comes from the audit log, which is the only place that
       knows a status was changed twice or set back. */
    case "view-request": {
      const requestId = Number(idAttr);
      if (!requestId) return;
      const intent = currentPanelIntent();

      const requests = await api.getServiceRequests();
      const request = requests.find((r) => r.id === requestId);
      if (!request) return void toast("That request could not be found.", "warn");

      // The log is a nicety on this panel, not the panel itself: if 0037 has
      // not been applied the details must still open.
      const history = await getEntityTimeline("service_request", String(requestId))
        .catch(() => [] as AuditRow[]);

      return openDrawer({
        intent,
        title: `${request.farmerName}`,
        subtitle: request.requestType === "new_farm" ? "New farm request" : "New zone request",
        wide: true,
        bodyHtml: `
          <div class="drawer-section"><h6>What was asked for</h6>
            ${detailList([
              ["Farm", esc(request.farmName ?? "New farm request")],
              ["Crop", esc(formatCrop(request.cropType))],
              ["Rough size", request.roughSize !== null ? `${request.roughSize} ha` : "Not stated"],
              ["Location", esc(request.location ?? "Not stated")],
              ["Contact", esc(request.farmerEmail || "Not on file")],
              ["Notes", esc(request.notes ?? "None")],
            ])}
          </div>
          <div class="drawer-section"><h6>Where it has got to</h6>
            ${requestTimeline(request)}
          </div>
          <div class="drawer-section"><h6>Recorded changes</h6>
            ${timelineHtml(history, "Nothing recorded against this request yet.")}
          </div>`,
        confirmLabel: "Close",
        onConfirm: () => undefined,
      });
    }

    /* Who is dealing with a request.
       A picker over real admin profiles, not a text field - the whole point
       of recording an owner is that the name means a specific person. */
    case "assign-request": {
      const requestId = Number(idAttr);
      if (!requestId) return;

      const [requests, candidates] = await Promise.all([
        api.getServiceRequests(),
        api.getAdministrators().catch(() => []),
      ]);

      const request = requests.find((r) => r.id === requestId);
      if (!request) return void toast("That request could not be found.", "warn");

      if (candidates.length === 0) {
        return void toast("No administrator accounts to assign to.", "warn");
      }

      return openDrawer({
        title: "Assign this request",
        subtitle: `${request.farmerName} · ${request.requestType === "new_farm" ? "New farm" : "New zone"}`,
        bodyHtml: `
          ${picker({
            name: "assignee",
            label: "Assign to",
            value: request.assignedToProfileId ?? "",
            placeholder: "Search administrators…",
            options: candidates.map((u) => ({
              value: u.id,
              label: u.name || u.email,
              secondary: u.email,
            })),
          })}
          <p class="muted">
            Assigning does not change the status. Somebody usually picks a request up before it
            is scheduled, and "booked, nobody owns it yet" is a real state worth being able to see.
          </p>`,
        confirmLabel: "Save",
        onConfirm: (values) => {
          const assignee = values["assignee"] ?? "";

          void assignRequest(requestId, assignee || null)
            .then((r) => {
              toast(r.message, "success");
              void refresh();
            })
            .catch((error: unknown) => {
              showErrorModal(
                "Could not assign the request",
                error instanceof Error ? error.message : "The request could not be assigned.",
              );
            });
        },
      });
    }

    /* The activity log, as a file. CSV for anything, XLSX for the one people
       actually open in Excel - see item 7 for why the plain CSV was useless
       in a South African locale. */
    case "export-activity-csv": {
      const log = await getActivityLog();

      // downloadExcelSafeCsv, not downloadCSV: the plain one produced a file
      // Excel opened with every value in column A on a South African
      // machine. See lib/workbook.ts.
      downloadExcelSafeCsv(
        "agroflow-activity",
        toCSV(
          ["When (SAST)", "Who", "What happened", "Farm", "Action code"],
          log.rows.map((r) => [
            fmtDateTimeSast(r.createdAt),
            r.actorName,
            r.summary,
            r.farmName ?? "",
            r.action,
          ]),
        ),
      );

      return void toast(`Exported ${log.rows.length} actions.`, "success");
    }

    case "export-dashboard-pdf":
      return void exportSummaryPdf();

    case "export-activity-xlsx": {
      const log = await getActivityLog();
      await exportActivityWorkbook(log.rows);
      return void toast(`Exported ${log.rows.length} actions.`, "success");
    }

    case "go-mqtt-logins":
      return void navigate("mqttLogins");

    case "go-onboarding":
      // A new_farm request has no farm yet, so there is no zone to enrol a
      // kit onto. Send the admin through the existing zone setup flow first
      // rather than offering an action that cannot work.
      toast("Set up the farm and its zones first, then create the enrollment code.", "warn");
      return void navigate("onboarding");

    /* The code the installer types into the kit's setup page.
       Uses the EXISTING generator (POST /api/devices/enroll) unchanged -
       single-use, 24 hours, and the only authorisation the claim needs. */
    case "create-enrollment-code": {
      const requests = await api.getServiceRequests();
      const request = requests.find((r) => String(r.id) === idAttr);

      if (!request) return void toast("That request could not be found.", "warn");

      if (request.farmId === null) {
        toast("This request has no farm yet. Set up the farm and its zones first.", "warn");
        return void navigate("onboarding");
      }

      let zones;
      try {
        zones = await getReportZones(request.farmId);
      } catch (error) {
        showErrorModal(
          "Could not load the farm's zones",
          error instanceof Error ? error.message : "The zone list could not be retrieved.",
        );
        return;
      }

      if (zones.length === 0) {
        // The farm exists but has no zones. Same answer as a new_farm
        // request: the zone has to exist before a kit can be enrolled onto
        // it, because hardware.zone_id is what the claim resolves.
        toast("This farm has no zones yet. Add one first, then create the code.", "warn");
        return void navigate("onboarding");
      }

      return openDrawer({
        title: "Create enrollment code",
        subtitle: `${request.farmName ?? "Farm"} · ${request.farmerName}`,
        bodyHtml: `
          <div class="drawer-field">
            <span>Zone</span>
            <select data-field="zoneId" class="input" style="width:100%">
              ${zones
                .map(
                  (z) =>
                    `<option value="${z.zoneId}">${esc(z.name)}${
                      z.cropType ? ` · ${esc(z.cropType)}` : ""
                    }</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="muted" style="margin-top:12px">
            The code is single-use and expires in 24 hours. It is shown ONCE - there is no way to
            look it up again, because nothing stores it in a readable form. If it is lost, make
            another.
          </div>
        `,
        confirmLabel: "Create code",
        onConfirm: (values) => {
          const zoneId = Number(values["zoneId"]);
          if (!zoneId) return void toast("Pick a zone first.", "warn");

          void createEnrollmentCode({ zoneId })
            .then((result) => {
              // A modal, not a toast. This is a credential the installer has
              // to write down or type, and a toast disappears while they are
              // still looking for a pen.
              showErrorModal(
                "Enrollment code",
                `${result.enrollmentCode}

` +
                  `Give this to the installer. They enter it on the kit's setup page, once.
` +
                  `It expires ${fmtDate(result.expiresAt)} and cannot be shown again.`,
              );
              void refresh();
            })
            .catch((error: unknown) => {
              showErrorModal(
                "Could not create the enrollment code",
                error instanceof Error ? error.message : "The code could not be created.",
              );
            });
        },
      });
    }

    case "add-mqtt-logins": {
      const box = document.getElementById("mqttPasteBox") as HTMLTextAreaElement | null;
      const pasted = box?.value ?? "";

      if (!pasted.trim()) {
        return void toast("Paste at least one username and password first.", "warn");
      }

      try {
        const result = await addMqttLogins(pasted);

        // Clear the box on success, so a second click cannot re-submit the
        // same batch and make the duplicate count look like a problem.
        if (box) box.value = "";

        toast(result.message, result.added > 0 ? "success" : "warn");

        if (result.runningLow) {
          toast(
            `Only ${result.freeCount} free login(s) left - create more in the HiveMQ console.`,
            "warn",
          );
        }

        return void refresh();
      } catch (error) {
        showErrorModal(
          "Could not add the logins",
          error instanceof Error ? error.message : "The logins could not be stored.",
        );
        return;
      }
    }
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
        bodyHtml: picker({
          name: "tech",
          label: "Technician",
          required: true,
          requiredMessage: "Choose a technician.",
          placeholder: "Search technicians…",
          options: TECHNICIANS.map((t) => ({ value: t, label: t })),
        }),
        fields: [
          // Today, not a date hardcoded during development - that one is now
          // in the past, so every scheduled visit defaulted to overdue.
          { label: "Date", value: todayIso(), editable: true, name: "date" },
        ],
        confirmLabel: "Schedule",
        /* The maintenance list is a session working copy - there is no
           writer for it (see data/api.ts's header). scheduleVisit at least
           puts the date and status on the row in front of the admin, which
           is honest optimistic feedback; the old toast claimed a booking
           that existed nowhere, not even on screen. */
        onConfirm: (v) => {
          void api.scheduleVisit(idAttr, v["date"] ?? "").then(() => {
            toast("Visit put on the job for this session.", "info");
            void refresh();
          });
        },
      });
    // The old free-text version of this wrote nothing at all - it toasted
    // "registered (demo)" and the kit never existed. Kept as an alias so an
    // older bookmark or button still reaches the real wizard.
    case "add-device":
      return handleAction(withAct(el, "register-hardware"));

    /* alerts */
    case "view-alert": {
      const a = api.findAlert(idAttr);
      if (!a) return;
      // Item 2c: the alert's own explanation, if it has one (migration 0039).
      // The panel intent is taken BEFORE the await (item 0b): if another
      // panel is asked for meanwhile, this one must not open over it.
      const alertIntent = currentPanelIntent();
      const alertWhy = await api.getAlertExplanation(a.id).catch(() => null);
      return openDrawer({
        intent: alertIntent,
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
          ${alertWhy ? `<div class="drawer-section"><h6>${esc(WHY_LINK_TEXT)}</h6>${whyHtml(alertWhy)}</div>` : ""}
          <div class="drawer-section"><h6>History</h6>
            ${alertTimeline(a)}
          </div>`,
        confirmLabel: "Resolve alert",
        onConfirm: () => {
          void api.setAlertStatus(a.id, "Resolved").then(() => {
            toast(`${a.id} resolved.`, "success"); void refresh();
          });
        },
      });
    }
    /* A picker over real administrator accounts. Typing a name into a text
       field meant "Leruo", "leruo" and "L. Mosiane" were three different
       assignees as far as the Assigned-to filter was concerned. */
    case "assign-alert": {
      const admins = await api.getAdministrators().catch(() => []);

      if (admins.length === 0) {
        return void toast("No administrator accounts to assign to.", "warn");
      }

      const current = api.findAlert(idAttr);

      return openDrawer({
        title: `Assign ${idAttr}`,
        subtitle: current?.title,
        bodyHtml: picker({
          name: "admin",
          label: "Assign to",
          value: current?.assignedTo ?? "",
          placeholder: "Search administrators…",
          options: admins.map((u) => ({
            value: u.name || u.email,
            label: u.name || u.email,
            secondary: u.email,
          })),
        }),
        confirmLabel: "Assign",
        onConfirm: (v) => {
          void api.assignAlert(idAttr, v["admin"] ?? "").then(() => {
            toast("Alert assigned.", "success"); void refresh();
          });
        },
      });
    }
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
        // A name typed by hand meant the same person appeared as three
        // different technicians in the Assigned-to filter.
        bodyHtml: picker({
          name: "tech",
          label: "Technician",
          required: true,
          requiredMessage: "Choose a technician.",
          placeholder: "Search technicians…",
          options: TECHNICIANS.map((t) => ({ value: t, label: t })),
        }),
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
        bodyHtml: picker({
          name: "tech",
          label: "Technician",
          required: true,
          requiredMessage: "Choose a technician.",
          placeholder: "Search technicians…",
          options: TECHNICIANS.map((t) => ({ value: t, label: t })),
        }),
        fields: [
          { label: "Device ID", value: "", editable: true, name: "device" },
          { label: "Issue", value: "", editable: true, name: "issue" },
          { label: "Date", value: todayIso(), editable: true, name: "date" },
        ],
        confirmLabel: "Schedule",
        /* The maintenance list is a session working copy - there is no
           writer for it (see data/api.ts's header). scheduleVisit at least
           puts the date and status on the row in front of the admin, which
           is honest optimistic feedback; the old toast claimed a booking
           that existed nowhere, not even on screen. */
        onConfirm: (v) => {
          void api.scheduleVisit(idAttr, v["date"] ?? "").then(() => {
            toast("Visit put on the job for this session.", "info");
            void refresh();
          });
        },
      });

    /* The view/edit/delete-schedule handlers are gone with the table that
       linked to them. They read api.findSchedule, which reads a working copy
       that is permanently empty: irrigation_schedule was dropped in migration
       0010 and schedules live as columns on the zone now. Nothing could ever
       reach them, and the Edit one offered to save a "cadence" no part of the
       system has had for several migrations. */

    /* reports */
    case "generate-report": {
      const name = el.dataset["report"] ?? "Report";
      await api.logReportGenerated(name);
      return toast(`${name} generated for ${rangeLabel(getFilter("reports"))}.`, "success");
    }
    /* Excel is real now - the same rows the CSV export writes, in a workbook
       Excel opens without guessing a separator.

       PDF is NOT offered for these cards any more. There is no per-report-type
       PDF generator for them, and the button toasted "(demo)" while producing
       no file. The Reports page's live report section does produce real PDFs,
       from the API, so that is where the admin is sent. */
    case "export-report-excel": {
      const name = el.dataset["report"] ?? "Report";
      const f = getFilter("reports");

      const events = applyFilters(await api.getIrrigationEvents(), f, {
        date: (e) => e.date, farm: (e) => e.farm,
        province: (e) => e.province, region: (e) => e.region,
      });

      await exportRowsWorkbook(
        `agroflow-${name.toLowerCase().replace(/\s+/g, "-")}`,
        name,
        ["Date (SAST)", "Farm", "Region", "Crop", "Estimated litres"],
        events.slice(0, 500).map((e) => [
          fmtDate(e.date), e.farm, e.region, e.crop,
          e.litres === null ? "No estimate" : e.litres,
        ]),
      );

      return void toast(`${name} exported.`, "success");
    }
    case "export-report-csv": {
      const name = el.dataset["report"] ?? "Report";
      const f = getFilter("reports");
      const events = applyFilters(await api.getIrrigationEvents(), f, {
        date: (e) => e.date, farm: (e) => e.farm,
        province: (e) => e.province, region: (e) => e.region,
      });
      const rows = events.slice(0, 500).map((e) => [
        e.date, e.farm, e.region, e.crop,
        e.litres === null ? "No estimate" : e.litres,
      ]);
      downloadExcelSafeCsv(`agroflow-${name.toLowerCase().replace(/\s+/g, "-")}.csv`,
        toCSV(["Date", "Farm", "Region", "Crop", "Estimated litres"], rows));
      await api.logReportGenerated(`${name} (CSV)`);
      return toast(`${name} exported.`, "success");
    }
    case "run-comparison": return runComparison();    
    case "live-report-view": return liveReportRun(el.dataset["report"] ?? "", false);
    case "live-report-pdf": return liveReportRun(el.dataset["report"] ?? "", true);
    case "live-report-xlsx": return liveReportXlsx();
    /* A real file, from what is on screen. The comparison table is rendered
       into #cmpResult by runComparison; reading it back is what makes
       this export match exactly what the admin is looking at, rather than
       re-running the comparison and risking a different answer. */
    case "export-comparison": {
      const rows = collectComparisonRows();

      if (rows.length === 0) {
        return void toast("Run a comparison first - there is nothing to export yet.", "warn");
      }

      downloadExcelSafeCsv(
        "agroflow-comparison",
        toCSV(["Group", "Period A (kL)", "Period B (kL)", "Change"], rows),
      );

      return void toast("Comparison exported.", "success");
    }

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
    /* Settings that actually write somewhere (item 2).
       The twenty-odd fake fields they replace are gone, along with
       save-settings, manage-roles, backup-now, restore and download-backup -
       each of which reported a success for work nothing did. */
    // The Retry on either Settings panel's error state.
    case "go-settings-account":
      return void refreshMyTelegramStatus();

    case "go-settings-thresholds":
      return void loadPlatformThresholds();

    case "save-my-profile": {
      const v = collectFields();
      const name = (v["myName"] ?? "").trim();

      if (name.length === 0) {
        return void toast("Your name cannot be blank.", "warn");
      }

      try {
        await updateMyProfile({ name, phone: (v["myPhone"] ?? "").trim() || null });
        toast("Your details are saved.", "success");

        // The header shows the signed-in admin's name, so it has to be told.
        await refreshAdminProfile();
        updateHeaderIdentity();
      } catch (error) {
        showErrorModal(
          "Could not save your details",
          error instanceof Error ? error.message : "Your details could not be saved.",
        );
      }

      return;
    }

    case "change-my-password": {
      const v = collectFields();
      const password = v["newPassword"] ?? "";
      const again = v["newPasswordAgain"] ?? "";

      // Checked here as well as by Supabase so the answer arrives in the
      // page rather than as an API error, and so the mismatch case - which
      // Supabase cannot see at all - is caught.
      if (password.length < 8) {
        return void toast("Use at least 8 characters.", "warn");
      }

      if (password !== again) {
        return void toast("The two passwords do not match.", "warn");
      }

      try {
        await changeMyPassword(password);

        // Cleared from the DOM immediately. A password sitting in an input
        // survives every later screenshot and shoulder-glance.
        document.querySelectorAll<HTMLInputElement>(
          '[data-field="newPassword"], [data-field="newPasswordAgain"]',
        ).forEach((el) => { el.value = ""; });

        toast("Your password is changed.", "success");
      } catch (error) {
        showErrorModal(
          "Could not change your password",
          error instanceof Error ? error.message : "The password could not be changed.",
        );
      }

      return;
    }

    case "connect-my-telegram": {
      try {
        const result = await requestMyTelegramCode();

        // A modal, not a toast: this is a code somebody has to read and use,
        // and a toast disappears while they are still finding the app.
        showErrorModal(
          "Connect Telegram",
          `${result.code}\n\n` +
            (result.deepLink
              ? `Open this link on the phone with Telegram: ${result.deepLink}\n\n`
              : "") +
            `Send this code to the AgroFlow bot. It expires ${fmtDateTimeSast(result.expiresAt)} ` +
            `and can be used once.`,
        );

        await refreshMyTelegramStatus();
      } catch (error) {
        showErrorModal(
          "Could not create a connect code",
          error instanceof Error ? error.message : "The code could not be created.",
        );
      }

      return;
    }

    case "disconnect-my-telegram": {
      const confirmed = window.confirm(
        "Disconnect Telegram?\n\n" +
        "You will stop receiving platform messages there until you connect again.",
      );

      if (!confirmed) return;

      try {
        await disconnectMyTelegram();
        toast("Telegram disconnected.", "info");
        await refreshMyTelegramStatus();
      } catch (error) {
        showErrorModal(
          "Could not disconnect Telegram",
          error instanceof Error ? error.message : "Telegram could not be disconnected.",
        );
      }

      return;
    }
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

      // Skipped, not counted as zero. A comparison between two periods is
      // exactly where a silent zero does the most damage: it reads as a real
      // drop in water use rather than as a zone nobody set a flow rate on.
      if (e.litres === null) continue;

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

/* The Settings page's two asynchronous panels.
 *
 * Rendered empty by settingsTabBody and filled here, because a tab body is a
 * synchronous string and both of these need the network. Each one handles its
 * own failure in place: a Telegram status that cannot be fetched must not
 * take the rest of the page down with it. */
export async function refreshMyTelegramStatus(): Promise<void> {
  const host = document.getElementById("myTelegramStatus");
  if (!host) return;

  try {
    const status = await getMyTelegramStatus();

    host.innerHTML = status.linked
      ? `<p>Connected. Platform messages reach you on Telegram.</p>
         <div class="form-foot">
           <button class="btn ghost" data-act="disconnect-my-telegram">Disconnect</button>
         </div>`
      : `<p class="muted">
           Not connected. You will not receive platform messages on Telegram until you connect.
         </p>
         <div class="form-foot">
           <button class="btn" data-act="connect-my-telegram">Connect Telegram</button>
         </div>`;
  } catch (error) {
    host.innerHTML = errorState({
      title: "Telegram status could not be checked",
      detail: error instanceof Error ? error.message : "The server did not answer.",
      retryAct: "go-settings-account",
    });
  }
}

export async function loadPlatformThresholds(): Promise<void> {
  const host = document.getElementById("platformThresholds");
  if (!host) return;

  try {
    const { groups } = await getPlatformConfig();

    host.innerHTML = groups.map((group) => `
      <div class="settings-block">
        <h4>${esc(group.title)}</h4>
        ${detailList(group.values.map((v) => [v.label, esc(v.value)] as [string, string]))}
        ${group.values.map((v) => `<p class="muted sm">${esc(v.label)}: ${esc(v.explains)}</p>`).join("")}
        <p class="muted">Set in: ${esc(group.setIn)}. Changing one needs a restart of the API.</p>
      </div>`).join("");
  } catch (error) {
    host.innerHTML = errorState({
      title: "The platform thresholds could not be read",
      detail: error instanceof Error ? error.message : "The server did not answer.",
      retryAct: "go-settings-thresholds",
    });
  }
}

/* The comparison table's rows, read back out of the DOM.
 *
 * Reading the rendered table rather than recomputing is deliberate: the
 * export then matches exactly what the admin is looking at. Recomputing would
 * re-read the filters, and if anything had changed since they pressed Compare
 * the file would disagree with the screen - which is the one thing an export
 * must never do. */
function collectComparisonRows(): string[][] {
  const host = document.getElementById("cmpResult");
  if (!host) return [];

  return Array.from(host.querySelectorAll("tbody tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? ""),
  );
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
    const count = registerFarmZoneCount();

    // What was already typed is read before the rebuild and put back after.
    // Nudging the count from 3 to 4 used to wipe the first three zones.
    const existing = collectFields();

    container.innerHTML = Array.from(
      { length: count },
      (_, i) => zoneRow(i),
    ).join("");

    container
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]")
      .forEach((el) => {
        const name = el.dataset["field"] ?? "";
        if (existing[name]) el.value = existing[name];
      });
  };

  countInput.addEventListener("input", renderZones);

  renderZones();
}


/* The kit wizard's two dependent steps.
 *
 * Each one is rebuilt when the step before it changes, rather than rendered
 * once from everything: a farm list that still shows the previous farmer's
 * farms is how a kit ends up on the wrong property. Rebuilding also clears
 * the hidden field, so a stale zone id cannot survive a change of farm and
 * be submitted. */
function wireKitWizard(farms: Farm[]): void {
  const wiz = document.querySelector<HTMLElement>('[data-wizard="register-hardware"]');
  if (!wiz) return;

  const farmHost = document.getElementById("kitFarmPicker");
  const zoneHost = document.getElementById("kitZonePicker");
  const review = document.getElementById("kitReview");
  if (!farmHost || !zoneHost || !review) return;

  let chosenFarmName = "";
  let chosenZoneName = "";

  const renderZonePlaceholder = (message: string): void => {
    chosenZoneName = "";
    zoneHost.innerHTML = `
      <p class="muted">${esc(message)}</p>
      <input type="hidden" data-field="kitZoneId" value="" data-required
        data-required-message="Choose the zone this kit will water." />`;
  };

  const renderReview = (): void => {
    const v = collectFields();
    const kit = KIT_TYPES.find((k) => k.value === v["kitType"]);

    review.innerHTML = detailList([
      ["Farm", esc(chosenFarmName || "Not chosen")],
      ["Zone", esc(chosenZoneName || "Not chosen")],
      ["Kit type", esc(kit?.label ?? v["kitType"] ?? "Not chosen")],
      ["Kit name", esc(v["kitName"]?.trim() || "Named after its zone")],
    ]) + `
      <p class="muted">
        Creating the code does not install anything. It makes a single-use credential,
        valid for 24 hours, that the installer enters on the kit once.
      </p>`;
  };

  wiz.addEventListener("picker:change", (event) => {
    const detail = (event as CustomEvent<{ name: string; value: string }>).detail;

    if (detail.name === "kitOwnerId") {
      const theirs = farms.filter((f) => f.ownerId === detail.value);

      chosenFarmName = "";
      renderZonePlaceholder("Choose a farm first.");

      farmHost.innerHTML = picker({
        name: "kitFarmId",
        label: "Farm",
        required: true,
        requiredMessage: "Choose the farm this kit is going to.",
        placeholder: "Search this farmer's farms…",
        emptyText: "This farmer has no farms on file.",
        options: theirs.map((f) => ({
          value: String(f.id),
          label: f.name,
          secondary: `${f.region || f.province || "Location not set"} · ${f.hectares} ha`,
        })),
      });

      // The new picker's own markup has to be bound; wirePickers skips what
      // it has already bound, so this does not rebind the rest.
      wirePickers();
      return;
    }

    if (detail.name === "kitFarmId") {
      const farmId = Number(detail.value);
      chosenFarmName = farms.find((f) => f.id === farmId)?.name ?? "";
      renderZonePlaceholder("Loading this farm's zones…");

      void getReportZones(farmId)
        .then((zones) => {
          if (zones.length === 0) {
            // A farm with no zones cannot take a kit at all: hardware.zone_id
            // is what the claim resolves. Saying so here beats a picker with
            // nothing in it.
            renderZonePlaceholder(
              "This farm has no zones yet. Add one before registering a kit to it.",
            );
            return;
          }

          zoneHost.innerHTML = picker({
            name: "kitZoneId",
            label: "Zone",
            required: true,
            requiredMessage: "Choose the zone this kit will water.",
            placeholder: "Search this farm's zones…",
            options: zones.map((z) => ({
              value: String(z.zoneId),
              label: z.name,
              secondary: z.cropType ? `Crop: ${z.cropType}` : "No crop set",
            })),
          });

          wirePickers();
        })
        .catch(() => {
          renderZonePlaceholder("This farm's zones could not be loaded. Go back and try again.");
        });

      return;
    }

    if (detail.name === "kitZoneId") {
      chosenZoneName =
        zoneHost.querySelector<HTMLElement>(".picker-option.is-selected .picker-option-main b")
          ?.textContent?.trim() ?? "";
    }
  });

  wiz.querySelector("[data-wizard-next]")?.addEventListener("click", () => {
    window.setTimeout(renderReview, 0);
  });
  wiz.querySelector("[data-wizard-back]")?.addEventListener("click", () => {
    window.setTimeout(renderReview, 0);
  });

  renderReview();
}

/* The count, clamped to what the API will accept (1-50). Read from the DOM
   rather than passed around, because the repeater and the confirm handler
   both need it and the input is the only thing that knows. */
function registerFarmZoneCount(): number {
  const input = document.querySelector<HTMLInputElement>("[data-register-farm-zone-count]");
  return Math.max(1, Math.min(50, Number(input?.value) || 1));
}

/* The two rules the wizard's per-field validation cannot express.
   Both are enforced by the API as well; checked here so the answer arrives
   in the drawer the admin is looking at rather than as a 400. */
function validateRegisterFarmZones(
  zones: { name: string; sizeHectares: number; cropType: string }[],
  farmSize: number,
): string | null {
  const total = zones.reduce((sum, z) => sum + z.sizeHectares, 0);

  if (farmSize > 0 && total > farmSize) {
    return `The zones add up to ${total.toFixed(1)} ha, which is more than the farm's ${farmSize.toFixed(1)} ha.`;
  }

  const names = zones.map((z) => z.name.trim().toLowerCase());
  const duplicate = names.find((n, i) => n.length > 0 && names.indexOf(n) !== i);
  if (duplicate) {
    return `Two zones are both called "${duplicate}". Zone names have to differ.`;
  }

  return null;
}

/* The review step, rebuilt every time it is shown.
 *
 * Rebuilt rather than filled once, because the admin can go back and change
 * anything - a review screen showing stale values is worse than no review
 * screen, since it is the thing they are trusting before they commit. */
function wireRegisterFarmReview(): void {
  const wiz = document.querySelector<HTMLElement>('[data-wizard="register-farm"]');
  const pane = document.getElementById("registerFarmReview");
  if (!wiz || !pane) return;

  const cropLabel = (value: string): string =>
    ZONE_CROPS.find((c) => c.value === value)?.label ?? value;

  const render = (): void => {
    const v = collectFields();
    const ownerName = document
      .querySelector<HTMLElement>('[data-picker="ownerId"] .picker-option.is-selected .picker-option-main b')
      ?.textContent?.trim();

    const zones = Array.from({ length: registerFarmZoneCount() }, (_, i) => ({
      name: v[`zone_name_${i}`] ?? "",
      size: v[`zone_size_${i}`] ?? "",
      crop: v[`zone_crop_${i}`] ?? "",
    }));

    const coords =
      v["latitude"] && v["longitude"]
        ? `${Number(v["latitude"]).toFixed(5)}, ${Number(v["longitude"]).toFixed(5)}`
        : "Not set - the weather lookup will fall back to the district";

    pane.innerHTML = `
      ${detailList([
        ["Farmer", esc(ownerName ?? "Not chosen")],
        ["Farm name", esc(v["farmName"] ?? "")],
        ["Where", esc(v["location"] ?? "")],
        ["Size", v["farmSize"] ? `${esc(v["farmSize"])} ha` : ""],
        ["Coordinates", esc(coords)],
        ["Zones", String(zones.length)],
      ])}
      <table class="table review-zones">
        <thead><tr><th>Zone</th><th>Size</th><th>Crop</th></tr></thead>
        <tbody>
          ${zones
            .map(
              (z) => `<tr>
                <td>${esc(z.name || "(no name)")}</td>
                <td>${z.size ? `${esc(z.size)} ha` : "—"}</td>
                <td>${z.crop ? esc(cropLabel(z.crop)) : "—"}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>`;
  };

  // The wizard has no "step changed" event, so the two buttons that can
  // reach the review step both trigger a rebuild.
  wiz.querySelector("[data-wizard-next]")?.addEventListener("click", () => {
    window.setTimeout(render, 0);
  });
  wiz.querySelector("[data-wizard-back]")?.addEventListener("click", () => {
    window.setTimeout(render, 0);
  });

  render();
}

/* ---- Live farm reports (real endpoints; the cards above are demo data) ---- */

function liveEsc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function liveVal(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
}

function wireLiveReports(): void {
  const farm = document.getElementById("liveFarm") as HTMLSelectElement | null;
  const zone = document.getElementById("liveZone") as HTMLSelectElement | null;
  if (!farm || !zone || farm.dataset["bound"]) return;
  farm.dataset["bound"] = "1";
  farm.addEventListener("change", async () => {
    zone.innerHTML = `<option value="">Select a zone</option>`;
    const id = Number(farm.value);
    if (!id) return;
    try {
      const zones = await getReportZones(id);
      zone.innerHTML = `<option value="">Select a zone</option>` + zones.map((z) =>
        `<option value="${z.zoneId}">${liveEsc(z.name)}${z.cropType ? " (" + liveEsc(z.cropType) + ")" : ""}</option>`).join("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load zones.", "info");
    }
  });
}

// One insight, with its source in small text underneath. Farmers never see the
// source; reports always show it (spec 9b).
function liveInsight(i: any): string {
  const severity = typeof i?.severity === "string" ? i.severity : "info";
  return `<li class="liveInsight liveInsight--${liveEsc(severity)}">
    <span class="liveInsight__text">${liveEsc(i?.text ?? "")}</span>
    ${i?.source ? `<small class="liveInsight__source">Source: ${liveEsc(i.source)}</small>` : ""}
    ${whyLink(asExplanation(i?.explanation))}
  </li>`;
}

function liveInsights(insights: any, heading = "What to do"): string {
  if (!Array.isArray(insights) || insights.length === 0) return "";
  return `<div class="liveInsights"><h6>${liveEsc(heading)}</h6>
    <ul class="liveInsights__list">${insights.map(liveInsight).join("")}</ul></div>`;
}

// Spec 9c: weather app (the area) beside the DHT11 (in the tub), with the
// difference. A missing value shows as "-" and a missing sensor as the row's own
// note, never as a zero that would read as perfect agreement.
function liveWeatherComparison(comparison: any): string {
  if (!comparison) return "";
  const days = Array.isArray(comparison.days) ? comparison.days : [];

  if (days.length === 0) {
    return `<div class="liveWeatherCompare"><h6>Weather: area vs tub</h6>
      <p><small>${liveEsc(comparison.message ?? "No observed weather days to compare yet.")}</small></p></div>`;
  }

  const n = (v: any) => (v === null || v === undefined ? "-" : liveEsc(v));

  const rows = days.map((day: any) => `<tr>
      <td>${liveEsc(day.date)}</td>
      <td>${n(day.app?.tminC)}</td><td>${n(day.app?.tmaxC)}</td>
      <td>${n(day.app?.rhMeanPct)}</td><td>${n(day.app?.windMs)}</td><td>${n(day.app?.rainMm)}</td>
      <td>${n(day.dht?.tminC)}</td><td>${n(day.dht?.tmaxC)}</td><td>${n(day.dht?.rhMeanPct)}</td>
      <td>${n(day.difference?.tmaxC)}</td>
      <td>${day.note ? liveEsc(day.note) : ""}</td>
    </tr>`).join("");

  return `<div class="liveWeatherCompare"><h6>Weather: area vs tub</h6>
    <p><small>${liveEsc(comparison.caption ?? "")}</small></p>
    <table><thead><tr>
      <th>Date</th><th>Area min</th><th>Area max</th><th>Area RH</th><th>Wind m/s</th><th>Rain mm</th>
      <th>Tub min</th><th>Tub max</th><th>Tub RH</th><th>Max diff</th><th>Note</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function liveRender(kind: string, d: any): string {
  if (kind === "water-usage") {
    const rows = (d.zones as any[]).map((z) => `<tr><td>${liveEsc(z.name)}</td><td>${liveEsc(z.eventCount)}</td>
      <td>${z.status === "ok" ? liveEsc(z.estimatedLitres) + " L (estimated)" : liveEsc(z.message)}</td></tr>`).join("");
    return `<p><em>${liveEsc(d.estimateNote)}</em></p>
      ${liveInsights(d.insights)}
      <table><thead><tr><th>Zone</th><th>Events</th><th>Water</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (kind === "moisture") {
    if (d.status !== "ok") return `<p>${liveEsc(d.message)}</p>`;
    const s = d.summary;
    // Item 2: no % on readings taken before the wet/dry setup.
    const pct = d.calibrated === false ? "" : "%";
    const kind = d.calibrated === false ? " (sensor readings, not yet set up)" : "";
    return `<p><strong>${liveEsc(d.zoneName)}</strong>: ${liveEsc(s.readingCount)} readings${kind}, average ${liveEsc(s.averagePct)}${pct},
      lowest ${liveEsc(s.lowestPct)}${pct}, highest ${liveEsc(s.highestPct)}${pct}.</p>
      <p>${liveEsc(s.action)}</p>
      ${liveInsights(d.insights)}
      ${d.calibrationNote ? `<p><small>${liveEsc(d.calibrationNote)}</small></p>` : ""}
      <p>${liveEsc((d.irrigationEvents as any[]).length)} irrigation event(s) in this period. <em>${liveEsc(d.estimateNote)}</em></p>`;
  }
  const blocks = (d.zones as any[]).map((z) => `<h5>${liveEsc(z.name)} (${liveEsc(z.cropType ?? "no crop set")})</h5>
    <p>${liveEsc(z.summary)}</p>
    ${z.plainSummary ? `<p><strong>${liveEsc(z.plainSummary)}</strong></p>` : ""}
    ${liveInsights(z.insights)}
    ${(z.limitations as string[]).map((l) => `<p><small>${liveEsc(l)}</small></p>`).join("")}
    <table><thead><tr><th>Date</th><th>Action</th><th>ET0 mm</th><th>Rain mm</th><th>Note</th></tr></thead><tbody>
    ${(z.days as any[]).map((day) => `<tr><td>${liveEsc(day.date)}</td><td>${liveEsc(day.action)}</td>
      <td>${liveEsc(day.et0MmPerDay ?? "-")}</td><td>${liveEsc(day.forecastRainMm ?? "-")}</td><td>${liveEsc(day.note)}</td></tr>`).join("")}
    </tbody></table>`).join("");
  return d.status === "ok"
    ? blocks + liveWeatherComparison(d.weatherComparison)
    : `<p>${liveEsc(d.message)}</p>`;
}

/* The same report as a workbook. Only water usage has one - see the note on
   the button in pages/analytics.ts. */
async function liveReportXlsx(): Promise<void> {
  const farmId = Number(liveVal("liveFarm"));
  const zoneId = Number(liveVal("liveZone"));
  const from = liveVal("liveFrom"), to = liveVal("liveTo");

  if (!farmId) return toast("Pick a farm first.", "info");
  if (!from || !to) return toast("Pick a from and to date.", "info");

  const query = zoneId
    ? `zoneId=${zoneId}&from=${from}&to=${to}`
    : `farmId=${farmId}&from=${from}&to=${to}`;

  try {
    await downloadReportFile(
      `/api/farmer/reports/water-usage/xlsx?${query}`,
      `agroflow-water-usage-${from}-to-${to}.xlsx`,
    );

    toast("Workbook downloaded.", "success");
  } catch (e) {
    showErrorModal(
      "Could not build the workbook",
      e instanceof Error ? e.message : "The workbook could not be built.",
    );
  }
}

async function liveReportRun(kind: string, pdf: boolean): Promise<void> {
  const farmId = Number(liveVal("liveFarm"));
  const zoneId = Number(liveVal("liveZone"));
  const from = liveVal("liveFrom"), to = liveVal("liveTo");

  let path: string;
  if (kind === "moisture") {
    if (!zoneId) return toast("Pick a farm and a zone first.", "info");
    if (!from || !to) return toast("Pick a from and to date.", "info");
    path = `moisture?zoneId=${zoneId}&from=${from}&to=${to}`;
  } else if (kind === "water-usage") {
    if (!farmId) return toast("Pick a farm first.", "info");
    if (!from || !to) return toast("Pick a from and to date.", "info");

    // A chosen zone gets that zone's own designed report; "all zones" gets
    // the farm-wide one, which is the same document with a summary in front.
    path = zoneId
      ? `water-usage?farmId=${farmId}&zoneId=${zoneId}&from=${from}&to=${to}`
      : `water-usage?farmId=${farmId}&from=${from}&to=${to}`;
  } else if (kind === "schedule") {
    if (!farmId) return toast("Pick a farm first.", "info");
    path = `schedule?farmId=${farmId}`;
  } else return;

  try {
    if (pdf) {
      await downloadReportPdf(path.replace("?", "/pdf?"), `${kind}-report.pdf`);
      return toast("PDF downloaded.", "success");
    }
    const data = await getReportJson<any>(path);
    const out = document.getElementById("liveReportResult");
    if (out) out.innerHTML = liveRender(kind, data);
  } catch (e) {
    toast(e instanceof Error ? e.message : "Report failed.", "info");
  }
}

/* ---------------------- delegated clicks (item 0b) ----------------------- */

let delegatedBound = false;

/* Elements whose action is still running. A second click on one of them is
 * dropped, so a double-click on Save, Confirm or Create sends ONE request.
 * Keyed on the element rather than the action, so two different rows' Save
 * buttons are still independent. A WeakSet, so a re-rendered page's old
 * buttons are simply forgotten. */
const busy = new WeakSet<HTMLElement>();

/* One listener for every action in the console, registered once.
 *
 * The innermost [data-act] under the pointer wins, which is what lets an
 * action link inside a clickable card do its own thing instead of opening the
 * card. preventDefault matters: most actions are `<a href="#">`, and letting
 * that through would set the hash to "#" - which is a navigation to Home. */
function bindDelegatedClicks(): void {
  if (delegatedBound) return;
  delegatedBound = true;

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const go = target.closest<HTMLElement>("[data-go]");
    if (go) {
      e.preventDefault();
      navigate(go.dataset["go"] ?? "dashboard");
      return;
    }

    const tab = target.closest<HTMLElement>(".tab[data-tab]");
    if (tab) {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      tab.classList.add("active");
      positionTabUnderline();
      // Synchronous, so the last tab clicked is the one shown. Its network
      // panels guard themselves against late answers (see the settings
      // loaders), so a slow tab cannot paint over a fast one.
      renderSettingsTab(tab.dataset["tab"] ?? "My account");
      return;
    }

    const el = target.closest<HTMLElement>("[data-act]");
    if (!el) return;

    e.preventDefault();

    if (busy.has(el)) return;

    // A newer click supersedes any detail panel still loading from an older
    // one - see beginPanelIntent().
    if ((el.dataset["act"] ?? "").startsWith("view-")) beginPanelIntent();

    busy.add(el);
    el.setAttribute("aria-busy", "true");

    void handleAction(el).finally(() => {
      busy.delete(el);
      el.removeAttribute("aria-busy");
    });
  });
}

export function wirePageInteractions(): void {
  // The drawer calls this after it writes its HTML - see lib/drawer.ts.
  window.agroflowBindDrawerPickers = wirePickers;

  // And the router calls this after a Settings tab renders.
  onSettingsTabRendered((tab) => {
    if (tab === "My account") void refreshMyTelegramStatus();
    if (tab === "Platform thresholds") void loadPlatformThresholds();
  });

  wireFilters();
  wireLiveReports();
 wireOnboardingZones();
  wirePickers();
  wireWizards();

  // [data-go], [data-act] and .tab clicks are handled by ONE delegated
  // listener on the document - see bindDelegatedClicks() below. They used to
  // be bound element by element after every render, which never double-bound
  // (each element was flagged) but missed anything rendered later: a drawer's
  // buttons, a picker rebuilt in place, a timeline loaded after the page.
  bindDelegatedClicks();

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

  document.querySelectorAll<HTMLSelectElement>(".request-status-select").forEach((select) => {
    if (select.dataset["bound"]) return;
    select.dataset["bound"] = "1";

    select.addEventListener("change", () => {
      const id = Number(select.dataset["requestId"]);
      const status = select.value as "pending" | "scheduled" | "completed";

      if (!id) {
        toast("Invalid request selected.", "warn");
        return;
      }

      void api.updateServiceRequestStatus(id, status)
        .then(() => {
          toast("Request status updated.", "success");
          void refresh();
        })
        .catch((error) => {
          console.error("Failed to update request status:", error);
          toast(
            error instanceof Error
              ? error.message
              : "Unable to update request status.",
            "warn",
          );
        });
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
