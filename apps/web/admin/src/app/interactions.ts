/* Event wiring: filter toolbar, admin actions, detail views, exports. */

import { api, getFarmAlertHistory, getShowArchivedFarms, setShowArchivedFarms, findAttentionGroup } from "@/data/api";
import { openCaseDrawer, handleCaseAction } from "@/app/caseView";
import { toast, toastWithUndo } from "@/lib/toast";
import { setView as setDismissView } from "@/lib/dismiss";
import { openDrawer, closeDrawer, beginPanelIntent, currentPanelIntent } from "@/lib/drawer";
import {
  createFarmer,
  deleteFarm,
  deleteFarmerUser,
  getFarmers,
  inviteFarmer,
  onboardFarmer,
  linkEnquiryToFarmer,
  getOnboardingOperation,
  OnboardingError,
  type OnboardingOperation,
  issueLinkCodeForFarmer,
  regenerateTelegramCode,
  registerFarm,
  updateFarmLocation,
  resetFarmerPassword,
  deviceChangeWifi,
  deviceOpenSetup,
  deviceRevoke,
  addMqttLogins,
  createEnrollmentCode,
  getReportSchedule,
  saveReportSchedule,
  sendReportScheduleTest,
  type ReportFrequency,
  archiveFarm,
  restoreFarm,
  runAdviceNow,
  claimItem,
  releaseItem,
  takeOverItem,
  itemAction,
  createMaintenance,
  type HandlingKind,
  getActivityLog,
  getEntityTimeline,
  KIT_TYPES,
  updateMyProfile,
  getMyTelegramStatus,
  requestMyTelegramCode,
  disconnectMyTelegram,
  unlinkFarmerTelegram,
  type AuditRow,
  getAdminTankPh,
  setFarmTankCapacity,
  IRRIGATION_MODE_LABEL,
} from "@/services/agroFlowApi";
import QRCode from "qrcode";
import { showErrorModal } from "@/lib/errorModal";
import { confirmDialog } from "@/lib/confirmDialog";
import { showQrModal } from "@/lib/qrModal";
import { picker, detailList, wizard, errorState, handlingCell } from "@/ui/patterns";
import { exportActivityWorkbook, exportSummaryWorkbook, downloadExcelSafeCsv } from "@/lib/workbook";
import { timelineHtml, rememberReportFarm } from "@/pages/analytics";
import { requestActions, setRequestsTab, setRequestFilter } from "@/pages/requests";
import { callHistory, enquiryActions, enquiryStatus, cropsText, logCallHtml, readLogCall, syncLogCall } from "@/pages/enquiries";
import { requestTimeline, formatCrop } from "@/pages/requests";
import { toCSV } from "@/lib/csv";
import { navigate, showPage, refresh, renderSettingsTab, positionTabUnderline, appState, onSettingsTabRendered } from "@/app/router";
import { refreshHealthPanel } from "@/app/health";
import {
  getFilter, setFilter, resetFilter, resolvePreset, applyFilters, rangeLabel,
} from "@/lib/filters";
import { esc, fmtInt, fmtPct, fmtDate, fmtLitres, fmtDateTimeSast, fmtArea, hectaresText, roughSizeText } from "@/lib/format";
import { phoneProblem } from "@/lib/phone";
import { ZONE_CROPS } from "@/data/referenceData";
import type { DateRangePreset, Farm, FilterState, Handling, ServiceRequest, User } from "@/types/models";
import { zoneRow, readZoneSetup, zoneSetupProblem, syncZoneChoices, recommendHtml, SOILS, AREA_PRESETS } from "@/pages/onboarding";
import { locationPickerHtml, mountLocationPicker } from "@/lib/map";
import { changedSettings, mountCommunityMap } from "@/pages/droughtCommunity";
import { OUTSIDE_SA, formatDecimal, formatDms, insideSouthAfrica, validCoordinates } from "@/lib/coordinates";
import { telegramState } from "@/pages/users";
import { plainError } from "@/lib/plainError";
import { getAdminProfile, refreshAdminProfile, changeMyPassword } from "@/app/auth";
import { initBell } from "@/app/bell";
import { isStaffRole } from "@/lib/staff";
import { dismissNotification, restoreDismissal, getEnquiries, getEnquirySummary, getEnquiryCalls, claimEnquiry, takeOverEnquiry, logEnquiryCall, closeEnquiry, anonymiseEnquiry, type Enquiry, getHandling, addZonesToFarm, getFarmToday, getRecommendedSettings, previewRecommendedSettings, useRecommendedSettings, getReportZones, setZoneMaxRun, fetchReportPdfBlob, downloadReportPdf, downloadSummaryPdf, downloadReportFile, setFarmPlace, getFarmPlace, setFarmDroughtMode, resolveStaffNotice, hideCommunityReport, saveDroughtCommunitySettings, getAdminHardware } from "@/services/agroFlowApi";
import { kitSetupCardHtml, printKitLabel, copyText, normaliseDeviceId, DEVICE_ID_PATTERN } from "@/ui/kitSetupCard";


/* Pickers */

/* A picker is a search box over a list of real options. Choosing one writes its value into
 * the hidden field the wizard reads, so a form can never hold a farm name that does not exist. */
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

        // Tell the wizard a choice was made, so a later step can rebuild from it (zones depend on
        // the farm, farms on the farmer).
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

/* Wizards */

/* Steps, validation per step, and Back that keeps what was entered. Validating per step
 * means the admin hears about a mistake straight away, not six fields later. */
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

    /* Every field marked data-required needs a value before Next. Returns the first problem in
     * plain words, or null. */
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

    /* Confirm re-checks every step, not just the review step: a field can be emptied after it
     * was passed. The listener uses capture so it can stop the click before the delegated
     * data-act handler on document sees it. */
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

        // Jump back to the step that is wrong, instead of reporting it on the review screen where
        // the field is not visible.
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
      // Nothing is cleared: going back and forward keeps every value, so nobody retypes farm details.
      const step = Number(wiz.dataset["step"] ?? "0");
      wiz.dataset["step"] = String(Math.max(step - 1, 0));
      render();
    });

    render();
  });
}

/* Filter toolbar */

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
        // Debounce free text so typing stays smooth, and keep focus and caret.
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

/* Exports */

async function exportCurrent(kind: string): Promise<void> {
  const page = appState.activePage;
  const f = getFilter(page);

  switch (kind) {
    case "users": {
      /* The Telegram mapper is needed here too, or filtering to "Not connected" and exporting
       * would return every user, when that export is the follow-up list someone wants. */
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
      // Uptime and battery are not measured anywhere, so the export says so instead of 0 and an
      // assumed "Mains".
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
        // "No estimate" instead of an empty cell or 0, so the reader can tell a zone with no flow
        // rate from a pump that delivered nothing.
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
    /* The platform summary as a real .xlsx. A workbook has no list separator to guess (Excel
     * splits CSVs on the locale's separator), numbers stay numbers and percentages stay
     * percentages, so the figures can be charted or averaged. */
    case "dashboard": {
      const profile = getAdminProfile();

      const [k, allFarms, allAlerts, allRequests] = await Promise.all([
        api.getKpis(),
        api.getFarms(),
        api.getAlerts(),
        // The summary is still worth having if only the request list fails; the Requests sheet is
        // then empty.
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
                // The one figure here that is a problem, not a statistic: these farmers get no messages at
                // all (no weather warning, equipment failure or password reset).
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
                // Excel's percent format multiplies by 100, so we store the fraction.
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

      // Its own message, because unlike the other exports this one ignores the page filters: it
      // is a snapshot of the whole platform.
      return void toast("Platform summary exported.", "success");
    }
  }
  toast(`Export complete — filters applied (${rangeLabel(f)}).`, "success");
}

/* The same summary as a PDF, for printing, filing or email. Built by the API (see
 * downloadSummaryPdf). */
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

/* Detail views */

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
      section("Telegram", isStaffRole(u.role)
        ? `<p class="muted">Staff do not use Telegram. Their notices are on Home and under the bell.</p>`
        : u.telegramLinked
        ? `<p>${esc(telegramState(u))}. Lost or changed phone? Disconnect it, then send a new code.</p>
           <p><button type="button" class="btn ghost" data-act="unlink-telegram" data-id="${esc(u.id)}">Unlink Telegram</button></p>`
        : `<p>Not connected. This farmer gets no alerts until they connect.</p>
           <p><button type="button" class="btn ghost" data-act="send-link-code" data-id="${esc(u.id)}">Send a link code</button></p>`),
      section("Account", `<p class="muted">Forgot their password? Reset password gives them a new temporary one: by Telegram if connected, otherwise you read it out.</p>
        <p><button type="button" class="btn ghost" data-act="reset-password" data-id="${esc(u.id)}">Reset password</button></p>
        <p class="muted">Removing the account stops sign-in. Their farms, zones and history are kept.</p>
        <p><button type="button" class="btn ghost" data-act="delete-user" data-id="${esc(u.id)}">Remove account</button></p>`),
      section("Registered hardware", list(u.hardware.map((h) => `<span class="mono">${esc(h)}</span>`))),
      section("Irrigation schedules", list(userSchedules.map((s) =>
        `${esc(s.zone)} — ${esc(s.cadence)} <span class="muted">(${fmtPct(s.compliancePct)} compliance)</span>`))),
      section("Recent support history", list(u.support.map((t) =>
        `<span class="mono">${esc(t.id)}</span> ${esc(t.subject)} — <b>${esc(t.status)}</b> <span class="muted">${esc(t.when)}</span>`))),
      section("Account activity", `<p class="muted">Last sign-in ${esc(u.lastActive)}. Full history in Platform Activity.</p>`),
      section("Administrator notes", list(u.notes.map((n) =>
        `${esc(n.note)} <span class="muted">— ${esc(n.author)}, ${esc(n.when)}</span>`))),
    ].join(""),
    /* No confirm button: this drawer only shows one farmer's record. The Administrator notes
     * section above shows whatever is on the record. */
  });
}

async function openFarmDetail(id: number): Promise<void> {
  const intent = currentPanelIntent();
  const f = api.findFarm(id);
  if (!f) return;
  const [users, hardware, alerts, maintenance, schedules, alertHistory, autoReports, farmZones, today, tankPh] = await Promise.all([
    api.getUsers(), api.getHardware(), api.getAlerts(), api.getMaintenance(), api.getSchedules(),
    // Read-only and allowed to fail: the drawer must still open if 0033 is not applied or the
    // query is refused.
    getFarmAlertHistory(id).catch((e: unknown) => {
      console.warn("Could not load alert history for farm", id, e);
      return [];
    }),
    // A farm with no schedule row is normal (automatic reports are off until an admin turns
    // them on), so this failing must not stop the drawer opening either.
    getReportSchedule(id).catch((e: unknown) => {
      console.warn("Could not load the report schedule for farm", id, e);
      return null;
    }),
    // Real zones from the API. The "Irrigation schedules" section below is still local mock
    // data (irrigation_schedule was dropped in 0010), so its ids are not zone ids.
    getReportZones(id).catch((e: unknown) => {
      console.warn("Could not load zones for farm", id, e);
      return [];
    }),
    // What the farmer is told today, per zone. Allowed to fail too.
    getFarmToday(id).catch((e: unknown) => {
      console.warn("Could not load today's advice for farm", id, e);
      return null;
    }),
    getAdminTankPh(id).catch((e: unknown) => {
      console.warn("Could not load tank and pH for farm", id, e);
      return null;
    }),
  ]);
  const todayByZone = new Map((today?.zones ?? []).map((z) => [z.zoneId, z]));
  const levelLabel = { high: "High", medium: "Medium", low: "Low" } as const;

  // The farm's own member list from the API (AF-23), so the drawer and the directory agree;
  // matching by farm name is only the fallback for an older API.
  const farmUsers = f.memberIds && f.memberIds.length
    ? users.filter((u) => f.memberIds!.includes(u.id))
    : users.filter((u) => u.farm === f.name);
  const farmHw = hardware.filter((h) => h.farm === f.name);
  const farmAlerts = alerts.filter((a) => a.farm === f.name);
  const farmJobs = maintenance.filter((m) => m.farm === f.name);
  const farmSched = schedules.filter((s) => s.farm === f.name);

  const section = (title: string, body: string): string =>
    `<div class="drawer-section"><h6>${esc(title)}</h6>${body}</div>`;
  const list = (items: string[]): string =>
    items.length ? `<ul class="drawer-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`
                 : `<p class="muted">None recorded.</p>`;

  const preciseLocation = f.latitude !== null && f.longitude !== null
    ? `${formatDms(f.latitude, f.longitude)}<br><small>Decimal: ${formatDecimal(f.latitude, f.longitude)}</small>`
    : "Coordinates not set";

  openDrawer({
    intent,
    // Not healthDot(f.health): openDrawer's title is HTML-escaped (see escapeText in
    // lib/drawer.ts), so it cannot carry the dot's markup. Health is shown in "Farm summary" below.
    title: f.name,
    subtitle: `${f.owner} · ${f.province} · ${f.region}${f.isSimulated ? " · Simulated" : ""}`,
    wide: true,
    bodyHtml: [
      section("Farm summary", `
        <div class="detail-list">
          <div class="detail-row"><span>Health status</span><b>${esc(f.health)}</b></div>
          <div class="detail-row"><span>Account status</span><b>${esc(f.status)}</b></div>
          <div class="detail-row"><span>Size</span><b>${esc(fmtArea(f.hectares))}</b></div>
          <div class="detail-row"><span>Nearest locality</span><b>${esc(f.location || "Not set")}</b></div>
          <div class="detail-row"><span>Farm location</span><b>${preciseLocation}</b></div>
          <div class="detail-row"><span>Registered</span><b>${esc(fmtDate(f.registered))}</b></div>
          <div class="detail-row"><span>Last activity</span><b>${esc(f.lastActivity)}</b></div>
          ${f.devices === 0
            // AF-09: a farm with no kit yet is waiting for installation, not offline.
            ? `<div class="detail-row"><span>Kit</span><b>Not installed yet</b></div>`
            : `<div class="detail-row"><span>Device connectivity</span><b>${fmtPct(f.healthFactors.deviceConnectivity)}</b></div>
               <div class="detail-row"><span>Gateway</span><b>${f.healthFactors.gatewayOnline ? "Online" : "Offline"}</b></div>
               <div class="detail-row"><span>Sensor availability</span><b>${fmtPct(f.healthFactors.sensorsAvailable)}</b></div>`}
        </div>
        <button class="btn sm" data-act="open-case" data-id="${f.id}">Open installation case</button>
        <button class="btn ghost sm" data-act="edit-farm-location" data-id="${f.id}">View / adjust on map</button>`),
      section("Tank and pH", tankPh ? `
        <div class="detail-list">
          <div class="detail-row"><span>Tank size</span><b>${tankPh.tank.capacityLitres == null ? "Not set" : `${fmtInt(tankPh.tank.capacityLitres)} L`}</b></div>
          <div class="detail-row"><span>Tank level</span><b>${tankPh.tank.estimatedRemainingLitres == null ? "No refill logged" : `About ${fmtInt(tankPh.tank.estimatedRemainingLitres)} L — estimate`}</b></div>
          <div class="detail-row"><span>Latest water pH</span><b>${tankPh.tank.latestWaterPh == null ? "Not logged" : Number(tankPh.tank.latestWaterPh).toFixed(1)}</b></div>
          ${tankPh.zones.map((z) => `<div class="detail-row"><span>${esc(z.zoneName)} soil pH</span><b>${z.latest ? `${Number(z.latest.ph).toFixed(1)} · ${esc(fmtDate(z.latest.measuredAt))}` : "Not logged"}</b></div>`).join("")}
        </div>
        ${tankPh.tank.waterPhWarning ? `<p class="muted">${esc(tankPh.tank.waterPhWarning)}</p>` : ""}
        <button class="btn ghost sm" data-act="edit-tank-capacity" data-id="${f.id}">Set tank size</button>`
        : `<p class="muted">Tank and pH details are unavailable.</p>`),
      section(`Users (${farmUsers.length})`, list(farmUsers.map((u) =>
        `${esc(u.name)} <span class="muted">${esc(u.email)}</span> — <b>${esc(u.status)}</b>`))),
      section(`Installed hardware (${farmHw.length})`, farmHw.length
        ? farmHw.map((h) => kitSetupCardHtml({
            hardwareId: h.id,
            deviceId: h.deviceId ?? null,
            zoneId: h.zoneId ?? null,
            zoneName: h.zoneName ?? null,
            farmName: h.farm,
            status: h.status,
            lastSeen: h.lastSeen || null,
            enrollmentCode: h.enrollmentCode ?? null,
            enrollmentExpiresAt: h.enrollmentCodeExpiresAt ?? null,
            showSteps: false,
          })).join("")
        : `<p class="muted">None recorded.</p>`),
      section(`Irrigation schedules (${farmSched.length})`, list(farmSched.map((s) =>
        `${esc(s.zone)} · ${esc(s.crop)} — ${esc(s.cadence)}`))),
      section(`Maintenance history (${farmJobs.length})`, list(farmJobs.map((m) =>
        `<span class="mono">${esc(m.id)}</span> ${esc(m.issue)} — <b>${esc(m.status)}</b>`))),
      section(`Alerts (${farmAlerts.length})`, list(farmAlerts.map((a) =>
        `<span class="mono">${esc(a.id)}</span> ${esc(a.title)} — <b>${esc(a.status)}</b>`))),

      // What the farmer has been told, and whether they looked at it. The section above is the
      // open alert queue; this is the record, and "Seen"/"Dismissed" is the only way to tell if
      // the channel works. Read-only on purpose: an admin marking a farmer's alert read would
      // destroy that evidence.
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
      // The engine, per zone, on demand. Placed above the auto-report summary because during a
      // setup visit this is what proves the installation works before leaving the farm.
      section(`Zones (${farmZones.length})`,
        farmZones.length
          ? `<div class="table-wrap"><table>
               <thead><tr><th>Zone</th><th>Crop</th><th>Watering</th><th>Max run</th><th>Today</th><th>Confidence</th><th>Next step</th><th>Advice</th></tr></thead>
               <tbody>${farmZones.map((z) => {
                 const t = todayByZone.get(z.zoneId);
                 return `
                 <tr data-today-zone="${z.zoneId}">
                   <td>${esc(z.name)} ${f.isSimulated ? `<span class="badge warn">Simulated</span>` : ""}</td>
                   <td>${esc(z.cropType ?? "Not set")}</td>
                   <td data-zone-mode="${esc(z.irrigationMode ?? "")}">${esc(z.irrigationMode ? IRRIGATION_MODE_LABEL[z.irrigationMode] ?? z.irrigationMode : "—")}</td>
                   <td data-zone-max-run="${z.maxRunMinutes ?? 5}">${z.maxRunMinutes ?? 5} min
                     <a href="#" class="row-act" data-act="zone-max-run" data-id="${z.zoneId}" data-max="${z.maxRunMinutes ?? 5}" data-name="${esc(z.name)}">Change</a></td>
                   <td>${t ? esc(t.action.text) : `<span class="muted">Not available</span>`}</td>
                   <td>${t?.confidence
                     ? `<b>${levelLabel[t.confidence.level]}</b>`
                     : `<span class="muted">—</span>`}</td>
                   <td>${t?.nextStep ? esc(t.nextStep.ask) : `<span class="muted">Nothing missing</span>`}</td>
                   <td>
                     <a href="#" class="row-act" data-act="run-advice" data-id="${z.zoneId}">
                       Run advice now
                     </a>
                     <a href="#" class="row-act" data-act="zone-recommend" data-id="${z.zoneId}">
                       Recommended settings
                     </a>
                   </td>
                 </tr>`;
               }).join("")}
               </tbody></table>
             <p class="muted">
               Runs the FAO-56 engine for that zone today and shows what it worked out, including
               anything still missing from its setup. Advisory only - it never starts a pump.
             </p></div>`
          : `<p class="muted">No zones on this farm yet.</p>`),

      // Automatic reports, as a summary with an Edit action instead of an inline form: the drawer
      // is already long, and this is set once when a farm is set up.
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
        // Real farm reports are made on the Reports page against the API, so this takes the admin there.
        toast(`Choose ${f.name} under Reports to produce a report for it.`, "info");
        void navigate("reports");
      }
    },
  });
}

function openFarmLocationEditor(id: number): void {
  const farm = api.findFarm(id);
  if (!farm) return;
  void getFarmPlace(farm.id).catch(() => null).then((place) => openFarmLocationDrawer(farm, place));
}

/* Saves the province and town (0053) with the coordinates. The coordinates are already saved
 * by the caller, so a failure here only warns. */
async function saveFarmPlace(farmId: number, v: Record<string, string>, latitude: number, longitude: number): Promise<void> {
  const province = (v["province"] ?? "").trim() || null;
  const town = (v["town"] ?? "").trim() || null;
  try {
    await setFarmPlace(farmId, { province, town, latitude, longitude });
  } catch (error) {
    toast(`The coordinates are saved, but not the province and town: ${plainError(error, "try again from the farm's location.")}`, "warn");
  }
}

function openFarmLocationDrawer(farm: Farm, place: { province: string | null; town: string | null } | null): void {
  openDrawer({
    title: `Farm location · ${farm.name}`,
    subtitle: "Precise coordinates are used for weather and agronomy.",
    wide: true,
    bodyHtml: `
      <label class="f">Nearest locality (optional)
        <input type="text" data-field="location" value="${esc(farm.location)}" placeholder="e.g. Sesobe, North West" />
      </label>
      ${locationPickerHtml({ name: `farmLocation${farm.id}`, latitude: farm.latitude, longitude: farm.longitude, province: place?.province, town: place?.town })}`,
    confirmLabel: "Save farm location",
    onOpen: () => {
      const host = document.querySelector<HTMLElement>(`[data-map-pick="farmLocation${farm.id}"]`);
      if (host) void mountLocationPicker(host);
    },
    onConfirm: (values) => {
      const latitude = Number(values["latitude"]);
      const longitude = Number(values["longitude"]);
      if (!validCoordinates(latitude, longitude)) {
        toast("Enter a valid latitude and longitude before saving.", "warn");
        return false;
      }
      if (!insideSouthAfrica(latitude, longitude)) {
        toast(OUTSIDE_SA, "warn");
        return false;
      }
      void updateFarmLocation(farm.id, {
        location: (values["location"] ?? "").trim(),
        latitude,
        longitude,
      }).then(async () => {
        await saveFarmPlace(farm.id, values, latitude, longitude);
        toast(`${farm.name}'s location is updated.`, "success");
        await refresh();
      }).catch((error: unknown) => showErrorModal(
        "Could not update the farm location",
        plainError(error, "The farm location was not changed."),
      ));
    },
  });
}

/* Hide a community report: the reason is recorded in Activity, and the report stops notifying. */
function openHideReport(id: number): void {
  openDrawer({
    title: "Hide this community report",
    subtitle: "Farmers stop seeing it and no more alerts go out. The reason is recorded in Activity.",
    fields: [{ label: "Why (for example: false report, duplicate, not a farming matter)", value: "", editable: true, name: "hideReason" }],
    confirmLabel: "Hide the report",
    onConfirm: (values) => {
      const reason = (values["hideReason"] ?? "").trim();
      if (reason.length < 3) {
        toast("Say why it is being hidden.", "warn");
        return false;
      }
      void hideCommunityReport(id, reason)
        .then(() => { toast("Report hidden.", "success"); void refresh(); })
        .catch((e: unknown) => showErrorModal("Could not hide the report", plainError(e, "The report is still showing.")));
    },
  });
}

function openTankCapacityEditor(id: number): void {
  const farm = api.findFarm(id);
  if (!farm) return;
  openDrawer({
    title: `Tank size · ${farm.name}`,
    subtitle: "This is the maximum refill amount and the basis for the low-tank threshold.",
    fields: [{ label: "Capacity (litres)", value: "", editable: true, name: "tankCapacity" }],
    confirmLabel: "Save tank size",
    onConfirm: (values) => {
      const litres = Number((values["tankCapacity"] ?? "").replace(",", "."));
      if (!Number.isFinite(litres) || litres <= 0) {
        toast("Tank size must be greater than 0 litres.", "warn");
        return false;
      }
      void setFarmTankCapacity(id, Math.round(litres * 10) / 10)
        .then(() => { toast("Tank size saved.", "success"); void openFarmDetail(id); })
        .catch((error: unknown) => showErrorModal(
          "Could not save the tank size", plainError(error, "The tank size was not changed.")));
    },
  });
}

/* Action router */

/* An alert's history as a timeline, built from the alert's own fields and notes (like
 * requests.ts), because this is the current state of one alert, while the audit log is the
 * history of admin actions across the platform.
 * Steps that have not happened yet are shown greyed, so the admin can see what is outstanding. */

/* Today as yyyy-mm-dd in SAST (UTC+2, no daylight saving). We shift before slicing the ISO
 * string: at 01:30 on the 6th in Johannesburg, toISOString() still says the 5th. */
function todayIso(): string {
  return new Date(Date.now() + 2 * 60 * 60_000).toISOString().slice(0, 10);
}

/* Points an element at a different action so one case can reuse another. The clone is not
 * added to the document; handleAction only reads its data-act and data-id. */
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

  // The installation case (Part B): its own module.
  if (act === "open-case") {
    const staff = await api.getUsers().catch(() => []);
    return void openCaseDrawer(numId, staff.filter((u) => isStaffRole(u.role)).map((u) => ({ id: u.id, name: u.name })));
  }
  if (act?.startsWith("case-")) return void handleCaseAction(act, el);

  switch (act) {
    /* Filters */
    case "clear-filters":
      resetFilter(appState.activePage);
      toast("Filters cleared.", "info");
      return void refresh();

    /* Users */
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
      /* Follow-up for a farmer who never pressed Start in the bot. Reuses the handover screen's QR
       * renderer, so the team sees what the farmer must scan and can read the link out by phone. */
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
      /* A new easy temporary password. By Telegram if linked (the admin never sees it), otherwise
       * shown once here to read out. Either way it works for 72 hours and must be changed at first
       * sign-in, and the old password stops working now, so this asks first. */
      const u = api.findUser(idAttr);
      const name = u?.name?.trim() || "this farmer";
      const ok = await confirmDialog({
        title: `Reset ${name}'s password?`,
        body: u?.telegramLinked
          ? `Their current password stops working. A new temporary password goes to their Telegram.`
          : `Their current password stops working. You will see a new temporary password once, to read out to them.`,
        confirmLabel: "Reset password",
      });
      if (!ok) return;
      try {
        const result = await resetFarmerPassword(idAttr);
        if (result.sentByTelegram || !result.temporaryPassword) return toast(result.message, "success", 6000);
        await confirmDialog({
          title: `New temporary password for ${name}`,
          code: result.temporaryPassword,
          body: result.message,
          confirmLabel: "Done",
          noCancel: true,
        });
        return;
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
      const name = u?.name?.trim() || "This farmer";
      // Says before and after exactly what is kept, because "delete" reads as "lose the farm".
      // A plain confirm, not the warning style: that is kept for something that went wrong.
      const ok = await confirmDialog({
        title: `Remove ${name}'s account?`,
        body: `Their farm, zones and readings stay on record. ${name} will no longer be able to sign in.`,
        confirmLabel: "Remove account",
      });
      if (!ok) return;

      try {
        await deleteFarmerUser(idAttr);
        closeDrawer();
        // The success toast carries the tick.
        toast(`${name}'s account was removed. Farm records were kept.`, "success", 6000);
        return void refresh();
      } catch (e) {
        showErrorModal(
          e instanceof Error ? e.message : "The account could not be removed.",
          "The account could not be removed",
        );
        return;
      }
    }

    case "unlink-telegram": {
      const u = api.findUser(idAttr);
      const name = u?.name?.trim() || "this farmer";
      const ok = await confirmDialog({
        title: `Disconnect ${name}'s Telegram?`,
        body: `AgroFlow will stop sending messages to the Telegram chat ${name} has now. ` +
          "They can connect again with a new code, from the app or from here.",
        confirmLabel: "Disconnect Telegram",
        danger: true,
      });
      if (!ok) return;

      try {
        const result = await unlinkFarmerTelegram(idAttr);
        closeDrawer();
        toast(result.message, "success", 6000);
        return void refresh();
      } catch (e) {
        showErrorModal(
          e instanceof Error ? e.message : "Telegram could not be disconnected.",
          "Telegram could not be disconnected",
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




    /* Farmer onboarding: real calls to AgroFlow.Api. Needs an admin signed in through Supabase Auth. */
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
        // Security: a farm id is a bigint nobody knows by heart, and one wrong digit would attach
        // the new account to a stranger's farm with access to its readings, so we use a picker.
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

    /* Farms */
    case "view-farm": return openFarmDetail(numId);
    case "edit-farm-location": return openFarmLocationEditor(numId);

    /* Drought & community page. */
    case "drought-mode": {
      const mode = el.dataset["mode"] as "on" | "off" | "auto" | undefined;
      if (!mode) return;
      try {
        const view = await setFarmDroughtMode(numId, mode);
        toast(view.active ? "Drought mode is on for this farm." : "Drought mode is off for this farm.", "success");
      } catch (e) {
        showErrorModal("Could not change drought mode", plainError(e, "Drought mode was not changed."));
      }
      return void refresh();
    }
    case "resolve-notice": {
      try {
        await resolveStaffNotice(numId);
        toast("Notice closed.", "success");
      } catch (e) {
        showErrorModal("Could not close the notice", plainError(e, "The notice is still open."));
      }
      return void refresh();
    }
    case "hide-report":
      return openHideReport(numId);
    case "save-dc-settings": {
      const changes = changedSettings(document);
      if (typeof changes === "string") return void toast(changes, "warn");
      if (!changes.length) return void toast("Nothing has changed.", "info");
      try {
        const r = await saveDroughtCommunitySettings(changes);
        toast(r.message, "success");
      } catch (e) {
        showErrorModal("Could not save the settings", plainError(e, "Nothing was changed."));
      }
      return void refresh();
    }
    case "go-drought-community":
      return void navigate("droughtCommunity");
    case "edit-tank-capacity": return openTankCapacityEditor(numId);
    /* Register a kit in five steps instead of typing a zone id from memory. The claim attaches
     * the kit to this zone, so a wrong zone would put a farmer's readings against someone
     * else's crop.
     * Each picker narrows the next: the farmer's farms, then that farm's zones. Farms are
     * filtered on ownerId, not the owner's name, because two farmers can share a name. */
    case "copy-text": {
      const ok = await copyText(el.dataset["copy"] ?? "");
      return void toast(ok ? "Copied." : "Could not copy. Select the text and copy it instead.", ok ? "success" : "warn");
    }
    case "print-kit-label": {
      const ok = await printKitLabel({
        deviceId: el.dataset["deviceId"] ?? "",
        zoneId: Number(el.dataset["zoneId"]) || null,
        zoneName: el.dataset["zoneName"] || null,
        farmName: el.dataset["farmName"] || null,
      });
      if (!ok) toast("Allow pop-ups for this site to print the label.", "warn");
      return;
    }
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

      // Only farmers who have somewhere to put a kit; the rest would get an empty farm step.
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
                </label>
                <label class="f">
                  Device ID (optional)
                  <input type="text" data-field="kitDeviceId" maxlength="12" autocomplete="off" spellcheck="false"
                    placeholder="e.g. 0123456789AB" class="mono" />
                  <span class="muted">12 characters. The kit prints it in Serial Monitor at boot ("Device ID: …").
                    Leave it blank if you do not have it: it is filled in when the kit first connects.</span>
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
      const deviceId = normaliseDeviceId(v["kitDeviceId"]);
      if (deviceId && !DEVICE_ID_PATTERN.test(deviceId)) {
        return void toast("A device ID is 12 characters, 0-9 and A-F. Leave it blank if you do not have it.", "warn");
      }

      try {
        const result = await createEnrollmentCode({
          zoneId,
          deviceName: v["kitName"]?.trim() || undefined,
          deviceType: v["kitType"] || KIT_TYPES[0].value,
          deviceId: deviceId || undefined,
        });

        closeDrawer();
        // The installer's card: the code, its expiry and the steps. A drawer, not a toast: it is a
        // credential the installer has to write down. It fills in by itself when the kit claims.
        openKitSetupResult(result, { deviceId: deviceId || null, zoneId, ...kitWizardNames() });
        return void refresh();
      } catch (e) {
        showErrorModal(
          "Could not create the enrollment code",
          e instanceof Error ? e.message : "The code could not be created.",
        );
        return;
      }
    }

    /* Register a new farm in four steps: pick the farmer, place the farm on a map, describe the
     * zones from a crop list the engine knows, and review everything before anything is saved.
     * This avoids crops the engine cannot advise on, farms without coordinates for weather, and
     * validation errors after a long form. */
    case "add-farm":
      return openRegisterFarmWizard(null);

    /* The wizard's Confirm. wireWizards has already re-checked every step, so only the zone
     * arithmetic the API also checks can be missing here; we check it so the admin sees it in
     * the drawer instead of a 400. */
    /* A soil card sets its zone's hidden soil field. */
    case "zone-soil": {
      const row = el.closest<HTMLElement>("[data-zone-row]");
      const hidden = row?.querySelector<HTMLInputElement>(`[data-field="zone_soil_${el.dataset["zone"]}"]`);
      if (!row || !hidden) return;
      hidden.value = el.dataset["soil"] ?? "loam";
      syncZoneChoices(row);
      return;
    }

    case "wizard-register-farm": {
      const v = collectFields();

      const zoneCount = registerFarmZoneCount();
      const zones = Array.from({ length: zoneCount }, (_, i) => readZoneSetup(v, i));

      const problem =
        Array.from({ length: zoneCount }, (_, i) => zoneSetupProblem(v, i)).find((p) => p) ??
        validateRegisterFarmZones(zones, Number(v["farmSize"]) || 0);
      if (problem) return void toast(problem, "warn");

      const latitude = v["latitude"] ? Number(v["latitude"]) : null;
      const longitude = v["longitude"] ? Number(v["longitude"]) : null;
      const hasCoordinates = latitude !== null && longitude !== null && validCoordinates(latitude, longitude);
      if ((latitude !== null || longitude !== null) && !hasCoordinates) {
        return void toast("Enter both latitude and longitude in their valid ranges.", "warn");
      }
      if (hasCoordinates && !insideSouthAfrica(latitude!, longitude!)) return void toast(OUTSIDE_SA, "warn");
      if (!(v["location"] ?? "").trim() && !hasCoordinates) {
        return void toast("Search for a farm location or enter its coordinates.", "warn");
      }

      try {
        const registered = await registerFarm({
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

        if (hasCoordinates && registered.farm_id) await saveFarmPlace(registered.farm_id, v, latitude!, longitude!);
        closeDrawer();
        toast(`${v["farmName"] || "The farm"} is registered.`, "success");
        await completeLaunchingRequest(`Completed by registering the farm "${(v["farmName"] ?? "").trim()}".`);
        return void refresh();
      } catch (e) {
        showErrorModal(
          "Could not register the farm",
          e instanceof Error ? e.message : "The farm could not be registered.",
        );
        return;
      }
    }
        /* Onboarding */
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
    return void showOnboardingError(err, err === OUTSIDE_SA || err.startsWith("Choose the farm") ? "location" : null);
  }

  clearOnboardingError();

  const zones = Array.from({ length: zoneCount }, (_, i) => readZoneSetup(v, i));
  const lat = v["latitude"] ? Number(v["latitude"]) : NaN;
  const lng = v["longitude"] ? Number(v["longitude"]) : NaN;
  const pinned = insideSouthAfrica(lat, lng);
  // One request id per attempt (AF-01): a Retry sends the same one, so the server continues the
  // same farm and farmer instead of creating a second.
  onboardingRequestId ??= newRequestId();

  const submit = document.querySelector<HTMLButtonElement>('[data-act="onboarding-submit"]');
  if (submit?.dataset["busy"] === "1") return;
  if (submit) { submit.dataset["busy"] = "1"; submit.disabled = true; submit.textContent = "Saving…"; }

  try {
    const result = await onboardFarmer({
      requestId: onboardingRequestId,
      enquiryId: onboardingFromEnquiry?.id ?? null,
      farmer: {
        fullName: v["fullName"] ?? "",
        email: v["email"] ?? "",
        phone: v["phone"] ?? "",
      },

      farm: {
        farmName: v["farmName"] ?? "",
        location: v["location"] ?? "",
        sizeHectares: Number(v["farmSize"]) || 0,
        // The pin and the province/town go with the first request and are saved with the farm in
        // one transaction: a rural pin no longer depends on the town search (AF-01).
        latitude: pinned ? lat : null,
        longitude: pinned ? lng : null,
        province: (v["province"] ?? "").trim() || null,
        town: (v["town"] ?? "").trim() || null,
        zones,
      },
    });

    toast(result.temporaryPassword ? "Farmer onboarded successfully." : result.message, "success");

    /* Do not navigate away: the temporary password exists nowhere else (the server never
     * stored it), so leaving now loses it and the only fix is a reset. The handover step is
     * where the installer finishes. */
    handoverProfileId = result.profileId;
    // The server linked the enquiry with the account (AF-24); its warning says if it could not.
    onboardingFromEnquiry = null;
    onboardingRequestId = null;
    lastOperation = null;

    await renderHandover(result);

    return void goToOnboardingStep(3);
  } catch (e) {
    if (e instanceof OnboardingError) {
      // Kept on the form with every entry, the message beside the part to fix, and what was
      // saved. Once anything is saved the button only ever retries the same attempt.
      showOnboardingError(e.message, e.field === "location" ? "location" : null, e.operation);
      return;
    }
    // No answer at all: ask the server what this attempt saved before offering anything.
    const op = onboardingRequestId ? await getOnboardingOperation(onboardingRequestId).catch(() => null) : null;
    showOnboardingError(e instanceof Error ? e.message : "Something went wrong.", null, op);
    return;
  } finally {
    if (submit) { submit.dataset["busy"] = ""; submit.disabled = false; submit.textContent = submitLabel(); }
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
        const reset = await resetFarmerPassword(handoverProfileId);

        const field = document.getElementById("handoverPassword");
        if (field && reset.temporaryPassword) field.textContent = reset.temporaryPassword;

        showHandoverNotice(
          reset.sentByTelegram
            ? "A new temporary password was sent to the farmer's Telegram. The previous one no longer works."
            : "A new temporary password was issued. The previous one no longer works.",
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
      onboardingRequestId = null;
      lastOperation = null;
      return void navigate("farms");
    /* Hardware */
    case "view-device": {
      const h = api.findHardware(idAttr);
      if (!h) return;
      return openDrawer({
        title: h.id,
        subtitle: `${h.type} · ${h.farm}`,
        bodyHtml: kitSetupCardHtml({
          hardwareId: h.id,
          deviceId: h.deviceId ?? null,
          zoneId: h.zoneId ?? null,
          zoneName: h.zoneName ?? null,
          farmName: h.farm,
          status: h.status,
          lastSeen: h.lastSeen || null,
          enrollmentCode: h.enrollmentCode ?? null,
          enrollmentExpiresAt: h.enrollmentCodeExpiresAt ?? null,
        }),
        fields: [
          { label: "Status", value: h.status },
          { label: "Maintenance", value: h.maintenanceState },
          { label: "Firmware", value: h.firmware },
          { label: "Battery", value: h.battery === null ? "Mains powered" : `${h.battery}%` },
          // Never "0.0%": nothing measures per-kit uptime, and a zero would look like a kit that was
          // never up.
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

    /* Device actions
     * All three go by zone, not hardware id: the commands go into irrigation_commands, which is
     * keyed on zone. A board with no zone has no links, so the guard is only for a stale render.
     * Each one asks first: Change WiFi takes a kit off the network, open setup exposes a local
     * setup page, and revoke cuts a board off for good. */
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
              // Whoever is standing at the kit needs the network name and password, so they go in the message.
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
              // A modal, not a toast: the HiveMQ step is a manual job the admin has to go and do.
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
      // Daily, a chosen day, per-zone PDFs and extra recipients need migration 0040. Until then
      // the controls show, disabled, with the reason, and are never silently ignored on save.
      const extras = current?.optionsAvailable !== false;
      const off = extras ? "" : "disabled";
      const frequency = current?.enabled ? current.frequency : "off";
      const day = current?.dayOfWeek ?? 1;
      const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

      const checkbox = (value: string, label: string, checked: boolean): string =>
        `<label class="drawer-field" style="flex-direction:row;align-items:center;gap:8px">
           <input type="checkbox" data-report-type="${value}" ${checked ? "checked" : ""} />
           <span>${esc(label)}</span>
         </label>`;

      const when = (iso: string | null | undefined): string =>
        iso ? fmtDateTimeSast(iso) : "—";

      return openDrawer({
        title: "Automatic reports",
        subtitle: api.findFarm(farmId)?.name ?? `Farm ${farmId}`,
        wide: true,
        bodyHtml: `
          <div class="drawer-section">
            <h6>Status</h6>
            <div class="detail-list">
              <div class="detail-row"><span>Now</span><b>${esc(current?.description ?? "Automatic reports: off")}</b></div>
              <div class="detail-row"><span>Last sent</span><b data-sched="last">${esc(when(current?.lastSentAt))}</b></div>
              <div class="detail-row"><span>Next send</span><b data-sched="next">${esc(when(current?.nextSendAt))}</b></div>
              ${current?.turnedOffBy
                ? `<div class="detail-row"><span>Turned off by</span><b>${esc(current.turnedOffBy)} · ${esc(when(current.turnedOffAt))}</b></div>`
                : ""}
            </div>
            ${extras ? "" : `<p class="muted">Daily reports, a chosen weekday, one PDF per zone and extra recipients need database migration 0040, which has not been applied yet.</p>`}
          </div>

          <div class="drawer-section">
            <h6>How often</h6>
            <label class="drawer-field">
              <span>Send</span>
              <select id="autoReportsFrequency" class="input">
                <option value="off" ${frequency === "off" ? "selected" : ""}>Off</option>
                <option value="daily" ${frequency === "daily" ? "selected" : ""} ${off}>Daily, 07:00 - one page of today's actions</option>
                <option value="weekly" ${frequency === "weekly" ? "selected" : ""}>Weekly, 07:00</option>
                <option value="monthly" ${frequency === "monthly" ? "selected" : ""}>Monthly, on the 1st at 07:00</option>
              </select>
            </label>
            <label class="drawer-field">
              <span>Weekly on</span>
              <select id="autoReportsDay" class="input" ${off}>
                ${days.map((d, i) => `<option value="${i + 1}" ${day === i + 1 ? "selected" : ""}>${d}</option>`).join("")}
              </select>
            </label>
            <p class="muted">South African time. Weekly and monthly reports cover the week or month that has just ended; daily ones are today's actions.</p>
          </div>

          <div class="drawer-section">
            <h6>Which reports</h6>
            ${checkbox("water_usage", "Water usage", types.includes("water_usage"))}
            ${checkbox("moisture", "Soil moisture (one per zone)", types.includes("moisture"))}
            ${checkbox("schedule", "Watering schedule & advice", types.includes("schedule"))}
            ${checkbox("farm_summary", "Farm summary (every zone in one report)", types.includes("farm_summary"))}
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
            <label class="drawer-field" style="flex-direction:row;align-items:center;gap:8px">
              <input type="radio" name="autoReportsPdf" value="all" ${current?.perZonePdf ? "" : "checked"} />
              <span>One PDF for all the chosen zones</span>
            </label>
            <label class="drawer-field" style="flex-direction:row;align-items:center;gap:8px">
              <input type="radio" name="autoReportsPdf" value="zone" ${current?.perZonePdf ? "checked" : ""} ${off} />
              <span>A tailored PDF for each zone</span>
            </label>
          </div>

          <div class="drawer-section">
            <h6>Who gets them</h6>
            <label class="drawer-field" style="flex-direction:row;align-items:center;gap:8px">
              <input type="checkbox" checked disabled />
              <span>The farmer - in the app, and on Telegram if connected</span>
            </label>
            <label class="drawer-field" style="flex-direction:row;align-items:center;gap:8px">
              <input type="checkbox" id="autoReportsHandler" ${current?.sendToHandler ? "checked" : ""} ${off} />
              <span>The admin who set this up (a copy on their Telegram)</span>
            </label>
            <label class="drawer-field" style="flex-direction:row;align-items:center;gap:8px">
              <input type="checkbox" id="autoReportsAdminChat" ${current?.adminChatEnabled ? "checked" : ""} ${off} />
              <span>The admin group chat (configured on the server)</span>
            </label>
            <p class="muted">The farmer can stop these themselves at any time. Turning them off records who did it.</p>
          </div>

          <div class="drawer-section">
            <h6>Check the template</h6>
            <button type="button" class="btn ghost sm" data-act="test-auto-reports" data-id="${farmId}">Send test now</button>
            <p class="muted">Sends this schedule's reports to your own Telegram only - never to the farmer. Save first.</p>
          </div>
        `,
        confirmLabel: "Save",
        onConfirm: () => {
          const choice =
            (document.getElementById("autoReportsFrequency") as HTMLSelectElement | null)?.value ?? "off";
          const enabled = choice !== "off";
          const frequency = (enabled ? choice : current?.frequency ?? "weekly") as ReportFrequency;
          const dayOfWeek = Number((document.getElementById("autoReportsDay") as HTMLSelectElement | null)?.value ?? 1);
          const perZonePdf =
            (document.querySelector<HTMLInputElement>('input[name="autoReportsPdf"]:checked')?.value ?? "all") === "zone";
          const sendToHandler =
            (document.getElementById("autoReportsHandler") as HTMLInputElement | null)?.checked ?? false;
          const adminChatEnabled =
            (document.getElementById("autoReportsAdminChat") as HTMLInputElement | null)?.checked ?? false;

          const reportTypes = [...document.querySelectorAll<HTMLInputElement>("[data-report-type]")]
            .filter((el) => el.checked)
            .map((el) => el.dataset["reportType"] ?? "")
            .filter(Boolean);

          const zoneSelect = document.getElementById("autoReportsZones") as HTMLSelectElement | null;
          const picked = [...(zoneSelect?.selectedOptions ?? [])].map((o) => o.value);
          // "All zones" wins if it is selected at all: null means every zone, including ones added
          // later. An empty array would mean "no zones" and send nothing.
          const zoneIds = picked.includes("all") || picked.length === 0
            ? null
            : picked.map(Number).filter(Number.isFinite);

          if (enabled && reportTypes.length === 0) {
            toast("Choose at least one report to send.", "warn");
            return;
          }

          void saveReportSchedule(farmId, {
            enabled, frequency, reportTypes, zoneIds,
            ...(extras ? { dayOfWeek, perZonePdf, sendToHandler, adminChatEnabled } : {}),
          })
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

    case "test-auto-reports": {
      const farmId = Number(idAttr);
      if (!farmId) return;
      try {
        const result = await sendReportScheduleTest(farmId);
        return void toast(result.message, result.sent > 0 ? "success" : "warn");
      } catch (error) {
        return showErrorModal(
          "Could not send the test",
          error instanceof Error ? error.message : "The test could not be sent.",
        );
      }
    }

    case "toggle-archived-farms":
      setShowArchivedFarms(!getShowArchivedFarms());
      return void refresh();

    /* Archive, not delete. The confirm text explains the difference because the two buttons
     * sit next to each other, and an archive is usually test data being tidied away, when a
     * mis-click is most likely. */
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

    /* "Run advice now" on a zone, to show the engine working during setup and the
     * presentation. The result shows the numbers in reading order, or the missing fields by
     * name when it cannot answer. */
    /* The zone's "Recommended for you", with Use these settings (Reset to recommended) or
     * Keep my own. */
    case "zone-max-run": {
      /* The longest single pump run on this zone (1-120 min). Water now is refused above it and
       * the kit stops there, so it must match the pump and the zone, not a wish. */
      const zoneId = Number(idAttr);
      const link = el;
      const current = link?.dataset["max"] ?? "5";
      const name = link?.dataset["name"] ?? `Zone ${zoneId}`;
      return openDrawer({
        title: `Maximum run time: ${name}`,
        subtitle: "The longest the pump may run in one go. Water now longer than this is refused, and the kit stops every run here.",
        fields: [{ label: "Minutes (1 to 120)", value: current, editable: true, name: "minutes" }],
        confirmLabel: "Save",
        onConfirm: (v) => {
          const minutes = Number(v["minutes"]);
          if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
            toast("Enter a whole number of minutes from 1 to 120.", "warn");
            return false;   // keep the drawer open to fix it
          }
          void setZoneMaxRun(zoneId, minutes)
            .then((r) => { toast(r.message, "success", 6000); void refresh(); })
            .catch((e: unknown) => showErrorModal(e instanceof Error ? e.message : "The maximum run time could not be saved.", "Could not save"));
        },
      });
    }
    case "zone-recommend": {
      const zoneId = Number(idAttr);
      if (!zoneId) return void toast("No zone selected.", "warn");
      try {
        const r = await getRecommendedSettings(zoneId);
        const level = r.confidence ? r.confidence.level.charAt(0).toUpperCase() + r.confidence.level.slice(1) : null;
        return openDrawer({
          title: "Recommended for you",
          subtitle: r.cropLabel ?? "",
          bodyHtml: r.available
            ? `<div class="drawer-section" data-recommend-zone="${zoneId}">
                 <p>${esc(r.text)}</p>
                 ${level ? `<p class="muted"><span class="pill">${esc(level)} confidence</span> ${esc(r.confidence!.reason)}</p>` : ""}
                 ${r.canApply === false && r.applyNote ? `<p class="muted">${esc(r.applyNote)}</p>` : ""}
                 <div class="form-foot">
                   <button class="btn ghost" data-drawer-close>Keep my own</button>
                   <button class="btn" data-act="zone-recommend-apply" data-id="${zoneId}"${r.canApply === false ? " disabled" : ""}>Use these settings</button>
                 </div>
               </div>`
            : `<p class="muted">${esc(r.text)}</p>`,
        });
      } catch (e) {
        return void showErrorModal("Could not work out recommended settings", e instanceof Error ? e.message : "Try again.");
      }
    }

    case "zone-recommend-apply": {
      const zoneId = Number(idAttr);
      try {
        const r = await useRecommendedSettings(zoneId);
        closeDrawer();
        return void toast(r.message, "success");
      } catch (e) {
        return void showErrorModal("Could not save these settings", e instanceof Error ? e.message : "Try again.");
      }
    }

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
                    `<li><b>${esc(i.severity)}</b> — ${esc(i.message)}</li>`).join("")}</ul>`
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

    /* Home: the attention queue and the KPI tiles
     * Each one opens the list it counts, already filtered. */
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
      // Farms and zones, where the list shows which field each zone is missing.
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

    /* Health */
    case "open-health":
      // Home holds the card. If we are already there, scroll to it instead of re-rendering.
      if (appState.activePage === "dashboard") {
        document.getElementById("systemHealth")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      return void navigate("dashboard");

    case "refresh-health":
      await refreshHealthPanel();
      return;

    /* Never a frozen page: any page that failed to load shows a Retry that comes back here. */
    case "retry-page":
      return void refresh();

    /* One request from start to end: what was asked for, who has worked on it, and every
     * recorded change. The state chain comes from service_request's own columns; the history
     * comes from the audit log, the only place that knows a status was changed twice. */
    case "view-request": {
      const requestId = Number(idAttr);
      if (!requestId) return;
      const intent = currentPanelIntent();

      const requests = await api.getServiceRequests();
      const request = requests.find((r) => r.id === requestId);
      if (!request) return void toast("That request could not be found.", "warn");
      const handledBy = (await getHandling("requests").catch(() => [])).find((h) => h.id === String(requestId));
      if (handledBy) {
        request.handledById = handledBy.handledBy;
        request.handledByName = handledBy.handledByName;
        request.claimedAt = handledBy.claimedAt;
      }

      // The log is extra on this panel: if 0037 is not applied, the details must still open.
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
              ["Request", request.requestType === "new_farm" ? "New farm" : "New zone"],
              ["Farm", esc(request.farmName ?? "Not set up yet")],
              ["Crop", esc(formatCrop(request.cropType))],
              ["Rough size", roughSizeText(request.roughSize, request.roughSizeUnit)],
              ["Location", esc(request.location ?? "Not stated")],
              ["Contact", esc(request.farmerEmail || "Not on file")],
              ["Notes", esc(request.notes ?? "None")],
            ])}
          </div>
          <div class="drawer-section"><h6>Handled by</h6>
            ${handlingCell("requests", request, getAdminProfile()?.id, request.status === "completed")}
          </div>
          <div class="drawer-section"><h6>Next</h6>
            ${requestActions(request, getAdminProfile()?.id)}
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

    /* Who is dealing with a request: a picker over real admin profiles, so the name always
     * means a specific person. */
    case "export-activity-csv": {
      const log = await getActivityLog();

      // downloadExcelSafeCsv, not downloadCSV: the plain one opens in Excel with every value in
      // column A on a South African machine. See lib/workbook.ts.
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

    /* Dismiss a notification. Critical ones ask for an optional note first. Undo (5 s)
     * restores it; both steps are recorded. */
    case "dismiss-item": {
      const d = el.dataset;
      const critical = d["critical"] === "1";
      const send = (note: string | null): void => {
        void dismissNotification({
          kind: d["kind"] ?? "", itemKey: d["key"] ?? "", title: d["title"] ?? "",
          raisedAt: d["raised"] || null, critical, conditionKey: d["condition"] || null, note,
        })
          .then((r) => {
            toastWithUndo("Dismissed. It is under Dismissed if you need it back.", () => {
              void restoreDismissal(r.id)
                .then(() => { toast("Restored.", "success"); void refresh(); })
                .catch((e: unknown) => showErrorModal("Could not undo", e instanceof Error ? e.message : "Try Restore under Dismissed."));
            });
            void refresh();
          })
          .catch((e: unknown) => showErrorModal("Could not dismiss", e instanceof Error ? e.message : "Nothing was changed."));
      };
      if (!critical) return void send(null);
      return openDrawer({
        title: "Dismiss this?",
        subtitle: "It is critical. It comes back if it happens again.",
        fields: [{ label: "Note (optional)", value: "", editable: true, name: "note" }],
        confirmLabel: "Dismiss",
        onConfirm: (v) => send((v["note"] ?? "").trim() || null),
      });
    }

    case "restore-dismissal": {
      try {
        await restoreDismissal(Number(idAttr));
        toast("Restored.", "success");
      } catch (e) {
        showErrorModal("Could not restore", e instanceof Error ? e.message : "Nothing was changed.");
      }
      return void refresh();
    }

    case "dismiss-view":
      setDismissView(el.dataset["surface"] ?? "", el.dataset["view"] ?? "active");
      return void refresh();

    /* The Enquiries & sales follow-up report. */
    case "enquiry-report": {
      const val = (sel: string): string =>
        (document.querySelector<HTMLInputElement | HTMLSelectElement>(sel)?.value ?? "").trim();
      const from = val("[data-enq-from]");
      const to = val("[data-enq-to]");
      if (from && to && from > to) return void toast("The start date is after the end date.", "warn");
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (val("[data-enq-province]")) qs.set("province", val("[data-enq-province]"));
      if (val("[data-enq-handler]")) qs.set("handler", val("[data-enq-handler]"));
      const format = el.dataset["format"] === "xlsx" ? "xlsx" : "pdf";
      try {
        await downloadReportFile(`/api/admin/reports/enquiries.${format}?${qs.toString()}`,
          `agroflow-enquiries-${from || "last-30-days"}_${to || "today"}.${format}`);
        return void toast("Report downloaded.", "success");
      } catch (e) {
        return void showErrorModal("Could not build the report", e instanceof Error ? e.message : "Try again.");
      }
    }

    /* The two tabs on Requests. */
    case "requests-tab":
      // Each tab has its own address (#requests, #enquiries), so the sidebar shows the right one.
      setRequestsTab(el.dataset["tab"] ?? "requests");
      return void showPage(el.dataset["tab"] === "enquiries" ? "enquiries" : "requests");

    // Open / Completed / All.
    case "requests-filter":
      setRequestFilter(el.dataset["filter"] ?? "all");
      return void refresh();

    case "go-enquiries":
      return void showPage("enquiries");

    case "enquiry-claim":
      try {
        toast((await claimEnquiry(Number(idAttr))).message, "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not take this on.", "warn");
      }
      return void refresh();

    case "enquiry-take-over": {
      const who = el.dataset["handler"] ?? "another admin";
      return openDrawer({
        title: "Take over",
        subtitle: `${who} is handling this enquiry. Your name and theirs, and your reason, go on the record.`,
        fields: [{ label: "Why are you taking this over?", value: "", editable: true, name: "reason" }],
        confirmLabel: "Take over",
        onConfirm: (v) => {
          void takeOverEnquiry(Number(idAttr), v["reason"] ?? "")
            .then((r) => { toast(r.message, "success"); void refresh(); })
            .catch((e: unknown) => showErrorModal("Could not take this over", e instanceof Error ? e.message : "Not saved."));
        },
      });
    }

    case "enquiry-log-call": {
      const enquiryId = Number(idAttr);
      return openDrawer({
        title: "Log call",
        subtitle: "Every call is kept, with your name and the time.",
        bodyHtml: logCallHtml(),
        confirmLabel: "Log call",
        onOpen: () => {
          const box = document.querySelector<HTMLElement>(".log-call");
          box?.addEventListener("change", () => syncLogCall(box));
        },
        onConfirm: () => {
          const box = document.querySelector<HTMLElement>(".log-call");
          if (!box) return;
          const { call, problem } = readLogCall(box);
          if (problem) {
            toast(problem, "warn");
            return false;
          }
          void logEnquiryCall(enquiryId, call)
            .then((r) => { toast(r.message, r.suggestClosing ? "warn" : "success"); void refresh(); })
            .catch((e: unknown) => showErrorModal("Could not log the call", e instanceof Error ? e.message : "Not saved."));
        },
      });
    }

    case "enquiry-close":
      return openDrawer({
        title: "Close this enquiry",
        subtitle: "For an enquiry nobody can reach. It stays in the report.",
        fields: [{ label: "Note (optional)", value: "", editable: true, name: "note" }],
        confirmLabel: "Close",
        onConfirm: (v) => {
          void closeEnquiry(Number(idAttr), (v["note"] ?? "").trim() || undefined)
            .then((r) => { toast(r.message, "success"); void refresh(); })
            .catch((e: unknown) => showErrorModal("Could not close the enquiry", e instanceof Error ? e.message : "Not saved."));
        },
      });

    case "enquiry-anonymise":
      return openDrawer({
        title: "Delete personal details",
        subtitle: "Their name, phone number, email and notes are removed for good. Province, crops, outcome and reason stay, for the statistics. This is recorded.",
        confirmLabel: "Delete personal details",
        onConfirm: () => {
          void anonymiseEnquiry(Number(idAttr))
            .then((r) => { toast(r.message, "success"); void refresh(); })
            .catch((e: unknown) => showErrorModal("Could not delete the details", e instanceof Error ? e.message : "Nothing was changed."));
        },
      });

    case "enquiry-onboard": {
      const enquiry = (await getEnquiries()).find((e) => String(e.id) === idAttr);
      if (!enquiry) return void toast("That enquiry could not be found.", "warn");
      onboardingFromEnquiry = enquiry;
      onboardingPrefilled = false;
      return void navigate("onboarding");
    }

    // AF-24: an enquiry whose farmer was onboarded another way is linked, not duplicated. Possible
    // matches (same phone or email) are listed first, but staff choose: nothing links by itself,
    // and no call is logged.
    case "enquiry-link": {
      const enquiry = (await getEnquiries()).find((e) => String(e.id) === idAttr);
      if (!enquiry) return void toast("That enquiry could not be found.", "warn");
      const farmers = await api.getFarmerAccounts().catch(() => [] as User[]);
      const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-9);
      const match = (u: User) => (enquiry.phone && digits(u.phone) && digits(u.phone) === digits(enquiry.phone))
        || (enquiry.email && u.email && u.email.toLowerCase() === enquiry.email.toLowerCase());
      const ordered = [...farmers.filter(match), ...farmers.filter((u) => !match(u))];
      return void openDrawer({
        title: `Link enquiry #${enquiry.id} to a farmer`,
        subtitle: "For a farmer who already has an account. The enquiry is completed; no call is logged.",
        bodyHtml: `
          <label class="f">Farmer
            <select data-field="linkFarmer">
              <option value="">Choose the farmer…</option>
              ${ordered.map((u) => `<option value="${esc(u.id)}">${match(u) ? "Possible match: " : ""}${esc(u.name)} · ${esc(u.farm)} · ${esc(u.phone || u.email)}</option>`).join("")}
            </select>
          </label>
          <p class="muted">Enquiry: ${esc(enquiry.fullName ?? "")} · ${esc(enquiry.phone ?? "")} · ${esc(enquiry.town ?? "")}, ${esc(enquiry.province)}.
            A possible match only means the phone or email is the same; check it is the same person.</p>`,
        confirmLabel: "Link and complete the enquiry",
        onConfirm: (values) => {
          const farmer = values["linkFarmer"];
          if (!farmer) { toast("Choose the farmer first.", "warn"); return false; }
          void linkEnquiryToFarmer(enquiry.id, farmer)
            .then(async (r) => { toast(r.message, "success"); await refresh(); })
            .catch((e: unknown) => showErrorModal("Could not link the enquiry", plainError(e, "Nothing was changed.")));
          return true;
        },
      });
    }

    case "view-enquiry": {
      const intent = currentPanelIntent();
      const [enquiries, calls] = await Promise.all([getEnquiries(), getEnquiryCalls(Number(idAttr)).catch(() => [])]);
      const e = enquiries.find((x) => String(x.id) === idAttr);
      if (!e) return void toast("That enquiry could not be found.", "warn");
      const myId = getAdminProfile()?.id;
      return openDrawer({
        intent,
        title: e.fullName ?? "Enquiry (details deleted)",
        subtitle: [e.town, e.province].filter(Boolean).join(", "),
        wide: true,
        bodyHtml: `
          <div class="drawer-section"><h6>What they told us</h6>
            ${detailList([
              ["Phone", e.phone ? `<a href="tel:${esc(e.phone)}">${esc(e.phone)}</a>` : "Deleted"],
              ["Email", esc(e.email ?? (e.anonymisedAt ? "Deleted" : "Not given"))],
              ["Crops", esc(cropsText(e))],
              ["Farm size", e.farmSizeHa != null ? fmtArea(e.farmSizeHa) : "Not given"],
              ["Best time to call", esc(e.bestTime)],
              ["Notes", esc(e.notes ?? "None")],
              ["Received", esc(fmtDateTimeSast(e.createdAt))],
            ])}
          </div>
          <div class="drawer-section"><h6>Status</h6>${enquiryStatus(e)}</div>
          <div class="drawer-section"><h6>Next</h6>${enquiryActions(e, myId)}</div>
          <div class="drawer-section"><h6>Calls</h6>${callHistory(calls)}</div>`,
        confirmLabel: "Close",
        onConfirm: () => undefined,
      });
    }

    /* [Mark complete], with an optional note. */
    case "request-complete": {
      const requestId = Number(idAttr);
      return openDrawer({
        title: "Mark complete",
        subtitle: "Your name and the time go on the record.",
        fields: [{ label: "Note (optional)", value: "", editable: true, name: "note" }],
        confirmLabel: "Mark complete",
        onConfirm: (v) => {
          void api.updateServiceRequestStatus(requestId, "completed", (v["note"] ?? "").trim() || undefined)
            .then(() => { toast("Request completed.", "success"); void refresh(); })
            .catch((e: unknown) => showErrorModal("Could not complete the request", e instanceof Error ? e.message : "Not saved."));
        },
      });
    }

    /* Carry out the request: prefilled, and saving completes it. */
    case "request-setup": {
      const r = (await api.getServiceRequests()).find((x) => String(x.id) === idAttr);
      if (!r) return void toast("That request could not be found.", "warn");
      if (r.requestType === "new_zone" && r.farmId !== null) return openAddZonesWizard(r);
      return openRegisterFarmWizard(r);
    }

    case "go-onboarding":
      // A new_farm request has no farm yet, so there is no zone to enrol a kit onto. We send the
      // admin through zone setup first.
      toast("Set up the farm and its zones first, then create the enrollment code.", "warn");
      return void navigate("onboarding");

    /* The code the installer types into the kit's setup page. Uses the existing generator
     * (POST /api/devices/enroll): single-use, 24 hours, and the only authorisation the claim needs. */
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
        // The farm has no zones. Same answer as a new_farm request: the claim resolves
        // hardware.zone_id, so the zone must exist first.
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
              // A modal, not a toast: this is a credential the installer has to write down, and a toast
              // disappears while they look for a pen.
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

        // Clear the box on success, so a second click cannot re-submit the same batch.
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
    // A real maintenance job for this kit, booked and handled by the caller. There is no
    // technician picker.
    case "schedule-device-maint":
      return openDrawer({
        title: `Schedule service — ${idAttr}`,
        fields: [
          { label: "What needs doing", value: "", editable: true, name: "issue" },
          { label: "Visit date (yyyy-mm-dd)", value: todayIso(), editable: true, name: "date" },
        ],
        confirmLabel: "Book visit",
        onConfirm: (v) => {
          void createMaintenance({ hardwareId: Number(idAttr) || null, description: v["issue"] ?? "", date: v["date"] ?? "" })
            .then((r) => { toast(r.message, "success"); void refresh(); })
            .catch((e: unknown) => showErrorModal("Could not book the visit", e instanceof Error ? e.message : "Not saved."));
        },
      });
    // Kept as an alias so an old bookmark or button still reaches the real kit wizard.
    case "add-device":
      return handleAction(withAct(el, "register-hardware"));

    /* Handling: always the caller's own name */
    case "claim-item": {
      const kind = (el.dataset["kind"] ?? "") as HandlingKind;
      try {
        const r = await claimItem(kind, idAttr);
        toast(r.message, "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not claim this.", "warn");
      }
      return void refresh();
    }
    case "release-item": {
      const kind = (el.dataset["kind"] ?? "") as HandlingKind;
      try {
        const r = await releaseItem(kind, idAttr);
        toast(r.message, "info");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not let this go.", "warn");
      }
      return void refresh();
    }
    case "take-over-item": {
      const kind = (el.dataset["kind"] ?? "") as HandlingKind;
      const who = el.dataset["handler"] ?? "another admin";
      return openDrawer({
        title: "Take over",
        subtitle: `${who} is handling this. Your name and theirs, and your reason, go on the record.`,
        fields: [{ label: "Why are you taking this over?", value: "", editable: true, name: "reason" }],
        confirmLabel: "Take over",
        onConfirm: (v) => {
          void takeOverItem(kind, idAttr, v["reason"] ?? "")
            .then((r) => { toast(r.message, "success"); void refresh(); })
            .catch((e: unknown) => showErrorModal("Could not take this over", e instanceof Error ? e.message : "Not saved."));
        },
      });
    }

    /* alerts */
    case "view-alert": {
      const a = api.findAlert(idAttr);
      if (!a) return;
      // We take the panel intent before the await: if another panel is asked for meanwhile,
      // this one must not open over it. (No "Why am I seeing this?" in the console: that is
      // for farmers, in the app.)
      const alertIntent = currentPanelIntent();
      const history = await getEntityTimeline("alert", a.id).catch(() => null);
      return openDrawer({
        intent: alertIntent,
        title: a.id,
        subtitle: a.title,
        wide: true,
        bodyHtml: `
          <div class="drawer-section"><h6>Details</h6>
            <div class="detail-list">
              <div class="detail-row"><span>Raised</span><b>${esc(fmtDateTimeSast(a.raised))}</b></div>
              <div class="detail-row"><span>Category</span><b>${esc(a.category)}</b></div>
              <div class="detail-row"><span>Farm</span><b>${esc(a.farm ?? "Platform")}</b></div>
              <div class="detail-row"><span>Farmer</span><b>${esc(a.user ?? "—")}</b></div>
              <div class="detail-row"><span>Handled by</span><b>${handledLine(a)}</b></div>
              ${a.resolvedByName ? `<div class="detail-row"><span>Resolved</span><b>Resolved by ${esc(a.resolvedByName)} on ${esc(fmtDateTimeSast(a.resolvedAt ?? ""))}</b></div>` : ""}
              <div class="detail-row"><span>Priority</span><b>${esc(a.priority)}</b></div>
              <div class="detail-row"><span>Status</span><b>${esc(a.status)}</b></div>
            </div>
          </div>
          <div class="drawer-section"><h6>Timeline</h6>
            ${history === null
              ? `<p class="muted">The timeline could not be read.</p>`
              : timelineHtml(history, "Nothing has been done on this alert yet.")}
          </div>`,
        confirmLabel: a.status === "Resolved" ? undefined : "Resolve alert",
        onConfirm: a.status === "Resolved" ? undefined : () => { void runItemAction("alerts", a.id, "resolve"); },
      });
    }
    case "note-alert":
      return openDrawer({
        title: `Add note — ${idAttr}`,
        fields: [{ label: "Note", value: "", editable: true, name: "note" }],
        confirmLabel: "Add note",
        onConfirm: (v) => { void runItemAction("alerts", idAttr, "note", v["note"] ?? ""); },
      });
    case "escalate-alert": return runItemAction("alerts", idAttr, "escalate");
    case "resolve-alert": return runItemAction("alerts", idAttr, "resolve");
    case "close-alert": return runItemAction("alerts", idAttr, "close");
    case "reopen-alert": return runItemAction("alerts", idAttr, "reopen");

    /* maintenance */
    case "schedule-visit":
      return openDrawer({
        title: `Schedule visit — ${idAttr}`,
        fields: [{ label: "Visit date (yyyy-mm-dd)", value: todayIso(), editable: true, name: "date" }],
        confirmLabel: "Schedule",
        onConfirm: (v) => { void runItemAction("maintenance", idAttr, "schedule", undefined, v["date"] ?? ""); },
      });
    case "complete-maint": return runItemAction("maintenance", idAttr, "complete");
    case "note-maint":
      return openDrawer({
        title: `Add note — job ${idAttr}`,
        fields: [{ label: "Note", value: "", editable: true, name: "note" }],
        confirmLabel: "Add note",
        onConfirm: (v) => { void runItemAction("maintenance", idAttr, "note", v["note"] ?? ""); },
      });
    case "maint-history": {
      const m = api.findMaintenance(idAttr);
      if (!m) return;
      const intent = currentPanelIntent();
      const history = await getEntityTimeline("maintenance", m.id).catch(() => null);
      return openDrawer({
        intent,
        title: `Job ${m.id}`,
        subtitle: `${m.issue} · ${m.farm}`,
        wide: true,
        bodyHtml: `
          <div class="drawer-section"><div class="detail-list">
            <div class="detail-row"><span>Handled by</span><b>${handledLine(m)}</b></div>
            ${m.resolvedByName ? `<div class="detail-row"><span>Completed</span><b>Completed by ${esc(m.resolvedByName)} on ${esc(fmtDateTimeSast(m.resolvedAt ?? ""))}</b></div>` : ""}
          </div></div>
          <div class="drawer-section"><h6>Timeline</h6>
            ${history === null
              ? `<p class="muted">The timeline could not be read.</p>`
              : timelineHtml(history, "Nothing has been done on this job yet.")}
          </div>`,
      });
    }
    case "schedule-maint":
      return openDrawer({
        title: "Schedule maintenance",
        fields: [
          { label: "Kit (device) number", value: "", editable: true, name: "device" },
          { label: "What needs doing", value: "", editable: true, name: "issue" },
          { label: "Visit date (yyyy-mm-dd)", value: todayIso(), editable: true, name: "date" },
        ],
        confirmLabel: "Book visit",
        onConfirm: (v) => {
          void createMaintenance({ hardwareId: Number(v["device"]) || null, description: v["issue"] ?? "", date: v["date"] ?? "" })
            .then((r) => { toast(r.message, "success"); void refresh(); })
            .catch((e: unknown) => showErrorModal("Could not book the visit", e instanceof Error ? e.message : "Not saved."));
        },
      });

    /* reports */
    case "run-comparison": return runComparison();    
    case "farm-report-preview": return farmReportPreview();
    case "farm-report-pdf": return farmReportPdf();
    case "farm-report-xlsx": return farmReportXlsx();
    case "view-attention": return openAttentionGroup(idAttr);
    /* A real file from what is on screen. We read back the table runComparison put in
     * #cmpResult, so the export matches what the admin sees instead of re-running the comparison. */
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
    /* Settings that save to the database. */
    // The Retry on either Settings panel's error state.
    case "go-settings-account":
      return void refreshMyTelegramStatus();

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

    case "open-change-password": {
      // From the account menu: Settings, My account, with the new-password box focused.
      document.getElementById("avatarMenu")?.classList.remove("open");
      navigate("settings");
      window.setTimeout(() => {
        const box = document.querySelector<HTMLInputElement>('[data-field="newPassword"]');
        box?.scrollIntoView({ block: "center" });
        box?.focus();
      }, 400);
      return;
    }
    case "change-my-password": {
      const v = collectFields();
      const password = v["newPassword"] ?? "";
      const again = v["newPasswordAgain"] ?? "";

      // Checked here as well as by Supabase, so the answer shows in the page instead of as an
      // API error, and so a mismatch (which Supabase cannot see) is caught.
      if (password.length < 8) {
        return void toast("Use at least 8 characters.", "warn");
      }

      if (password !== again) {
        return void toast("The two passwords do not match.", "warn");
      }

      try {
        await changeMyPassword(password);

        // Cleared from the page straight away: a password left in an input shows up in every later
        // screenshot.
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

        // A modal, not a toast: this is a code someone has to read and use.
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

/* comparison report */

async function runComparison(): Promise<void> {
  const get = (id: string): string =>
    (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";

  const mode = get("cmpMode");
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

      // Skipped, not counted as zero. In a comparison a silent zero looks like a real drop in
      // water use, not a zone with no flow rate.
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
    <div class="cmp-head">Estimated water use · ${esc(mode)} — Period A (${esc(aFrom)} → ${esc(aTo)}) vs Period B (${esc(bFrom)} → ${esc(bTo)})</div>
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

/* The Settings page's two async panels. settingsTabBody renders them empty and we fill them
 * here, because a tab body is a plain string and both need the network. Each handles its
 * own failure, so a Telegram status that cannot load does not break the page. */
export async function refreshMyTelegramStatus(): Promise<void> {
  const host = document.getElementById("myTelegramStatus");
  if (!host) return;
  // Telegram is for farmers only (docs/telegram-farmers-only.md): staff have nothing to link.
  host.innerHTML = `<p class="muted">Telegram is for farmers only. You get every notice on Home and under the bell at the top of the page.</p>`;
}

/* The old staff Telegram panel, kept for reference only; never called. */
export async function refreshMyTelegramStatusOld(): Promise<void> {
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

/* The comparison table's rows, read back from the page. We do not recompute, so the export
 * matches what the admin sees even if the filters changed after they pressed Compare. */
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

/* The farmer whose handover screen is open, used by Regenerate code and Reset password. */
let handoverProfileId: string | null = null;

async function renderHandover(result: {
  email: string;
  temporaryPassword: string | null;
  telegramDeepLink: string | null;
  telegramCodeExpiresAt: string | null;
  warning: string | null;
}): Promise<void> {
  const email = document.getElementById("handoverEmail");
  if (email) email.textContent = result.email;

  const password = document.getElementById("handoverPassword");
  // Null: this request had already finished; the password was shown then (use Reset password).
  if (password) password.textContent = result.temporaryPassword ?? "Already shown: use Reset password for a new one";

  await renderQr(result.telegramDeepLink, result.telegramCodeExpiresAt);

  if (result.warning) {
    showHandoverNotice(result.warning);
  } else {
    clearHandoverNotice();
  }
}

/* Draws the t.me deep link as a QR code. A null link means the server has no bot username;
 * the farmer then gets the credentials read out, so the QR area says so. */
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
    /* A QR that will not draw is not a failed onboarding: the link text and the password still work. */
    canvas.style.display = "none";
  }
}

function showHandoverNotice(message: string): void {
  const box = document.getElementById("handoverNotice");
  if (!box) return;
  box.textContent = plainError(message);
  box.style.display = "block";
}

function clearHandoverNotice(): void {
  const box = document.getElementById("handoverNotice");
  if (!box) return;
  box.style.display = "none";
  box.textContent = "";
}

/* B3-01: the message goes beside the part to fix (the location section for a location problem),
 * the entries stay, and when the server saved something it says what, and the button becomes
 * "Retry (continues the same farm)". Never an unconditional "Create again". */
let lastOperation: OnboardingOperation | null = null;

function showOnboardingError(message: string, near: "location" | null = null, operation: OnboardingOperation | null = null): void {
  const box = document.getElementById(near === "location" ? "onboardingLocationError" : "onboardingError")
    ?? document.getElementById("onboardingError");
  if (!box) return;
  const saved = operation && operation.offer !== "new_form" ? ` ${operation.message}` : "";
  box.textContent = plainError(message) + saved;
  box.style.display = "block";
  box.setAttribute("role", "alert");
  lastOperation = operation;
  const submit = document.querySelector<HTMLButtonElement>('[data-act="onboarding-submit"]');
  if (submit) submit.textContent = submitLabel();
  if (near === "location") document.querySelector<HTMLElement>('[data-map-pick="onboardingLocation"]')?.scrollIntoView({ block: "center" });
}

function clearOnboardingError(): void {
  for (const id of ["onboardingError", "onboardingLocationError"]) {
    const box = document.getElementById(id);
    if (!box) continue;
    box.style.display = "none";
    box.textContent = "";
  }
}

function submitLabel(): string {
  return lastOperation?.offer === "retry" ? "Retry (continues the same farm)" : "Onboard farmer";
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function goToOnboardingStep(step: 1 | 2 | 3): void {
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((el) => {
    el.style.display = el.dataset["step"] === String(step) ? "" : "none";
  });
  // The location picker is on step 2; it is mounted once that step is visible, so the map
  // can measure itself.
  const picker = document.querySelector<HTMLElement>('[data-map-pick="onboardingLocation"]');
  if (step === 2 && picker && !picker.dataset["mounted"]) {
    picker.dataset["mounted"] = "1";
    void mountLocationPicker(picker);
  }
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
  // The same rule as the server and the public form (AF-20).
  const phone = phoneProblem(v["phone"]);
  if (phone) return phone;

  return null;
}

function validateOnboardingStep2(v: Record<string, string>, zoneCount: number): string | null {
  if (!v["farmName"]?.trim()) return "Farm name is required.";
  const lat = v["latitude"] ? Number(v["latitude"]) : null;
  const lng = v["longitude"] ? Number(v["longitude"]) : null;
  if ((lat !== null || lng !== null) && !(lat !== null && lng !== null && insideSouthAfrica(lat, lng))) return OUTSIDE_SA;
  // Valid coordinates are enough on their own: a rural farm does not need a recognised town (AF-01).
  if (!v["location"]?.trim() && !(lat !== null && lng !== null)) return "Choose the farm's province and town, pin it on the map, or enter its coordinates.";
  if (!v["farmSize"] || Number(v["farmSize"]) <= 0) return "Enter a valid farm size.";
  if (zoneCount === 0) return "Add at least one zone.";

  for (let i = 0; i < zoneCount; i++) {
    if (!v[`zone_name_${i}`]?.trim()) {
      return `Zone ${i + 1} needs a name.`;
    }

    if (!v[`zone_area_preset_${i}`]) {
      return `Choose how big zone ${i + 1} is.`;
    }

    if (!v[`zone_crop_${i}`]?.trim()) {
      return `Zone ${i + 1} needs a crop type.`;
    }

    const setup = zoneSetupProblem(v, i);
    if (setup) return setup;
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
    container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((el) => {
      const name = el.dataset["field"] ?? "";
      if (existing[name]) el.value = existing[name];
    });
    syncZoneChoices(container);
  });
  wireZoneChoices(container);
}

/* A custom size shows its m² box. Soil cards go through the delegated "zone-soil" action.
 * Bound once per container. */
function wireZoneChoices(container: HTMLElement): void {
  if (container.dataset["choicesBound"]) return;
  container.dataset["choicesBound"] = "1";
  container.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    if (target.matches("[data-area-preset]")) syncZoneChoices(container);
    const row = target.closest<HTMLElement>("[data-zone-row]");
    if (row) void refreshRecommendation(row);
  });
  // The soil cards are buttons, not inputs, so they raise no change event.
  container.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-act="zone-soil"]');
    const row = card?.closest<HTMLElement>("[data-zone-row]");
    if (row) window.setTimeout(() => void refreshRecommendation(row), 0);
  });
}

/* The wizard's card for one zone, once a crop is chosen. The latest request wins; an
 * answer for an older crop choice is dropped. */
async function refreshRecommendation(row: HTMLElement): Promise<void> {
  const i = Number(row.dataset["zoneIndex"]);
  const box = row.querySelector<HTMLElement>(`[data-recommend="${i}"]`);
  if (!box) return;
  const v = collectFields();
  const z = readZoneSetup(v, i);
  if (!z.cropType) {
    box.innerHTML = "";
    return;
  }
  const ticket = String(Date.now() + Math.random());
  box.dataset["ticket"] = ticket;
  try {
    const r = await previewRecommendedSettings({
      cropType: z.cropType, soilType: z.soilType, areaM2: z.areaM2, flowRateLpm: z.flowRateLpm,
      rootDepthLimitM: z.rootDepthLimitM, plantingDate: z.plantingDate,
      location: (v["location"] ?? "").split(",")[0].trim(),
    });
    if (box.dataset["ticket"] === ticket) box.innerHTML = recommendHtml(r);
  } catch {
    if (box.dataset["ticket"] === ticket) box.innerHTML = "";
  }
}

/* binding after render */
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

    // What was already typed is read before the rebuild and put back after, so changing the
    // count keeps the zones already filled in.
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
    syncZoneChoices(container);
  };

  countInput.addEventListener("input", renderZones);
  wireZoneChoices(container);

  renderZones();
}


/* The kit wizard's two dependent steps. Each is rebuilt when the step before it changes, so
 * a farm list never shows the previous farmer's farms. Rebuilding also clears the hidden
 * field, so a stale zone id cannot be submitted. */
/* The farm and zone names the wizard showed, for the result card and the label. */
let lastKitWizardNames: { zoneName: string; farmName: string } = { zoneName: "", farmName: "" };
const kitWizardNames = () => ({ ...lastKitWizardNames });

/* After "Create the enrollment code": the kit setup card with the code, its expiry and the
 * three steps. Until the kit claims, it asks the API every 5 s; once the kit has a device ID the
 * card fills in its hotspot (and the code is gone, as the claim cleared it). */
function openKitSetupResult(
  result: { hardwareId: number; enrollmentCode: string; expiresAt: string },
  known: { deviceId: string | null; zoneId: number; zoneName: string; farmName: string },
): void {
  const card = (deviceId: string | null, claimed: boolean): string => `
    <div id="kitSetupResult" data-hardware-id="${result.hardwareId}">
      ${claimed
        ? `<p class="ok" data-kit-claimed>The kit is connected. Its setup details are below for later (a new router or a move).</p>`
        : `<p class="muted">Give this card to the installer. The enrollment code works once, on this kit's setup page.</p>`}
      ${kitSetupCardHtml({
        hardwareId: result.hardwareId,
        deviceId,
        zoneId: known.zoneId,
        zoneName: known.zoneName,
        farmName: known.farmName,
        enrollmentCode: claimed ? null : result.enrollmentCode,
        enrollmentExpiresAt: claimed ? null : result.expiresAt,
      })}
    </div>`;

  openDrawer({ title: "Kit setup card", subtitle: [known.farmName, known.zoneName].filter(Boolean).join(" · "), wide: true, bodyHtml: card(known.deviceId, false) });

  const poll = window.setInterval(() => {
    const host = document.getElementById("kitSetupResult");
    if (!host || host.dataset["hardwareId"] !== String(result.hardwareId)) return void window.clearInterval(poll);
    void getAdminHardware()
      .then((rows) => {
        const row = rows.find((r) => r.hardwareId === result.hardwareId);
        if (!row?.deviceId || row.enrollmentStatus === "enrolled") return;
        window.clearInterval(poll);
        host.outerHTML = card(row.deviceId, true);
      })
      .catch(() => undefined);   // try again in 5 s
  }, 5000);
}

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
    lastKitWizardNames = { zoneName: chosenZoneName, farmName: chosenFarmName };

    review.innerHTML = detailList([
      ["Farm", esc(chosenFarmName || "Not chosen")],
      ["Zone", esc(chosenZoneName || "Not chosen")],
      ["Kit type", esc(kit?.label ?? v["kitType"] ?? "Not chosen")],
      ["Kit name", esc(v["kitName"]?.trim() || "Named after its zone")],
    ]) + `
      <p class="muted">
        Creating the code does not install anything. It makes a single-use credential,
        valid for 24 hours, that the installer enters on the kit once.
      </p>` + kitSetupCardHtml({
        deviceId: normaliseDeviceId(v["kitDeviceId"]) || null,
        zoneId: Number(v["kitZoneId"]) || null,
        zoneName: chosenZoneName,
        farmName: chosenFarmName,
        codePending: true,
      });
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
          secondary: `${f.region || f.province || "Location not set"} · ${fmtArea(f.hectares)}`,
        })),
      });

      // The new picker's markup has to be bound; wirePickers skips what it already bound.
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
            // A farm with no zones cannot take a kit (the claim resolves hardware.zone_id), so we say
            // so instead of showing an empty picker.
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

/* The register-farm wizard. Given a request, it is prefilled from it (farmer, location,
 * size, crop) and saving completes the request. */
let completeRequestOnSave: number | null = null;

async function openRegisterFarmWizard(fromRequest: ServiceRequest | null): Promise<void> {
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

  // Launched from a request, saving completes that request.
  completeRequestOnSave = fromRequest?.id ?? null;

  return openDrawer({
    title: fromRequest ? `Set up ${fromRequest.farmerName}'s farm` : "Register a new farm",
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
            value: fromRequest?.farmerId,
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
                Nearest locality (optional when coordinates are supplied)
                <input
                  type="text"
                  data-field="location"
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

      /* The map is on step 2, which is hidden when the drawer opens, so we mount it now and tell
       * it to re-measure when the step becomes visible. */
      const mapHost = document.querySelector<HTMLElement>("[data-map-pick]");
      if (mapHost) void mountLocationPicker(mapHost);

      if (fromRequest) prefillFromRequest(fromRequest);
    },
  });
}

/* Fill the wizard from what the farmer asked for. Anything the request does not say is
 * left for the admin. */
function prefillFromRequest(r: ServiceRequest): void {
  const set = (field: string, value: string | number | null | undefined): void => {
    const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`);
    if (el && value !== null && value !== undefined && value !== "") el.value = String(value);
  };
  set("location", r.location);
  set("farmSize", r.roughSize);
  set("zone_name_0", "Zone 1");
  set("zone_crop_0", r.cropType);
  set("zone_size_0", r.roughSize);
}

/* After a wizard launched from a request saves, the request is done, completed by whoever
 * saved it (the API takes them from the login). */
async function completeLaunchingRequest(note: string): Promise<void> {
  const id = completeRequestOnSave;
  completeRequestOnSave = null;
  if (id === null) return;
  try {
    await api.updateServiceRequestStatus(id, "completed", note);
    toast("The request is marked complete.", "success");
  } catch (e) {
    toast(e instanceof Error ? `The request is still open: ${e.message}` : "The request is still open.", "warn");
  }
}

/* Add zones to an existing farm, for a "new zone" request. */
function openAddZonesWizard(r: ServiceRequest): void {
  completeRequestOnSave = r.id;
  openDrawer({
    title: `Add a zone to ${r.farmName ?? "the farm"}`,
    subtitle: `For ${r.farmerName}'s request. Saving it completes the request.`,
    wide: true,
    bodyHtml: `
      <label class="f">
        How many zones?
        <input type="number" min="1" max="10" value="1" data-add-zones-count />
      </label>
      <div id="addZonesContainer"></div>`,
    confirmLabel: "Add the zone",
    onOpen: () => {
      const count = document.querySelector<HTMLInputElement>("[data-add-zones-count]");
      const box = document.getElementById("addZonesContainer");
      if (!count || !box) return;
      const render = (): void => {
        const existing = collectFields();
        const n = Math.max(1, Math.min(10, Number(count.value) || 1));
        box.innerHTML = Array.from({ length: n }, (_, i) => zoneRow(i)).join("");
        box.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((el) => {
          const name = el.dataset["field"] ?? "";
          if (existing[name]) el.value = existing[name];
        });
        syncZoneChoices(box);
      };
      count.addEventListener("input", render);
      render();
      wireZoneChoices(box);
      const crop = box.querySelector<HTMLSelectElement>('[data-field="zone_crop_0"]');
      if (crop) crop.value = r.cropType;
      const size = box.querySelector<HTMLInputElement>('[data-field="zone_size_0"]');
      if (size && r.roughSize !== null) size.value = String(r.roughSize);
    },
    onConfirm: () => {
      const v = collectFields();
      const n = document.querySelectorAll("#addZonesContainer [data-zone-row]").length || 1;
      for (let i = 0; i < n; i++) {
        const problem =
          !v[`zone_name_${i}`]?.trim() ? `Give zone ${i + 1} a name.`
          : !v[`zone_crop_${i}`] ? `Choose a crop for zone ${i + 1}.`
          : !v[`zone_area_preset_${i}`] ? `Choose how big zone ${i + 1} is.`
          : zoneSetupProblem(v, i);
        if (problem) {
          toast(problem, "warn");
          return false;
        }
      }
      const zones = Array.from({ length: n }, (_, i) => readZoneSetup(v, i));
      void addZonesToFarm(r.farmId!, zones)
        .then(async (res) => {
          toast(res.message, "success");
          await completeLaunchingRequest(`Completed by adding ${zones.map((z) => z.name).join(", ")}.`);
          void refresh();
        })
        .catch((e: unknown) => {
          completeRequestOnSave = r.id;
          showErrorModal("Could not add the zone", e instanceof Error ? e.message : "Nothing was saved.");
        });
    },
  });
}

/* The zone count, clamped to what the API accepts (1-50). Read from the input because the
 * repeater and the confirm handler both need it. */
function registerFarmZoneCount(): number {
  const input = document.querySelector<HTMLInputElement>("[data-register-farm-zone-count]");
  return Math.max(1, Math.min(50, Number(input?.value) || 1));
}

/* The two rules the per-field validation cannot express. The API checks them too; we check
 * here so the admin sees the answer in the drawer instead of a 400. */
function validateRegisterFarmZones(
  zones: { name: string; sizeHectares: number; cropType: string; areaM2?: number | null }[],
  farmSize: number,
): string | null {
  const total = zones.reduce((sum, z) => sum + z.sizeHectares, 0);

  if (farmSize > 0 && total > farmSize) {
    return `The zones add up to ${hectaresText(total)}, which is more than the farm's ${hectaresText(farmSize)}.`;
  }

  const names = zones.map((z) => z.name.trim().toLowerCase());
  const duplicate = names.find((n, i) => n.length > 0 && names.indexOf(n) !== i);
  if (duplicate) {
    return `Two zones are both called "${duplicate}". Zone names have to differ.`;
  }

  return null;
}

/* The review step, rebuilt every time it is shown, because the admin can go back and change
 * anything. A review showing stale values is worse than none. */
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

    const zones = Array.from({ length: registerFarmZoneCount() }, (_, i) => {
      const z = readZoneSetup(v, i);
      const preset = AREA_PRESETS.find((a) => a.value === v[`zone_area_preset_${i}`]);
      return {
        name: z.name,
        size: v[`zone_size_${i}`]
          ? `${v[`zone_size_${i}`]} ha`
          : z.areaM2 != null
            ? preset && preset.m2 != null ? preset.label : `${z.areaM2} m²`
            : "",
        crop: z.cropType,
        soil: SOILS.find((s) => s.value === z.soilType)?.label ?? z.soilType,
        planted: z.plantingDate ? `about ${v[`zone_weeks_${i}`]} weeks ago` : "Not given",
      };
    });

    const latitude = Number(v["latitude"]);
    const longitude = Number(v["longitude"]);
    const coords = v["latitude"] && v["longitude"] && validCoordinates(latitude, longitude)
      ? `${formatDms(latitude, longitude)} · Decimal: ${formatDecimal(latitude, longitude)}`
      : "Not set";

    pane.innerHTML = `
      ${detailList([
        ["Farmer", esc(ownerName ?? "Not chosen")],
        ["Farm name", esc(v["farmName"] ?? "")],
        ["Nearest locality", esc(v["location"] || "Coordinates supplied")],
        ["Size", v["farmSize"] ? esc(fmtArea(Number(v["farmSize"]))) : ""],
        ["Coordinates", esc(coords)],
        ["Zones", String(zones.length)],
      ])}
      <table class="table review-zones">
        <thead><tr><th>Zone</th><th>Size</th><th>Crop</th><th>Soil</th><th>Planted</th></tr></thead>
        <tbody>
          ${zones
            .map(
              (z) => `<tr>
                <td>${esc(z.name || "(no name)")}</td>
                <td>${z.size ? esc(z.size) : "—"}</td>
                <td>${z.crop ? esc(cropLabel(z.crop)) : "—"}</td>
                <td>${esc(z.soil)}</td>
                <td>${esc(z.planted)}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>`;
  };

  // The wizard has no "step changed" event, so both buttons that reach the review step
  // trigger a rebuild.
  wiz.querySelector("[data-wizard-next]")?.addEventListener("click", () => {
    window.setTimeout(render, 0);
  });
  wiz.querySelector("[data-wizard-back]")?.addEventListener("click", () => {
    window.setTimeout(render, 0);
  });

  render();
}

/* Farm reports, attention, automatic reports */

function liveEsc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function liveVal(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
}

/* The chosen period as dates: the last N days ending today (SAST), or the two date fields
 * when "Choose dates" is picked. */
function livePeriod(): { from: string; to: string } {
  const choice = liveVal("livePeriod");
  if (choice === "custom") return { from: liveVal("liveFrom"), to: liveVal("liveTo") };
  const days = Number(choice) || 7;
  const to = new Date(Date.now() + 2 * 3600_000);
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/* The report path for the current choices, or a reason it cannot be made. */
function farmReportPath(): { path: string; name: string } | { error: string } {
  const farmId = Number(liveVal("liveFarm"));
  const zoneId = Number(liveVal("liveZone"));
  const type = liveVal("liveType") || "water-usage";
  const { from, to } = livePeriod();

  if (!farmId) return { error: "Pick a farm first." };
  if (!from || !to) return { error: "Pick a from and to date." };

  if (type === "moisture") {
    if (!zoneId) return { error: "Soil moisture is one zone at a time - pick a zone." };
    return { path: `moisture?zoneId=${zoneId}&from=${from}&to=${to}`, name: `soil-moisture-${from}-to-${to}` };
  }
  if (type === "schedule") {
    return {
      path: `schedule?farmId=${farmId}${zoneId ? `&zoneId=${zoneId}` : ""}`,
      name: "watering-schedule",
    };
  }
  return {
    path: zoneId
      ? `water-usage?farmId=${farmId}&zoneId=${zoneId}&from=${from}&to=${to}`
      : `water-usage?farmId=${farmId}&from=${from}&to=${to}`,
    name: `water-usage-${from}-to-${to}`,
  };
}

async function farmReportPreview(): Promise<void> {
  const choice = farmReportPath();
  if ("error" in choice) return void toast(choice.error, "info");
  const out = document.getElementById("liveReportResult");
  if (!out) return;
  out.innerHTML = `<div class="muted">Building the report…</div>`;
  try {
    const blob = await fetchReportPdfBlob(choice.path.replace("?", "/pdf?"));
    const url = URL.createObjectURL(blob);
    // The PDF itself, so the preview cannot differ from the download.
    out.innerHTML = `<iframe class="report-preview" title="Report preview" src="${url}"></iframe>`;
  } catch (e) {
    out.innerHTML = "";
    toast(e instanceof Error ? e.message : "The report could not be built.", "info");
  }
}

async function farmReportPdf(): Promise<void> {
  const choice = farmReportPath();
  if ("error" in choice) return void toast(choice.error, "info");
  try {
    await downloadReportPdf(choice.path.replace("?", "/pdf?"), `agroflow-${choice.name}.pdf`);
    toast("PDF downloaded.", "success");
  } catch (e) {
    toast(e instanceof Error ? e.message : "The report could not be built.", "info");
  }
}

/* The water-usage figures as a workbook, the one report with a table people want to chart. */
async function farmReportXlsx(): Promise<void> {
  const farmId = Number(liveVal("liveFarm"));
  const zoneId = Number(liveVal("liveZone"));
  const { from, to } = livePeriod();

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

/* The automatic-reports summary for the chosen farm. */
async function refreshAutoReportsSummary(farmId: number): Promise<void> {
  const host = document.getElementById("autoReportsSummary");
  const edit = document.getElementById("autoReportsEdit");
  if (!host) return;
  if (edit) edit.dataset["id"] = String(farmId);
  try {
    const s = await getReportSchedule(farmId);
    if (Number(liveVal("liveFarm")) !== farmId) return; // a newer choice won
    const when = (iso: string | null | undefined): string => (iso ? fmtDateTimeSast(iso) : "—");
    host.innerHTML = `
      <div class="detail-list">
        <div class="detail-row"><span>Now</span><b>${liveEsc(s.description)}</b></div>
        <div class="detail-row"><span>Last sent</span><b>${liveEsc(when(s.lastSentAt))}</b></div>
        <div class="detail-row"><span>Next send</span><b>${liveEsc(when(s.nextSendAt))}</b></div>
        ${s.turnedOffBy ? `<div class="detail-row"><span>Turned off by</span><b>${liveEsc(s.turnedOffBy)} · ${liveEsc(when(s.turnedOffAt))}</b></div>` : ""}
      </div>`;
  } catch {
    host.textContent = "This farm's automatic reports could not be read.";
  }
}

async function loadReportZones(farmId: number): Promise<void> {
  const zone = document.getElementById("liveZone") as HTMLSelectElement | null;
  if (!zone) return;
  zone.innerHTML = `<option value="">All zones</option>`;
  if (!farmId) return;
  try {
    const zones = await getReportZones(farmId);
    if (Number(liveVal("liveFarm")) !== farmId) return;
    zone.innerHTML = `<option value="">All zones</option>` + zones.map((z) =>
      `<option value="${z.zoneId}">${liveEsc(z.name)}${z.cropType ? " (" + liveEsc(z.cropType) + ")" : ""}</option>`).join("");
  } catch (e) {
    toast(e instanceof Error ? e.message : "Could not load zones.", "info");
  }
}

function wireLiveReports(): void {
  const farm = document.getElementById("liveFarm") as HTMLSelectElement | null;
  const period = document.getElementById("livePeriod") as HTMLSelectElement | null;
  if (!farm || farm.dataset["bound"]) return;
  farm.dataset["bound"] = "1";

  const onFarm = (): void => {
    const id = Number(farm.value);
    if (id) rememberReportFarm(id);
    void loadReportZones(id);
    void refreshAutoReportsSummary(id);
  };
  farm.addEventListener("change", onFarm);
  onFarm(); // the pre-filled farm

  period?.addEventListener("change", () => {
    document.querySelectorAll<HTMLElement>(".live-custom").forEach((el) => {
      el.hidden = period.value !== "custom";
    });
  });
}

/* One "Farms needing attention" line, opened: every farm and zone behind it. */
function openAttentionGroup(key: string): void {
  const group = findAttentionGroup(key);
  if (!group) return;
  openDrawer({
    title: `${group.farms} ${group.label}`,
    subtitle: "From the advice of the last 7 days",
    wide: true,
    bodyHtml: `<div class="drawer-section"><ul class="drawer-list">${group.items.map((i) => `
      <li>
        <b>${liveEsc(i.farm)} · ${liveEsc(i.zone)}</b> - ${liveEsc(i.message)}
        <small class="muted">${liveEsc(fmtDate(i.day))}</small>
      </li>`).join("")}</ul></div>`,
  });
}

/* delegated clicks */

let delegatedBound = false;

/* Elements whose action is still running. A second click on one is dropped, so a
 * double-click on Save, Confirm or Create sends one request. Keyed on the element so two
 * rows' Save buttons stay independent; a WeakSet forgets a re-rendered page's old buttons. */
const busy = new WeakSet<HTMLElement>();

/* One listener for every action in the console, registered once. The innermost [data-act]
 * wins, so an action link inside a clickable card does its own thing. preventDefault matters:
 * most actions are `<a href="#">`, and a hash of "#" would navigate to Home. */
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
      // Synchronous, so the last tab clicked is the one shown. Its network panels ignore late
      // answers (see the settings loaders), so a slow tab cannot paint over a fast one.
      renderSettingsTab(tab.dataset["tab"] ?? "My account");
      return;
    }

    const el = target.closest<HTMLElement>("[data-act]");
    if (!el) return;

    e.preventDefault();

    if (busy.has(el)) return;

    // A newer click replaces any detail panel still loading from an older one; see
    // beginPanelIntent().
    if ((el.dataset["act"] ?? "").startsWith("view-")) beginPanelIntent();

    busy.add(el);
    el.setAttribute("aria-busy", "true");

    void handleAction(el).finally(() => {
      busy.delete(el);
      el.removeAttribute("aria-busy");
    });
  });
}

/* Onboarding launched from an enquiry starts filled in from it. */
let onboardingFromEnquiry: Enquiry | null = null;
/* The current onboarding attempt (AF-01): made at the first submit, kept for every retry, and
 * cleared when it completes or a new farmer is started. */
let onboardingRequestId: string | null = null;
let onboardingPrefilled = false;

function prefillOnboardingFromEnquiry(): void {
  const e = onboardingFromEnquiry;
  if (!e || onboardingPrefilled) return;
  const set = (field: string, value: string | number | null): void => {
    const el = document.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
    if (el && value !== null && value !== "") el.value = String(value);
  };
  if (!document.querySelector('[data-field="fullName"]')) return;
  set("fullName", e.fullName);
  set("email", e.email);
  set("phone", e.phone);
  set("location", [e.town, e.province].filter(Boolean).join(", "));
  set("farmSize", e.farmSizeHa);
  onboardingPrefilled = true;
  toast("Filled in from the enquiry. Finishing onboarding completes it.", "info");
}

/* The Enquiries entry in the sidebar shows how many enquiries need a person: nobody has
 * them yet, or a call-back is due. */
async function refreshEnquiryBadge(): Promise<void> {
  const button = document.querySelector<HTMLElement>('#nav button[data-page="enquiries"]');
  if (!button) return;
  const summary = await getEnquirySummary().catch(() => null);
  const count = (Number(summary?.waiting) || 0) + (Number(summary?.callbacksDue) || 0);
  let badgeEl = button.querySelector<HTMLElement>(".nav-badge");
  if (count <= 0) {
    badgeEl?.remove();
    return;
  }
  if (!badgeEl) {
    badgeEl = document.createElement("span");
    badgeEl.className = "nav-badge";
    button.appendChild(badgeEl);
  }
  badgeEl.textContent = String(count);
  badgeEl.setAttribute("aria-label", `${count} enquir${count === 1 ? "y" : "ies"} need a call`);
}

export function wirePageInteractions(): void {
  // The drawer calls this after it writes its HTML; see lib/drawer.ts.
  window.agroflowBindDrawerPickers = wirePickers;

  // The router calls this after a Settings tab renders.
  onSettingsTabRendered((tab) => {
    if (tab === "My account") void refreshMyTelegramStatus();
  });

  wireFilters();
  wireLiveReports();
  void mountCommunityMap();
 wireOnboardingZones();
  prefillOnboardingFromEnquiry();
  void refreshEnquiryBadge();
  wirePickers();
  wireWizards();

  // [data-go], [data-act] and .tab clicks are handled by one delegated listener on the
  // document (bindDelegatedClicks() below), so buttons rendered later, like a drawer's, work too.
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

/* header */

// main.ts's render() rebuilds the shell (a new #avatarBtn/#avatarMenu) on every sign-in, so
// initHeader() runs again too. This listener is on `document`, which stays, so we bind it
// once and look up the current avatar elements on every click.
let outsideClickBound = false;

export function initHeader(): void {
  initBell();
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

  // Log out (#logoutBtn here and the sidebar's) is wired in main.ts, which decides what shows
  // after it: the landing page.

  updateHeaderIdentity();
}

/**
 * Shows the signed-in admin's real name and initials in the header avatar. Called from
 * initHeader() and again by main.ts whenever auth state changes.
 */
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

/* One action on an alert, a job or a request, sent to the API. The actor is never sent:
 * the API takes it from the login. */
async function runItemAction(kind: HandlingKind, id: string, action: string, note?: string, date?: string): Promise<void> {
  try {
    const r = await itemAction(kind, id, action, note, date);
    toast(r.message, action === "escalate" ? "warn" : "success");
  } catch (e) {
    showErrorModal("Could not save that", e instanceof Error ? e.message : "Nothing was changed.");
  }
  void refresh();
}

/* "You, since 09:49 on 6 Oct" / "Name, since ..." / "Nobody yet". */
function handledLine(item: Handling): string {
  if (!item.handledByName) return `<span class="muted">Nobody yet</span>`;
  const me = getAdminProfile()?.id === item.handledById;
  return `${esc(me ? "You" : item.handledByName)}${item.claimedAt ? `, since ${esc(fmtDateTimeSast(item.claimedAt))}` : ""}`;
}

