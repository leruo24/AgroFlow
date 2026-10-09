/* Dismiss and history for the console's notifications: Home's "Needs attention" cards,
 * the Alerts list and the health warnings.
 * A dismissal hides an item and never deletes it; who and when come from the login on the
 * server. History shows when each item was raised and dismissed, by whom, the note, and
 * Restore. A critical item asks for an optional note and comes back if its condition
 * happens again (its condition key changes). */

import { esc, fmtDateTimeSast } from "@/lib/format";

export type DismissKind = "alert" | "attention" | "health";
export type DismissView = "active" | "dismissed" | "all";

export type Dismissal = {
  id: number;
  audience: "admin" | "farmer";
  kind: string;
  itemKey: string;
  farmId: number | null;
  title: string;
  raisedAt: string | null;
  critical: boolean;
  conditionKey: string | null;
  dismissedByName: string;
  dismissedAt: string;
  note: string | null;
  restoredByName: string | null;
  restoredAt: string | null;
};

const views: Record<string, DismissView> = {};
export const viewOf = (surface: string): DismissView => views[surface] ?? "active";
export const setView = (surface: string, view: string): void => {
  views[surface] = view === "dismissed" || view === "all" ? view : "active";
};

/** The live dismissal that hides this item, if any. A critical item is only
    hidden while its condition is the same one that was dismissed. */
export function hiddenBy(
  list: Dismissal[], kind: DismissKind, key: string, critical: boolean, conditionKey?: string | null,
): Dismissal | undefined {
  return list.find((d) =>
    d.kind === kind && d.itemKey === key && !d.restoredAt &&
    (!critical || !d.critical || (d.conditionKey ?? "") === (conditionKey ?? "")));
}

/** Critical dismissals whose condition is no longer there - the card is gone
    or its condition changed. Closing them means a recurrence shows again.
    `current` maps item key -> condition key for what is showing right now. */
export function clearedConditions(list: Dismissal[], kind: DismissKind, current: Map<string, string>): Dismissal[] {
  return list.filter((d) => d.kind === kind && d.critical && !d.restoredAt
    && current.get(d.itemKey) !== (d.conditionKey ?? ""));
}

export function dismissButton(opts: {
  kind: DismissKind; key: string; title: string; raisedAt?: string | null; critical?: boolean; conditionKey?: string | null;
}): string {
  return `<button type="button" class="dismiss-x" aria-label="Dismiss: ${esc(opts.title)}" title="Dismiss"
    data-act="dismiss-item" data-kind="${opts.kind}" data-key="${esc(opts.key)}" data-title="${esc(opts.title)}"
    data-raised="${esc(opts.raisedAt ?? "")}" data-critical="${opts.critical ? "1" : ""}"
    data-condition="${esc(opts.conditionKey ?? "")}">×</button>`;
}

export function viewToggle(surface: string): string {
  const current = viewOf(surface);
  const b = (view: DismissView, label: string): string =>
    `<button type="button" class="seg${current === view ? " active" : ""}" aria-pressed="${current === view}"
       data-act="dismiss-view" data-surface="${surface}" data-view="${view}">${label}</button>`;
  return `<div class="seg-group" role="group" aria-label="Show">${b("active", "Active")}${b("dismissed", "Dismissed")}${b("all", "All")}</div>`;
}

/** Dismissed items of one kind, newest first, with Restore on the live ones. */
export function historyList(list: Dismissal[], kind: DismissKind, empty = "Nothing has been dismissed here."): string {
  const rows = list.filter((d) => d.kind === kind);
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<ul class="dismiss-history">${rows.map((d) => `
    <li data-dismissal="${d.id}">
      <div><b>${esc(d.title)}</b>${d.critical ? ` <span class="badge bad">critical</span>` : ""}</div>
      <div class="muted sm">
        ${d.raisedAt ? `Raised ${esc(fmtDateTimeSast(d.raisedAt))} · ` : ""}Dismissed ${esc(fmtDateTimeSast(d.dismissedAt))} by ${esc(d.dismissedByName)}
        ${d.restoredAt ? ` · Restored ${esc(fmtDateTimeSast(d.restoredAt))} by ${esc(d.restoredByName ?? "")}` : ""}
      </div>
      ${d.note ? `<div class="sm">Note: ${esc(d.note)}</div>` : ""}
      ${d.restoredAt ? "" : `<button type="button" class="btn ghost sm" data-act="restore-dismissal" data-id="${d.id}">Restore</button>`}
    </li>`).join("")}</ul>`;
}
