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

// Every water volume in AgroFlow is INFERRED from pump runtime and the zone's
// configured flow_rate_lpm - there is no flow meter on any node. The "(est.)"
// suffix is applied here, in the one formatter every caller goes through,
// rather than at each call site, so a new table or card cannot accidentally
// present an inferred number as a measured one.
//
// null/undefined is a genuinely absent estimate (a zone with no flow rate
// configured, which the API stores as NULL) and renders as an em dash, not as
// "0 L" - zero would claim the cycle delivered no water, which is a different
// and false statement.
export const fmtLitres = (n: number | null | undefined): string => {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} ML (est.)`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)} kL (est.)`;
  return `${Math.round(v)} L (est.)`;
};

export const fmtDate = (iso: string): string => (iso ? iso.slice(0, 10) : "—");

/* ONE date format for the whole console, in SAST.
 *
 * Pages were showing three different things: a raw ISO string
 * ("2026-10-03T14:05:22.481Z"), a bare yyyy-mm-dd, and whatever
 * toLocaleString() produced on that admin's machine. An admin comparing an
 * alert's time against a request's time could not tell whether they were in
 * the same timezone, let alone the same minute.
 *
 * South Africa has no daylight saving, so a fixed +2 offset is exact and
 * needs no timezone database - the same choice the API and the FAO-56 engine
 * already make. The offset is applied explicitly rather than relying on the
 * browser's locale, so the console reads the same on a laptop set to UTC. */
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
  if (health === "Attention Required") return "warn";
  return "bad";
}

// Reuses the dot-r/dot-good/dot-bad pattern already established for the
// system-health panel (dashboard.ts) instead of an emoji or a new icon -
// a plain status dot has no real "icon" to derive from lucide anyway.
export const healthDot = (health: string): string => {
  const tone = health === "Healthy" ? "good" : health === "Attention Required" ? "warn" : "bad";
  return `<span class="dot-r dot-${tone}"></span>`;
};
