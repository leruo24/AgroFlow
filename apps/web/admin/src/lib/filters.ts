/* Filtering: date ranges, presets and per-page filter state.
 * Every filterable page registers a FilterState here; the toolbar writes to it and the
 * page re-renders from it. */

import type { DateRangePreset, FilterState, PageId } from "@/types/models";

export const EMPTY_FILTER: FilterState = {
  search: "", from: "", to: "", preset: "all",
  farm: "All", province: "All", region: "All", eventType: "All",
  administrator: "All", status: "All", priority: "All",
  deviceType: "All", maintenanceState: "All", crop: "All", telegram: "All",
};

/** Filter state per page, so navigating away and back keeps context. */
const state = new Map<PageId, FilterState>();

export function getFilter(page: PageId): FilterState {
  if (!state.has(page)) state.set(page, { ...EMPTY_FILTER });
  return state.get(page)!;
}

export function setFilter(page: PageId, patch: Partial<FilterState>): FilterState {
  const next = { ...getFilter(page), ...patch };
  state.set(page, next);
  return next;
}

export function resetFilter(page: PageId): FilterState {
  const fresh = { ...EMPTY_FILTER };
  state.set(page, fresh);
  return fresh;
}

/* date helpers */

const pad = (n: number): string => String(n).padStart(2, "0");
export const toISO = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "Today" for the demo dataset. Swap for new Date() against a live backend. */
export const today = (): Date => new Date("2026-07-22T09:00:00");

export const PRESET_LABELS: Record<DateRangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  all: "All time",
  custom: "Custom range",
};

/** Resolves a preset into concrete from/to ISO dates. */
export function resolvePreset(preset: DateRangePreset): { from: string; to: string } {
  const now = today();
  const to = toISO(now);

  switch (preset) {
    case "7d":
      return { from: toISO(new Date(now.getTime() - 6 * 86400000)), to };
    case "30d":
      return { from: toISO(new Date(now.getTime() - 29 * 86400000)), to };
    case "90d":
      return { from: toISO(new Date(now.getTime() - 89 * 86400000)), to };
    case "month":
      return { from: toISO(new Date(now.getFullYear(), now.getMonth(), 1)), to };
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return { from: toISO(new Date(now.getFullYear(), q, 1)), to };
    }
    case "year":
      return { from: toISO(new Date(now.getFullYear(), 0, 1)), to };
    case "all":
    case "custom":
    default:
      return { from: "", to: "" };
  }
}

/** True when an ISO date (or "yyyy-mm-dd hh:mm") falls inside the range. */
export function inRange(value: string, from: string, to: string): boolean {
  if (!value) return true;
  const day = value.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** Human-readable summary of the active range, for the toolbar. */
export function rangeLabel(f: FilterState): string {
  if (f.preset !== "custom") return PRESET_LABELS[f.preset];
  if (f.from && f.to) return `${f.from} → ${f.to}`;
  if (f.from) return `From ${f.from}`;
  if (f.to) return `Until ${f.to}`;
  return "Custom range";
}

/* generic filtering */

export interface FieldMap<T> {
  /** Fields concatenated for the free-text search. */
  search?: (row: T) => string;
  date?: (row: T) => string;
  farm?: (row: T) => string;
  province?: (row: T) => string;
  region?: (row: T) => string;
  eventType?: (row: T) => string;
  administrator?: (row: T) => string;
  status?: (row: T) => string;
  priority?: (row: T) => string;
  deviceType?: (row: T) => string;
  maintenanceState?: (row: T) => string;
  crop?: (row: T) => string;
  telegram?: (row: T) => string;
}

const matches = (selected: string, actual: string | undefined): boolean =>
  selected === "All" || selected === "" || (actual ?? "") === selected;

/** Applies the full FilterState to a row set using the supplied field map. */
export function applyFilters<T>(rows: T[], f: FilterState, map: FieldMap<T>): T[] {
  const q = f.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (q && map.search) {
      if (!map.search(row).toLowerCase().includes(q)) return false;
    }
    if (map.date && (f.from || f.to)) {
      if (!inRange(map.date(row), f.from, f.to)) return false;
    }
    if (map.farm && !matches(f.farm, map.farm(row))) return false;
    if (map.province && !matches(f.province, map.province(row))) return false;
    if (map.region && !matches(f.region, map.region(row))) return false;
    if (map.eventType && !matches(f.eventType, map.eventType(row))) return false;
    if (map.administrator && !matches(f.administrator, map.administrator(row))) return false;
    if (map.status && !matches(f.status, map.status(row))) return false;
    if (map.priority && !matches(f.priority, map.priority(row))) return false;
    if (map.deviceType && !matches(f.deviceType, map.deviceType(row))) return false;
    if (map.maintenanceState && !matches(f.maintenanceState, map.maintenanceState(row))) return false;
    if (map.crop && !matches(f.crop, map.crop(row))) return false;
    if (map.telegram && !matches(f.telegram, map.telegram(row))) return false;
    return true;
  });
}

/** Counts how many non-default filters are active (for the badge). */
export function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.search.trim()) n++;
  if (f.preset !== "all") n++;
  for (const key of [
    "farm", "province", "region", "eventType", "administrator",
    "status", "priority", "deviceType", "maintenanceState", "crop", "telegram",
  ] as const) {
    if (f[key] !== "All") n++;
  }
  return n;
}
