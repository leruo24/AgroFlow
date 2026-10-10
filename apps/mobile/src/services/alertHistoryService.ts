import { supabase } from '@/lib/supabase';

// Every alert and piece of advice for the farmer's zones, newest first,
// with whether anyone has looked at it.
// We read Supabase directly under RLS (like insightsService.ts): both tables
// already have member SELECT policies, so an API endpoint would add nothing.
// Alerts and advice share one list; `kind` keeps them apart for filtering.

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

// Returns [] on any failure instead of throwing: this is history, so a missing
// column or a dropped network should never turn the screen into an error page.
// An unreadable read_at shows as 'new', never 'seen'.
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
    // Names are optional; the list still reads without them.
  }

  const items: AlertHistoryItem[] = [];

  // Read straight from Supabase with the farmer's own login. Row Level
  // Security (migration 0011) only returns alerts for their own farm.
  try {
    let query = supabase
      .from('alert')
      .select('id, zone_id, severity, message, status, created_at, read_at')
      .in('zone_id', numericIds)
      .order('created_at', { ascending: false })
      .limit(200);

    if (since) query = query.gte('created_at', since);

    const { data, error } = await query;

    // If the read_at column is missing (0033 not applied), Supabase returns an
    // error, so we retry without it and the list still loads.
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
    // Skip alerts; advice below may still load.
  }

  // Advice: the engine's insights.
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
        // Insights are never marked read: they are dismissed or expire with the day,
        // so there are only two states and we never claim "Seen".
        status: row.dismissed_at
          ? { state: 'dismissed', at: row.dismissed_at }
          : { state: 'new' },
      });
    }
  } catch {
    // Skip advice; alerts above may still have loaded.
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
    // read_at is the only proof a person looked at this. Resolved is not the same:
    // the problem can go away without anyone opening the app.
    status: row.read_at ? { state: 'seen', at: row.read_at } : { state: 'new' },
  };
}

// For example "Seen 3 Oct, 14:05", short enough for a phone list row.
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

// Records that the farmer opened this alert.
// Fire-and-forget: the row already shows as read, so a failed write never
// shows an error. Returns false so a caller can log it.
export async function markAlertReadInDatabase(alertId: string): Promise<boolean> {
  // Ids are prefixed ("database-12", "alert-12") because they share a list with
  // local ones. Only a real database row can be written.
  const numeric = Number(alertId.replace(/^(database-|alert-)/, ''));
  if (!Number.isFinite(numeric)) return false;

  try {
    const { error } = await supabase
      .from('alert')
      // Only ever set once: the first time someone looked is what we keep.
      .update({ read_at: new Date().toISOString() })
      .eq('id', numeric)
      .is('read_at', null);

    return !error;
  } catch {
    return false;
  }
}
