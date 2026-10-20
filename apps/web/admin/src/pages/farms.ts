import { api, getShowArchivedFarms, isArchived } from "@/data/api";
import { esc, fmtInt, healthDot, healthTone, fmtPct } from "@/lib/format";
import { getFilter, applyFilters } from "@/lib/filters";
import { PROVINCES, REGIONS } from "@/data/referenceData";
import {
  badge, kpiCard, panel, pageHeader, filterBar, resultCount, meter,
} from "@/ui/components";
import type { Farm } from "@/types/models";
import { Icon } from "@/lib/icons";

function farmCard(f: Farm): string {
  const hf = f.healthFactors;

  return `<article class="farm-card reveal" data-act="view-farm" data-id="${f.id}">
    <div class="farm-card-top">
      <div>
        <h5>${esc(f.name)} ${f.isSimulated ? badge("Simulated", "warn") : ""}</h5>
        <div class="farm-owner">${esc(f.owner)}</div>
      </div>
      <div class="farm-health">${healthDot(f.health)} ${badge(f.health, healthTone(f.health))}</div>
    </div>

    <div class="farm-meta">
      <span class="meta-ico">${Icon.mapPin}${esc(f.province)}</span>
      <span class="meta-ico">${Icon.map}${esc(f.region)}</span>
      <span class="meta-ico">${Icon.ruler}${fmtInt(f.hectares)} ha</span>
    </div>

    <div class="farm-stats">
      <div><b>${fmtInt(f.users)}</b><span>Users</span></div>
      <div><b>${fmtInt(f.devices)}</b><span>Devices</span></div>
      <div><b>${fmtInt(hf.outstandingAlerts)}</b><span>Alerts</span></div>
      <div><b>${fmtInt(hf.openMaintenance)}</b><span>Jobs</span></div>
    </div>

    <div class="farm-conn">
      <span>Connectivity</span>
      ${meter(
        hf.deviceConnectivity,
        hf.deviceConnectivity > 90
          ? "good"
          : hf.deviceConnectivity > 80
            ? "warn"
            : "bad",
      )}
      <b>${fmtPct(hf.deviceConnectivity)}</b>
    </div>

    <div class="farm-card-foot">
      <span class="muted">Last activity ${esc(f.lastActivity)}</span>
      <div class="farm-card-actions">
        ${badge(f.status)}
        ${isArchived(f.status)
          ? `<button
               type="button"
               class="btn ghost sm"
               data-act="restore-farm"
               data-id="${f.id}"
             >
               Restore
             </button>`
          : `<button
               type="button"
               class="btn ghost sm"
               data-act="archive-farm"
               data-id="${f.id}"
             >
               Archive
             </button>`}
        <button
          type="button"
          class="btn danger sm"
          data-act="delete-farm"
          data-id="${f.id}"
        >
          Delete
        </button>
      </div>
    </div>
  </article>`;
}

export async function farmsPage(): Promise<string> {
  const farms = await api.getFarms();
  const f = getFilter("farms");

  const filtered = applyFilters(farms, f, {
    search: (x) => `${x.name} ${x.owner} ${x.province} ${x.region}`,
    date: (x) => x.registered,
    province: (x) => x.province,
    region: (x) => x.region,
    status: (x) => x.status,
  });

  const total = farms.length;
  // Case-insensitive: farm.status has no CHECK constraint, so both 'Active'
  // and 'active' exist in the live data. See migration 0036.
  const active = farms.filter((x) => (x.status ?? "").toLowerCase() === "active").length;
  const inactive = farms.filter((x) => isArchived(x.status)).length;
  const pending = farms.filter((x) => x.status === "Pending Approval").length;
  const recent = farms.filter((x) => x.registered >= "2026-05-01").length;

  return `
  ${pageHeader(
    "Farms",
    "Central overview of every farm registered on the platform.",
    `<button class="btn ghost" data-act="toggle-archived-farms">
       ${getShowArchivedFarms() ? "Hide archived" : "Show archived"}
     </button>
     <button class="btn" data-act="add-farm">+ Register Farm</button>`,
  )}

  <div class="grid kpis five">
    ${kpiCard({ label: "Total Farms", value: total, icon: Icon.tractor, why: { counts: "farms are listed", rule: "Every farm in the list. Archived farms are left out unless \"Show archived\" is on.", query: "farm (archived = status Inactive, hidden by default)" } })}
    ${kpiCard({
      label: "New Farms",
      value: recent,
      trend: { dir: "up", text: "since 1 May" },
      icon: Icon.sparkles,
      why: { counts: "farms were registered on or after 1 May 2026", rule: "Farms whose registration date is 1 May 2026 or later. The date is fixed, not a rolling window.", query: "farm.registered >= 2026-05-01" },
    })}
    ${kpiCard({ label: "Active Farms", value: active, icon: Icon.circleCheck, why: { counts: "farms are active", rule: "Farms whose status is Active.", query: "farm.status = Active" } })}
    ${kpiCard({ label: "Inactive Farms", value: inactive, icon: Icon.moon, why: { counts: "farms are inactive", rule: "Farms whose status is Inactive - which is also how an archived farm is marked.", query: "farm.status = Inactive" } })}
    ${kpiCard({
      label: "Pending Approval",
      value: pending,
      icon: Icon.hourglass,
      why: { counts: "farms are waiting for approval", rule: "Farms whose status is Pending Approval.", highlighted: "A farmer is waiting for these to be approved.", query: "farm.status = Pending Approval" },
    })}
  </div>

  ${filterBar({
    page: "farms",
    filter: f,
    showDateRange: true,
    searchPlaceholder: "Search by farm name, owner or provinceâ€¦",
    selects: [
      { key: "province", label: "Province", options: [...PROVINCES] },
      { key: "region", label: "Region", options: [...REGIONS] },
      {
        key: "status",
        label: "Status",
        options: ["Active", "Inactive", "Pending Approval"],
      },
    ],
    rightHtml: `<button class="btn ghost sm" data-act="export-farms">Export CSV</button>`,
  })}

  ${panel(
    "Farm Directory",
    "Health status is derived from connectivity, maintenance, alerts, gateway state and sensor availability",
    resultCount(filtered.length, total, "farms"),
    filtered.length
      ? `<div class="farm-grid">${filtered.map(farmCard).join("")}</div>`
      : `<div class="empty-state">No farms match the current filters.</div>`,
  )}
  `;
}
