import { supabase } from '@/lib/supabase';

// Every alert and every piece of advice the farmer's zones have ever
// produced, newest first, with whether anyone looked at it.
//
// WHY THIS READS SUPABASE DIRECTLY RATHER THAN GOING THROUGH THE API
// ------------------------------------------------------------------
// The same rule insightsService.ts follows: the apps read ordinary data
// directly under RLS, and the API only does what a client cannot. Both tables
// already have member SELECT policies through zone -> farm (0011 for `alert`,
// 0011 + 0027 for `ai_recommendation`), so an endpoint would add a hop and
// another place for the two to disagree.
//
// WHY THE TWO ARE MERGED INTO ONE LIST
// A farmer does not have a mental category for "alert" versus "insight". They
// have "things AgroFlow told me". The `kind` field keeps them filterable
// without making the farmer learn the difference to read the screen.

export type AlertHistoryKind = 'alert' | 'advice';

export type AlertHistoryStatus =
  | { state: 'new' }
  | { state: 'seen'; at: string }
  | { state: 'dismissed'; at: string };

export type AlertHistoryItem = {
  id: string;
  kind: AlertHistoryKind;
  zoneId: string | null;
  zoneName: string | null;
  message: string;
  severity: string | null;
  timestamp: string;
  status: AlertHistoryStatus;
};

export type AlertHistoryPeriod = 7 | 30 | 'all';

// Returns [] on EVERY failure rather than throwing.
//
// This list is history, not a control surface - nothing the farmer does
// depends on it. A missing column (0033 not applied yet) or a dropped network
// must leave the History screen showing its irrigation events, not an error
// page. The one thing it must never do is show a wrong status, which is why
// an unreadable read_at becomes 'new' and never 'seen'.
export async function fetchAlertHistory(
  zoneIds: string[],
  period: AlertHistoryPeriod = 'all'
): Promise<AlertHistoryItem[]> {
  if (zoneIds.length === 0) return [];

  const numericIds = zoneIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  if (numericIds.length === 0) return [];

  const since =
    period === 'all'
      ? null
      : new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();

  const zoneNames = new Map<number, string>();

  try {
    const { data } = await supabase
      .from('zone')
      .select('id, name')
      .in('id', numericIds);

    for (const row of (data ?? []) as { id: number; name: string | null }[]) {
      zoneNames.set(row.id, row.name ?? `Zone ${row.id}`);
    }
  } catch {
    // Names are decoration; the list still reads without them.
  }

  const items: AlertHistoryItem[] = [];

  // ---- alerts ------------------------------------------------------------
  try {
    let query = supabase
      .from('alert')
      .select('id, zone_id, severity, message, status, created_at, read_at')
      .in('zone_id', numericIds)
      .order('created_at', { ascending: false })
      .limit(200);

    if (since) query = query.gte('created_at', since);

    const { data, error } = await query;

    // A missing read_at column (0033 not applied) arrives here as an error,
    // not an exception. Retry without it so the list still works, rather than
    // showing the farmer nothing.
    if (error) {
      let fallback = supabase
        .from('alert')
        .select('id, zone_id, severity, message, status, created_at')
        .in('zone_id', numericIds)
        .order('created_at', { ascending: false })
        .limit(200);

      if (since) fallback = fallback.gte('created_at', since);

      const { data: plain } = await fallback;

      for (const row of (plain ?? []) as AlertRow[]) {
        items.push(toAlertItem(row, zoneNames));
      }
    } else {
      for (const row of (data ?? []) as AlertRow[]) {
        items.push(toAlertItem(row, zoneNames));
      }
    }
  } catch {
    // Leave alerts out; advice below may still load.
  }

  // ---- advice (the engine's insights) ------------------------------------
  try {
    let query = supabase
      .from('ai_recommendation')
      .select('recommendation_id, zone_id, message, severity, created_at, dismissed_at')
      .in('zone_id', numericIds)
      .order('created_at', { ascending: false })
      .limit(200);

    if (since) query = query.gte('created_at', since);

    const { data } = await query;

    for (const row of (data ?? []) as InsightRow[]) {
      if (!row || typeof row.message !== 'string' || row.message.length === 0) continue;

      items.push({
        id: `advice-${row.recommendation_id}`,
        kind: 'advice',
        zoneId: row.zone_id === null ? null : String(row.zone_id),
        zoneName: row.zone_id === null ? null : zoneNames.get(row.zone_id) ?? null,
        message: row.message,
        severity: row.severity ?? null,
        timestamp: row.created_at ?? '',
        // Insights have no "read" concept - the farmer dismisses them or they
        // expire with the day. So there are only two states here, and
        // claiming "Seen" for an undismissed one would be inventing a fact.
        status: row.dismissed_at
          ? { state: 'dismissed', at: row.dismissed_at }
          : { state: 'new' },
      });
    }
  } catch {
    // Leave advice out; alerts above may still have loaded.
  }

  return items.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

type AlertRow = {
  id: number;
  zone_id: number | null;
  severity: string | null;
  message: string | null;
  status: string | null;
  created_at: string | null;
  read_at?: string | null;
};

type InsightRow = {
  recommendation_id: number;
  zone_id: number | null;
  message: string | null;
  severity: string | null;
  created_at: string | null;
  dismissed_at: string | null;
};

function toAlertItem(row: AlertRow, zoneNames: Map<number, string>): AlertHistoryItem {
  return {
    id: `alert-${row.id}`,
    kind: 'alert',
    zoneId: row.zone_id === null ? null : String(row.zone_id),
    zoneName: row.zone_id === null ? null : zoneNames.get(row.zone_id) ?? null,
    message: row.message ?? '',
    severity: row.severity ?? null,
    timestamp: row.created_at ?? '',
    // read_at is the only evidence a human looked at this. `status` is not a
    // substitute: Resolved means the underlying problem went away, which
    // happens on its own without anyone opening the app.
    status: row.read_at ? { state: 'seen', at: row.read_at } : { state: 'new' },
  };
}

// "Seen 3 Oct, 14:05". Short enough for a list row on a phone.
export function describeStatus(status: AlertHistoryStatus): string {
  if (status.state === 'new') return 'New';

  const when = new Date(status.at);
  const label = Number.isFinite(when.getTime())
    ? when.toLocaleString('en-ZA', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return status.state === 'seen' ? `Seen ${label}`.trim() : `Dismissed ${label}`.trim();
}

// Persists that the farmer opened this alert.
//
// Fire-and-forget: the row has already been shown as read on screen, and
// failing to record it must not put an error in front of someone who was just
// reading their alerts. Returns false so a caller can log it if it ever wants
// to.
export async function markAlertReadInDatabase(alertId: string): Promise<boolean> {
  // The app's own ids are prefixed ("database-12", "alert-12") because they
  // share a list with locally-generated ones. Only a real row can be written.
  const numeric = Number(alertId.replace(/^(database-|alert-)/, ''));
  if (!Number.isFinite(numeric)) return false;

  try {
    const { error } = await supabase
      .from('alert')
      // Only ever set, never cleared, and never overwritten: the FIRST time
      // somebody looked is the fact worth keeping.
      .update({ read_at: new Date().toISOString() })
      .eq('id', numeric)
      .is('read_at', null);

    return !error;
  } catch {
    return false;
  }
}
