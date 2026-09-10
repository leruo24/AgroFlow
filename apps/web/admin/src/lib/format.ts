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

export const fmtLitres = (n: number | null | undefined): string => {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} ML`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)} kL`;
  return `${Math.round(v)} L`;
};

export const fmtDate = (iso: string): string => (iso ? iso.slice(0, 10) : "—");

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

export const healthDot = (health: string): string =>
  health === "Healthy" ? "🟢" : health === "Attention Required" ? "🟡" : "🔴";
