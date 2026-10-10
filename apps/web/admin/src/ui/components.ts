/* Reusable render helpers. Each returns an HTML string.
 * Animation hooks are data-* attributes and .reveal classes, which lib/animate.ts picks up
 * after the content is inserted. */

import { whyLink, countExplanation } from "@/lib/why";
import { esc, fmtInt, badgeTone, trendClass } from "@/lib/format";
import { PRESET_LABELS, activeFilterCount, rangeLabel } from "@/lib/filters";
import { Icon } from "@/lib/icons";
import type {
  BadgeTone, Trend, SeriesPoint, StatusDistribution, PageId,
  FilterState, DateRangePreset,
} from "@/types/models";

/* badges */

export function badge(text: string, tone?: BadgeTone): string {
  return `<span class="badge ${tone ?? badgeTone(text)}">${esc(text)}</span>`;
}

/* KPIs */

export type CountFormat = "int" | "pct" | "pct2" | "litres" | "ratio";

export interface KpiOptions {
  label: string;
  value: number;
  format?: CountFormat;
  total?: string;
  trend?: Trend;
  icon?: string;
  /* A data-act value. When set, the tile becomes a button that opens the list it counts. */
  act?: string;
  actId?: string;
  /* "Why am I seeing this?": what the number counts and why it is highlighted. Written next
   * to the tile, from the same filter that makes the number, so they always match. */
  why?: KpiWhy;
}

export type KpiWhy = {
  /* "farms whose status is Active" - completes "N ..." */
  counts: string;
  /* The rule in plain words. */
  rule: string;
  /* Where the number comes from, for admins: table, filter. */
  query: string;
  /* Why it is on the page at all. */
  highlighted?: string;
  /* What makes it go up or down. */
  clears?: string;
};

export function kpiCard(opts: KpiOptions): string {
  const fmt = opts.format ?? "int";
  const totalAttr = opts.total ? ` data-countup-total="${esc(opts.total)}"` : "";
  const trend = opts.trend
    ? `<div class="trend ${trendClass(opts.trend.dir)}">
         <span class="trend-arrow">${opts.trend.dir === "up" ? "↑" : "↓"}</span> ${esc(opts.trend.text)}
       </div>`
    : "";
  const inner = `
    <div class="label">${opts.icon ? `<span class="kpi-ico">${opts.icon}</span>` : ""}${esc(opts.label)}</div>
    <div class="value" data-countup="${opts.value}" data-countup-format="${fmt}"${totalAttr}>0</div>
    ${trend}`;

  // A real <button> when clickable, so it can be reached by keyboard and is announced as
  // an action.
  const tile = opts.act
    ? `<button type="button" class="card reveal card-clickable" data-act="${esc(opts.act)}"${
        opts.actId ? ` data-id="${esc(opts.actId)}"` : ""
      }>${inner}</button>`
    : `<div class="card reveal">${inner}</div>`;

  if (!opts.why) return tile;

  // The link sits beside the tile, never inside it: a button inside a button is invalid.
  const why = whyLink(countExplanation({
    label: opts.label,
    what: opts.why.counts,
    count: opts.value,
    counted: opts.label,
    rule: opts.why.rule,
    whyHighlighted: opts.why.highlighted ?? "",
    clears: opts.why.clears ?? "The number updates the next time this page loads.",
    query: opts.why.query,
  }));
  return `<div class="kpi-item">${tile}${why}</div>`;
}

/* panels */

export function panel(title: string, subtitle = "", rightHtml = "", bodyHtml = ""): string {
  return `<section class="panel reveal">
    <div class="panel-head">
      <div>
        <h4>${esc(title)}</h4>
        ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}
      </div>
      <div class="panel-actions">${rightHtml}</div>
    </div>
    ${bodyHtml}
  </section>`;
}

export function pageHeader(title: string, subtitle: string, actionHtml = ""): string {
  return `<div class="page-head reveal">
    <div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div>
    <div class="page-actions">${actionHtml}</div>
  </div>`;
}

export function routeLink(pageId: PageId, label: string): string {
  return `<a href="#${esc(pageId)}" class="link" data-go="${esc(pageId)}">${esc(label)}</a>`;
}

/* charts */

export function barChart(data: SeriesPoint[], unit = ""): string {
  const max = Math.max(...data.map((d) => d.value), 1);
  return `<div class="bars">${data
    .map((d) => {
      const h = Math.max(6, Math.round((d.value / max) * 100));
      return `<div class="bar" data-h="${h}" style="height:0%" title="${esc(d.label)}: ${fmtInt(d.value)}${esc(unit)}">
        <span class="y">${fmtInt(d.value)}</span>
        <span class="x">${esc(d.label)}</span>
      </div>`;
    })
    .join("")}</div>`;
}

/** Smooth line chart with an area fill; good for trends over time. */
export function lineChart(data: SeriesPoint[], color = "#22c55e"): string {
  if (data.length === 0) return `<div class="empty-state">No data in this range.</div>`;
  const w = 560, h = 170, padX = 8, padY = 14;
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const span = max - min || 1;
  const step = data.length > 1 ? (w - padX * 2) / (data.length - 1) : 0;

  const pts = data.map((d, i) => {
    const x = padX + i * step;
    const y = padY + (h - padY * 2) * (1 - (d.value - min) / span);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const line = pts.join(" ");
  const area = `${padX},${h - padY} ${line} ${(padX + (data.length - 1) * step).toFixed(1)},${h - padY}`;

  const dots = data.map((d, i) => {
    const x = padX + i * step;
    const y = padY + (h - padY * 2) * (1 - (d.value - min) / span);
    return `<circle class="lc-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3">
      <title>${esc(d.label)}: ${fmtInt(d.value)}</title></circle>`;
  }).join("");

  const labelEvery = Math.ceil(data.length / 8);
  const labels = data.map((d, i) => {
    if (i % labelEvery !== 0 && i !== data.length - 1) return "";
    const x = padX + i * step;
    return `<text class="lc-label" x="${x.toFixed(1)}" y="${h - 2}" text-anchor="middle">${esc(d.label)}</text>`;
  }).join("");

  return `<div class="linechart">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Trend chart">
      <polygon class="lc-area" points="${area}" fill="${color}" opacity="0.14"></polygon>
      <polyline class="lc-line" points="${line}" fill="none" stroke="${color}" stroke-width="2.5"
        stroke-linejoin="round" stroke-linecap="round"></polyline>
      <g fill="${color}">${dots}</g>
      ${labels}
    </svg>
  </div>`;
}

export function donut(
  dist: StatusDistribution,
  colors: string[] = ["#22c55e", "#f59e0b", "#ef4444", "#94a3b8"],
): string {
  const entries = Object.entries(dist);
  const total = entries.reduce((a, [, v]) => a + Number(v), 0) || 1;
  const cx = 58, cy = 58, r = 42;
  const circumference = 2 * Math.PI * r;

  let acc = 0;
  const arcs = entries.map(([, v], i) => {
    const len = circumference * (Number(v) / total);
    const rest = circumference - len;
    const rot = (acc / total) * 360 - 90;
    acc += Number(v);
    const color = colors[i % colors.length] ?? "#22c55e";
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="16"
      stroke-dasharray="${len.toFixed(2)} ${rest.toFixed(2)}" data-len="${len.toFixed(2)}"
      style="stroke-dashoffset:${len.toFixed(2)}"
      transform="rotate(${rot.toFixed(2)} ${cx} ${cy})"></circle>`;
  }).join("");

  const legend = entries.map(([k, v], i) => {
    const color = colors[i % colors.length] ?? "#22c55e";
    return `<div class="legend-row">
      <span class="dot-r" style="background:${color}"></span>${esc(k)}<b>${fmtInt(v)}</b>
    </div>`;
  }).join("");

  return `<div class="don-wrap">
    <svg width="116" height="116" viewBox="0 0 116 116" role="img" aria-label="Distribution">
      ${arcs}
      <circle cx="58" cy="58" r="27" class="donut-hole"></circle>
      <text x="58" y="61" text-anchor="middle" class="donut-total">${fmtInt(total)}</text>
    </svg>
    <div class="legend">${legend}</div>
  </div>`;
}

/* tables */

export function table<T>(
  cols: string[],
  rows: T[],
  cellRenderer: (row: T, index: number) => string[],
  emptyMessage = "No records match the current filters.",
): string {
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows.length
    ? rows.map((row, i) =>
        `<tr class="reveal-row" style="animation-delay:${Math.min(i, 14) * 30}ms">${
          cellRenderer(row, i).map((c) => `<td>${c}</td>`).join("")
        }</tr>`).join("")
    : `<tr><td colspan="${cols.length}"><div class="empty-state">${esc(emptyMessage)}</div></td></tr>`;
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Row count summary shown above filtered tables. */
export function resultCount(shown: number, total: number, noun = "records"): string {
  return `<div class="result-count">Showing <b>${fmtInt(shown)}</b> of ${fmtInt(total)} ${esc(noun)}</div>`;
}

/* filter toolbar */

export interface SelectFilter {
  /** Must match a key on FilterState. */
  key: keyof FilterState;
  label: string;
  options: string[];
}

export interface FilterBarOptions {
  page: PageId;
  filter: FilterState;
  searchPlaceholder?: string;
  /** Show the date range control. */
  showDateRange?: boolean;
  selects?: SelectFilter[];
  /** Extra buttons rendered on the right (export etc). */
  rightHtml?: string;
}

const PRESET_ORDER: DateRangePreset[] = ["7d", "30d", "90d", "month", "quarter", "year", "all", "custom"];

export function filterBar(opts: FilterBarOptions): string {
  const f = opts.filter;
  const count = activeFilterCount(f);

  const search = `<div class="filter-field grow">
    <label>Search</label>
    <input type="text" data-filter-key="search" value="${esc(f.search)}"
      placeholder="${esc(opts.searchPlaceholder ?? "Search…")}" />
  </div>`;

  const dateRange = opts.showDateRange
    ? `<div class="filter-field">
        <label>Date range</label>
        <select data-filter-key="preset">
          ${PRESET_ORDER.map((p) =>
            `<option value="${p}"${f.preset === p ? " selected" : ""}>${esc(PRESET_LABELS[p])}</option>`).join("")}
        </select>
      </div>
      <div class="filter-field date-custom${f.preset === "custom" ? " show" : ""}">
        <label>From</label>
        <input type="date" data-filter-key="from" value="${esc(f.from)}" />
      </div>
      <div class="filter-field date-custom${f.preset === "custom" ? " show" : ""}">
        <label>To</label>
        <input type="date" data-filter-key="to" value="${esc(f.to)}" />
      </div>`
    : "";

  const selects = (opts.selects ?? []).map((s) => {
    const current = String(f[s.key] ?? "All");
    return `<div class="filter-field">
      <label>${esc(s.label)}</label>
      <select data-filter-key="${esc(String(s.key))}">
        ${["All", ...s.options].map((o) =>
          `<option value="${esc(o)}"${current === o ? " selected" : ""}>${esc(o)}</option>`).join("")}
      </select>
    </div>`;
  }).join("");

  return `<section class="filter-bar reveal">
    <div class="filter-grid">
      ${search}
      ${dateRange}
      ${selects}
    </div>
    <div class="filter-foot">
      <div class="filter-summary">
        ${opts.showDateRange ? `<span class="range-chip">${Icon.calendar}${esc(rangeLabel(f))}</span>` : ""}
        ${count > 0 ? `<span class="filter-count">${count} filter${count === 1 ? "" : "s"} active</span>` : ""}
      </div>
      <div class="filter-buttons">
        ${count > 0 ? `<button class="btn ghost sm" data-act="clear-filters">Clear filters</button>` : ""}
        ${opts.rightHtml ?? ""}
      </div>
    </div>
  </section>`;
}

/* skeleton */

export function skeletonPage(): string {
  return `<div class="skeleton-wrap">
    <div class="sk sk-head"></div>
    <div class="sk-grid">
      ${Array.from({ length: 6 }, () => `<div class="sk sk-card"></div>`).join("")}
    </div>
    <div class="sk sk-bar"></div>
    <div class="sk sk-panel"></div>
  </div>`;
}

/* small bits */

export function meter(pct: number, tone = "good"): string {
  return `<div class="meter meter-${esc(tone)}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
}
