import { supabase } from '@/lib/supabase';

// Today's insights for the farmer's own zones, read straight from Supabase
// under RLS rather than through AgroFlow.Api.
//
// This follows the project rule that the apps read ordinary data directly and
// the API only does what a client cannot: ai_recommendation already has a
// member SELECT policy through zone -> farm, so there is nothing for an
// endpoint to add here.
//
// EVERY failure path returns an empty list rather than throwing. The raindrop
// helper is decoration over real data: if the table is missing, the columns are
// older than the engine, or the network is down, the helper must fall back to
// alerts and then to "all good" - never crash the Home screen, and never show
// placeholder text pretending to be advice.

export type ZoneInsightRow = {
  zoneId: string;
  insightType: string;
  severity: 'act_now' | 'heads_up' | 'info';
  message: string;
};

// A "day" is a calendar day in Africa/Johannesburg, matching the engine and the
// report endpoints. South Africa has no daylight saving, so a fixed +2 h offset
// is correct and needs no timezone database.
export function todayInSast(): string {
  const sast = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return sast.toISOString().slice(0, 10);
}

export async function fetchTodayZoneInsights(
  zoneIds: string[]
): Promise<ZoneInsightRow[]> {
  if (zoneIds.length === 0) return [];

  try {
    const numericIds = zoneIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));

    if (numericIds.length === 0) return [];

    const { data, error } = await supabase
      .from('ai_recommendation')
      .select('zone_id, insight_type, severity, message')
      .in('zone_id', numericIds)
      .eq('valid_for', todayInSast())
      .is('dismissed_at', null);

    // A missing table or column arrives here as an error, not an exception.
    if (error || !data) return [];

    return data
      .filter(
        (row): row is {
          zone_id: number;
          insight_type: string;
          severity: string;
          message: string;
        } =>
          row != null &&
          typeof row.insight_type === 'string' &&
          typeof row.message === 'string'
      )
      .map((row) => ({
        zoneId: String(row.zone_id),
        insightType: row.insight_type,
        severity:
          row.severity === 'act_now' || row.severity === 'heads_up'
            ? row.severity
            : 'info',
        message: row.message,
      }));
  } catch {
    return [];
  }
}
