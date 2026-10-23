/* Formatting, escaping and tone mapping. */

import type { BadgeTone, TrendDirection } from "@/types/models";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

export const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (m) => HTML_ESCAPES[m] ?? m);

export const fmtInt = (n: number | null | undefined): string =>
  Math.round(Number(n ?? 0)).toLocaleString("en-ZA");

export const fmtPct = (n: number | null | undefined): string =>
  `${Number(n ?? 0).toFixed(1)}%`;

export const fmtPct2 = (n: number | null | undefined): string =>
  `${Number(n ?? 0).toFixed(2)}%`;

// Every water volume is estimated from pump runtime and the zone's flow_rate_lpm; no node
// has a flow meter. We add "(est.)" here, in the one formatter everything uses, so no table
// can show an estimate as a measurement. null means no estimate (no flow rate) and shows an
// em dash, not "0 L", which would claim the cycle delivered no water.
export const fmtLitres = (n: number | null | undefined): string => {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} ML (est.)`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)} kL (est.)`;
  return `${Math.round(v)} L (est.)`;
};

/* Formats through the SAST formatter below, so every date in the console agrees (a UTC
 * slice would date anything between midnight and 02:00 SAST to the day before). A plain
 * "yyyy-mm-dd" comes back as the same day. */
export const fmtDate = (iso: string | null | undefined): string => fmtDateSast(iso);

/* One date format for the whole console, in SAST, so times on different pages can be
 * compared. South Africa has no daylight saving, so a fixed +2 offset is exact and needs no
 * timezone database, the same as the API and the FAO-56 engine. We apply it ourselves
 * instead of using the browser's locale, so it reads the same on a laptop set to UTC. */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "03 Oct 2026, 16:05" — the console's only datetime format. */
export function fmtDateTimeSast(iso: string | null | undefined): string {
  if (!iso) return "—";

  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";

  const d = new Date(t + SAST_OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, "0");

  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "03 Oct 2026" — the same format with the time dropped. */
export function fmtDateSast(iso: string | null | undefined): string {
  const full = fmtDateTimeSast(iso);
  return full === "—" ? full : full.split(",")[0] ?? full;
}

/** "4 minutes ago" / "2 days ago". For "last seen" columns, where the gap
    matters more than the wall-clock time. */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "never";

  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";

  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;

  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export const trendClass = (dir: TrendDirection): string => (dir === "up" ? "up" : "down");

/** Maps a status / priority / health string onto a badge tone. */
export function badgeTone(text: string): BadgeTone {
  const v = text.toLowerCase();
  if (/healthy|active|online|operational|resolved|closed|completed|ok|success|enabled/.test(v)) return "good";
  if (/attention|degraded|due|pending|assigned|waiting|scheduled|upcoming|medium|in progress/.test(v)) return "warn";
  if (/critical|offline|fault|overdue|failed|disabled|escalated|high|inactive/.test(v)) return "bad";
  if (/new|low|info/.test(v)) return "info";
  return "neutral";
}

/** Farm health gets its own explicit mapping (traffic-light semantics). */
export function healthTone(health: string): BadgeTone {
  if (health === "Healthy") return "good";
  // AF-09: waiting for a first installation is normal, not a fault.
  if (health === "Awaiting installation") return "info";
  if (health === "Attention Required") return "warn";
  return "bad";
}

// Uses the dot-r/dot-good/dot-bad style from the system-health panel (dashboard.ts)
// instead of an emoji or a new icon.
export const healthDot = (health: string): string => {
  const tone = health === "Healthy" ? "good" : health === "Attention Required" ? "warn" : health === "Awaiting installation" ? "info" : "bad";
  return `<span class="dot-r dot-${tone}"></span>`;
};

/* One way to write an area (AF-07), the same as the API's AreaFormat and the app's formatArea:
 * hectares to the precision the value needs, never "0 ha" for a real small farm, and square
 * metres beside it under a hectare: "0.02 ha (200 m²)". Cases: docs/audit/fixtures/area-cases.json.
 * No area at all shows "Not set", never "0 ha". */
export function hectaresText(ha: number): string {
  if (!Number.isFinite(ha) || ha <= 0) return "0 ha";
  const decimals = ha >= 0.01 ? 2 : ha >= 0.001 ? 3 : 4;
  const factor = 10 ** decimals;
  let rounded = Math.round(ha * factor + Number.EPSILON) / factor;
  if (rounded <= 0) rounded = 1 / factor;
  return `${Number(rounded.toFixed(decimals))} ha`;
}

function squareMetresText(m2: number): string {
  const rounded = m2 < 10 ? Math.round(m2 * 10) / 10 : Math.round(m2);
  const [whole, fraction] = String(rounded).split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${fraction ? `.${fraction}` : ""} m²`;
}

export function formatArea(hectares: number | null | undefined): string | null {
  if (hectares == null || !Number.isFinite(Number(hectares)) || Number(hectares) <= 0) return null;
  const ha = Number(hectares);
  return ha < 1 ? `${hectaresText(ha)} (${squareMetresText(ha * 10_000)})` : hectaresText(ha);
}

export const fmtArea = (hectares: number | null | undefined): string => formatArea(hectares) ?? "Not set";

/* A request's rough size with its qualification (AF-19): never a bare number. */
export function roughSizeText(hectares: number | null, unit: string | null | undefined): string {
  if (unit === "unknown") return "Not known: help the farmer measure at the visit";
  if (hectares == null) return "Not stated";
  const area = formatArea(hectares) ?? "Not stated";
  return unit === "unstated" ? `${area} (the farmer gave no unit; confirm at the visit)` : area;
}
