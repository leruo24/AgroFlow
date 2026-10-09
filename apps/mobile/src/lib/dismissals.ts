/* The app's side of dismiss and history.
 * An alert's key is its database id; an insight's is zone:type:day (one per zone, type and
 * day). Notices the app makes locally have no server record, so they cannot be dismissed
 * into history. */
import type { Dismissal } from '@/services/agroFlowApi';

export type DismissView = 'active' | 'dismissed' | 'all';

/** The database id behind a mobile alert id ("database-42"), or null. */
export function alertKey(mobileId: string): string | null {
  const m = /^database-(\d+)$/.exec(mobileId);
  return m ? m[1] : null;
}

export function insightKey(zoneId: number, insightType: string, day: string): string {
  return `${zoneId}:${insightType}:${day}`;
}

/** The live dismissal of this item, if any. */
export function activeDismissal(list: Dismissal[], kind: Dismissal['kind'], key: string | null): Dismissal | undefined {
  if (!key) return undefined;
  return list.find((d) => d.kind === kind && d.itemKey === key && !d.restoredAt);
}

/** "Dismissed 6 Oct 2026, 08:05 by Thandi" style line, in SAST. */
export function dismissedLine(d: Dismissal, fmt: (iso: string) => string | null): string {
  return `Dismissed ${fmt(d.dismissedAt) ?? ''} by ${d.dismissedByName}` +
    (d.restoredAt ? ` · restored ${fmt(d.restoredAt) ?? ''}` : '');
}
