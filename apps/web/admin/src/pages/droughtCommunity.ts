/* Drought & community (docs/drought-community.md). Staff see everything here; farmers see
 * their own part in the app and, when linked, on Telegram (staff never get Telegram).
 *   - Farms in drought mode: why, since when, and On / Off / Automatic for each.
 *   - Farmers who said their farm's saved place is wrong (from the app's setup wizard):
 *     fix the location, then close the notice.
 *   - Community reports: a list and a map of the rounded points (about 1 km), with the
 *     reporter's name for staff only, how many of that farmer's reports were hidden, and
 *     Hide with a reason (audited; a hidden report stops notifying).
 *   - The thresholds and radii, each with where its number comes from. */

import {
  getCommunityReports, getDroughtCommunitySettings, getDroughtFarms, getStaffNotices,
  type AppSetting, type CommunityReportAdmin, type DroughtFarm, type StaffNotice,
} from "@/services/agroFlowApi";
import { badge, pageHeader, panel, table } from "@/ui/components";
import { withErrorState } from "@/ui/patterns";
import { esc, fmtDateTimeSast } from "@/lib/format";
import { loadLeaflet } from "@/lib/map";

/* A farmer with this many hidden reports is flagged as a possible repeat false reporter. */
export const REPEAT_HIDDEN = 2;

const CATEGORY_LABEL: Record<string, string> = {
  pest: "Pests", disease: "Crop disease", fire: "Fire", water: "Water problem", weather: "Bad weather",
};
const CATEGORY_COLOUR: Record<string, string> = {
  pest: "#8a6d1f", disease: "#7a4c8c", fire: "#c0392b", water: "#1f6f8b", weather: "#4a5a6a",
};

let lastReports: CommunityReportAdmin[] = [];

export function droughtCommunityPage(): Promise<string> {
  return withErrorState("Drought & community", render);
}

async function render(): Promise<string> {
  const [farms, notices, reports, settings] = await Promise.all([
    getDroughtFarms().catch(() => [] as DroughtFarm[]),
    getStaffNotices().catch(() => [] as StaffNotice[]),
    getCommunityReports().catch(() => [] as CommunityReportAdmin[]),
    getDroughtCommunitySettings().catch(() => [] as AppSetting[]),
  ]);
  lastReports = reports;
  const active = reports.filter((r) => r.status === "active");
  return `<div class="dc-page">
  ${pageHeader("Drought & community", "Farms in drought mode, farmers' location problems, and community reports to moderate.")}
  ${panel("Farms in drought mode", `${farms.length} now. AgroFlow does not predict droughts or declare them; this is each farm's own tank, soil and forecast.`, "",
    table(["Farm", "Since", "Why", "Set by", "Change"], farms, (f) => [
      `<a href="#" data-act="view-farm" data-id="${f.farmId}">${esc(f.name)}</a> ${f.isSimulated ? badge("Simulated", "warn") : ""}`,
      f.since ? esc(fmtDateTimeSast(f.since)) : "-",
      `<span class="muted">${esc(f.reason ?? "")}</span>`,
      f.override ? badge(`By hand: ${f.override}`, "info") : badge("Automatic", "good"),
      (["auto", "on", "off"] as const).map((m) =>
        `<button class="btn ghost sm" data-act="drought-mode" data-id="${f.farmId}" data-mode="${m}"${(f.override ?? "auto") === m ? " aria-pressed=\"true\"" : ""}>${m === "auto" ? "Automatic" : m === "on" ? "On" : "Off"}</button>`).join(" "),
    ], "No farm is in drought mode."))}
  <div id="staff-notices">
  ${panel("Location problems from farmers", "A farmer said the saved place of their farm is wrong. Check it with them, fix it, then close the notice.", "",
    table(["Farm", "Farmer", "When", "What they said", ""], notices, (n) => [
      esc(n.farmName || "-"), esc(n.farmerName || "-"), esc(fmtDateTimeSast(n.createdAt)), esc(n.message),
      `${n.farmId ? `<button class="btn ghost sm" data-act="edit-farm-location" data-id="${n.farmId}">Fix the location</button> ` : ""}<button class="btn sm" data-act="resolve-notice" data-id="${n.id}">Close</button>`,
    ], "No location problems reported."))}
  </div>
  ${panel("Community reports", `${active.length} active of ${reports.length} in the last records. Points are rounded to about 1 km; farmers never see who reported.`, "",
    `<div class="map-pick-canvas community-map" data-community-map role="img" aria-label="Map of active community reports, each with its alert radius"></div>
     <p class="muted" data-community-map-status hidden></p>
     ${table(["When", "What", "Severity", "Status", "Place", "Reporter (staff only)", "Seen too", "Farms told", ""], reports, (r) => [
       esc(fmtDateTimeSast(r.createdAt)),
       `<b>${esc(r.label)}</b><br><span class="muted">${esc(CATEGORY_LABEL[r.category] ?? r.category)}${r.fireState ? ` · ${esc(r.fireState.replace("_", " "))}` : ""}${r.description ? ` · “${esc(r.description)}”` : ""}</span>`,
       badge(r.severity, r.severity === "high" ? "bad" : r.severity === "moderate" ? "warn" : "info"),
       r.status === "hidden" ? `${badge("Hidden", "bad")}<br><span class="muted">${esc(r.hiddenReason ?? "")}</span>` : badge(r.status, r.status === "active" ? "good" : "info"),
       `${r.latitude.toFixed(2)}, ${r.longitude.toFixed(2)}<br><span class="muted">${r.radiusKm} km${r.escalated ? " (widened)" : ""}</span>`,
       `${esc(r.reporterName || "-")}<br><span class="muted">${esc(r.reporterEmail)} · ${esc(r.farmName)}</span>${
         r.reporterHiddenCount >= REPEAT_HIDDEN
           ? `<br>${badge(`${r.reporterHiddenCount} of ${r.reporterTotal} hidden`, "bad")}`
           : r.reporterHiddenCount > 0 ? `<br><span class="muted">${r.reporterHiddenCount} of ${r.reporterTotal} hidden</span>` : ""}`,
       String(r.confirmations),
       String(r.notifiedFarms),
       r.status === "active" ? `<button class="btn ghost sm" data-act="hide-report" data-id="${r.id}">Hide</button>` : "",
     ], "No community reports yet.")}`)}
  ${panel("Drought and community settings", "Each number with where it comes from. Changes are recorded in Activity.", `<button class="btn" data-act="save-dc-settings">Save settings</button>`,
    settingsHtml(settings))}
  </div>`;
}

function settingsHtml(settings: AppSetting[]): string {
  if (!settings.length) return `<div class="empty-state">The settings are not set up yet (migration 0054).</div>`;
  const groups: { title: string; prefix: string }[] = [
    { title: "Drought mode", prefix: "drought." },
    { title: "Community reports", prefix: "community." },
    { title: "Fire", prefix: "fire." },
  ];
  return groups.map((g) => {
    const rows = settings.filter((s) => s.key.startsWith(g.prefix));
    if (!rows.length) return "";
    return `<h5 class="settings-group">${esc(g.title)}</h5><div class="fields dc-settings">${rows.map((s) => `
      <label class="f">${esc(s.description)}
        <input type="${typeof s.value === "number" ? "number" : "text"}" step="any" data-setting="${esc(s.key)}"
          data-kind="${typeof s.value}" value="${esc(String(s.value))}" />
        <small class="muted">${esc(s.key)} · ${esc(s.source)}</small>
      </label>`).join("")}</div>`;
  }).join("");
}

/* The settings form's changes, typed as the saved values are. */
export function changedSettings(root: ParentNode): { key: string; value: number | string }[] | string {
  const out: { key: string; value: number | string }[] = [];
  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>("[data-setting]"))) {
    const key = input.dataset["setting"] ?? "";
    const raw = input.value.trim();
    if (raw === input.defaultValue.trim()) continue;
    if (input.dataset["kind"] === "number") {
      const n = Number(raw.replace(",", "."));
      if (!raw || !Number.isFinite(n)) return `${key} must be a number.`;
      out.push({ key, value: n });
    } else {
      if (!raw) return `${key} cannot be empty.`;
      out.push({ key, value: raw });
    }
  }
  return out;
}

type LeafletLayer = { addTo(map: unknown): LeafletLayer; bindTooltip?(text: string): LeafletLayer };
type LeafletWithShapes = {
  map(el: HTMLElement, options?: Record<string, unknown>): { setView(c: [number, number], z: number): unknown; remove(): void; invalidateSize(): void };
  tileLayer(url: string, options?: Record<string, unknown>): { addTo(map: unknown): unknown };
  circle?(c: [number, number], options: Record<string, unknown>): LeafletLayer;
  circleMarker?(c: [number, number], options: Record<string, unknown>): LeafletLayer;
};

/* The map of active reports: each rounded point, and its alert radius as a circle. */
export async function mountCommunityMap(): Promise<void> {
  const el = document.querySelector<HTMLElement>("[data-community-map]");
  if (!el || el.dataset["mounted"]) return;
  el.dataset["mounted"] = "1";
  const status = document.querySelector<HTMLElement>("[data-community-map-status]");
  const active = lastReports.filter((r) => r.status === "active");
  try {
    const L = (await loadLeaflet()) as unknown as LeafletWithShapes;
    const map = L.map(el, { scrollWheelZoom: false });
    const centre: [number, number] = active.length
      ? [active.reduce((s, r) => s + r.latitude, 0) / active.length, active.reduce((s, r) => s + r.longitude, 0) / active.length]
      : [-28.5, 24.7];
    map.setView(centre, active.length ? 8 : 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    for (const r of active) {
      const colour = CATEGORY_COLOUR[r.category] ?? "#333";
      L.circle?.([r.latitude, r.longitude], { radius: r.radiusKm * 1000, color: colour, weight: 1, fillOpacity: 0.08 }).addTo(map);
      const dot = L.circleMarker?.([r.latitude, r.longitude], { radius: 7, color: colour, fillColor: colour, fillOpacity: 0.9 });
      dot?.bindTooltip?.(`${r.label} (${r.severity}), ${r.radiusKm} km`);
      dot?.addTo(map);
    }
    window.setTimeout(() => map.invalidateSize(), 60);
  } catch (error) {
    el.hidden = true;
    if (status) {
      status.hidden = false;
      status.textContent = error instanceof Error ? error.message : "The map could not be loaded; the list below has every report.";
    }
  }
}
