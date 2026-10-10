import { supabase } from '@/lib/supabase';
import type { Explanation } from '@/services/agroFlowApi';

// Today's insights for the farmer's own zones, read straight from Supabase under RLS.
// The apps read ordinary data directly and the API only does what a client cannot;
// ai_recommendation already has a member SELECT policy through zone -> farm.
// Every failure returns an empty list instead of throwing: if the table is missing, the
// columns are older than the engine, or the network is down, the helper falls back to
// alerts and then "all good", and never shows made-up advice.

export type ZoneInsightRow = {
  zoneId: string;
  insightType: string;
  severity: 'act_now' | 'heads_up' | 'info';
  message: string;
  // Stored with the insight in ai_recommendation.data.explanation.
  explanation?: Explanation | null;
};

// The explanation in an insight's data column, if it has the shape the app shows. Anything
// else is treated as missing, never shown half-formed.
export function explanationFrom(data: unknown): Explanation | null {
  if (!data || typeof data !== 'object') return null;
  const e = (data as { explanation?: unknown }).explanation;
  if (!e || typeof e !== 'object') return null;
  const candidate = e as Partial<Explanation>;
  if (typeof candidate.summary !== 'string' || candidate.summary.length === 0) return null;
  return {
    summary: candidate.summary,
    facts: Array.isArray(candidate.facts)
      ? candidate.facts.filter(
          (f): f is Explanation['facts'][number] =>
            !!f && typeof f.label === 'string' && typeof f.value === 'string' && typeof f.source === 'string'
        )
      : [],
    rule: typeof candidate.rule === 'string' ? candidate.rule : '',
    confidence: typeof candidate.confidence === 'string' ? candidate.confidence : '',
    whatWouldChangeIt: typeof candidate.whatWouldChangeIt === 'string' ? candidate.whatWouldChangeIt : null,
    // technical is dropped on purpose: admins and report appendices only.
  };
}

// A "day" is a calendar day in SAST, like the engine and the reports. South Africa has no
// daylight saving, so a fixed +2 h offset is correct.
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
      .select('zone_id, insight_type, severity, message, data')
      .in('zone_id', numericIds)
      .eq('valid_for', todayInSast())
      .is('dismissed_at', null);

    // A missing table or column comes back as an error, not an exception.
    if (error || !data) return [];

    return data
      .filter(
        (row): row is {
          zone_id: number;
          insight_type: string;
          severity: string;
          message: string;
          data: unknown;
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
        explanation: explanationFrom(row.data),
      }));
  } catch {
    return [];
  }
}

// Explanations for alert rows (table `explanation`, migration 0039), keyed by the app's
// alert id. Read under RLS, farm members only. Never throws: no table, network or rows all
// mean "no Why link".
export async function fetchAlertExplanations(
  alertIds: string[]
): Promise<Record<string, Explanation>> {
  const byNumeric = new Map<number, string>();
  for (const id of alertIds) {
    // Alert ids are prefixed ("database-12", "alert-12") because they share a list with local
    // ones; only real rows have an explanation.
    const numeric = Number(id.replace(/^(database-|alert-)/, ''));
    if (Number.isFinite(numeric) && numeric > 0) byNumeric.set(numeric, id);
  }
  if (byNumeric.size === 0) return {};

  try {
    const { data, error } = await supabase
      .from('explanation')
      .select('alert_id, explanation')
      .in('alert_id', [...byNumeric.keys()]);

    if (error || !data) return {};

    const result: Record<string, Explanation> = {};
    for (const row of data as { alert_id: number | null; explanation: unknown }[]) {
      if (row.alert_id == null) continue;
      const appId = byNumeric.get(Number(row.alert_id));
      const explanation = explanationFrom({ explanation: row.explanation });
      if (appId && explanation) result[appId] = explanation;
    }
    return result;
  } catch {
    return {};
  }
}
