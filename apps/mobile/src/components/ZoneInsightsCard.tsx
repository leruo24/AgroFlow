import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { AlertCircle, Info, Lightbulb } from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import { createZoneInsightsStyles } from '@/styles/zoneInsightsStyles';
import {
  dismissNotification,
  fetchDismissals,
  fetchZoneInsights,
  restoreNotification,
  type Dismissal,
  type Explanation,
  type ZoneInsight,
} from '@/services/agroFlowApi';
import { WhyLink } from '@/components/WhySheet';
import { DismissButton, DismissNoteSheet, UndoBar, ViewSwitch } from '@/components/DismissControls';
import { dismissedLine, insightKey, type DismissView } from '@/lib/dismissals';
import { todayInSast } from '@/services/insightsService';
import { formatSast } from '@/lib/sastTime';
import { useAgroFlow } from '@/context/AgroFlowContext';

// How sure the advice is, and the one thing that would improve it.
type Confidence = {
  level: 'high' | 'medium' | 'low';
  reason: string;
  explanation: Explanation | null;
  nextStep: string | null;
};

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

type Props = {
  zoneId: number;
  // Pass insights in to skip the fetch, when a parent screen already has them.
  insights?: ZoneInsight[];
};

// Today's advice for one zone, act-now first, tap to dismiss.
// A dismissed insight disappears for the rest of the day. It is removed from the list
// straight away; if the call fails it comes back.
export function ZoneInsightsCard({ zoneId, insights: provided }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createZoneInsightsStyles(colors), [colors]);

  const [insights, setInsights] = useState<ZoneInsight[]>(provided ?? []);
  const [loading, setLoading] = useState(provided === undefined);
  const [failed, setFailed] = useState(false);
  const [confidence, setConfidence] = useState<Confidence | null>(null);

  useEffect(() => {
    if (provided !== undefined) {
      setInsights(provided);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    fetchZoneInsights(zoneId)
      .then((result) => {
        if (!active) return;
        setInsights(result.insights ?? []);
        setConfidence(
          result.confidence
            ? {
                level: result.confidence.level,
                reason: result.confidence.reason,
                explanation: result.confidenceExplanation ?? null,
                nextStep: result.nextStep?.ask ?? null,
              }
            : null
        );
        setFailed(false);
      })
      .catch(() => {
        // The insights table may not exist yet. An empty card is the honest answer, never a
        // placeholder pretending to be advice.
        if (!active) return;
        setInsights([]);
        setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [zoneId, provided]);

  const ordered = useMemo(() => {
    const rank = { act_now: 0, heads_up: 1, info: 2 } as const;
    return [...insights].sort(
      (a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)
    );
  }, [insights]);

  // x to dismiss (recorded, never deleted), Undo for 5 s, an optional note for act-now
  // advice, and this zone's dismissed advice under Dismissed with Restore.
  const { farm } = useAgroFlow();
  const [view, setView] = useState<DismissView>('active');
  const [dismissals, setDismissals] = useState<Dismissal[]>([]);
  const [undo, setUndo] = useState<{ id: number; insight: ZoneInsight } | null>(null);
  const [asking, setAsking] = useState<ZoneInsight | null>(null);

  const loadDismissals = useCallback(() => {
    if (!farm) return;
    fetchDismissals(farm.id)
      .then((rows) => setDismissals(rows.filter((d) => d.kind === 'insight' && d.itemKey.startsWith(`${zoneId}:`))))
      .catch(() => setDismissals([]));
  }, [farm, zoneId]);
  useEffect(loadDismissals, [loadDismissals]);

  const dismiss = useCallback(
    (insight: ZoneInsight, note: string | null) => {
      setInsights((current) =>
        current.filter((i) => i.insightType !== insight.insightType)
      );

      dismissNotification('insight', insightKey(zoneId, insight.insightType, todayInSast()), note)
        .then((r) => { setUndo({ id: r.id, insight }); loadDismissals(); })
        .catch(() => {
          // Put it back: a failed dismiss must not silently hide advice.
          setInsights((current) =>
            current.some((i) => i.insightType === insight.insightType)
              ? current
              : [...current, insight]
          );
        });
    },
    [zoneId, loadDismissals]
  );

  const restore = useCallback(
    (id: number, insight?: ZoneInsight) => {
      restoreNotification(id)
        .then(() => {
          if (insight) {
            setInsights((current) =>
              current.some((i) => i.insightType === insight.insightType) ? current : [...current, insight]);
          } else {
            fetchZoneInsights(zoneId).then((r) => setInsights(r.insights ?? [])).catch(() => undefined);
          }
          loadDismissals();
        })
        .catch(() => undefined);
    },
    [zoneId, loadDismissals]
  );

  if (loading) {
    return (
      <View style={styles.card}>
        <View style={styles.headingLeft}>
          <ActivityIndicator color={colors.primaryDark} />
          <Text style={styles.title}>Advice</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.heading}>
        <View style={styles.headingLeft}>
          <Lightbulb size={20} color={colors.primaryDark} strokeWidth={1.7} />
          <Text style={styles.title}>Advice</Text>
        </View>
        {ordered.length > 0 && (
          <Text style={styles.count}>{ordered.length}</Text>
        )}
      </View>

      {confidence && (
        <View style={styles.confidence} accessibilityLabel={`Advice confidence: ${LEVEL_LABEL[confidence.level]}. ${confidence.reason}`}>
          <Text style={styles.confidenceBadge}>{LEVEL_LABEL[confidence.level]} confidence</Text>
          <Text style={styles.confidenceReason}>{confidence.reason}</Text>
          <WhyLink explanation={confidence.explanation} compact />
          {confidence.nextStep && (
            <View style={styles.improve}>
              <Text style={styles.improveTitle}>Improve your advice</Text>
              <Text style={styles.improveText}>{confidence.nextStep}</Text>
            </View>
          )}
        </View>
      )}

      <ViewSwitch value={view} onChange={setView} />
      <UndoBar
        message={undo ? 'Advice dismissed.' : null}
        onUndo={() => undo && restore(undo.id, undo.insight)}
        onDone={() => setUndo(null)}
      />

      {view === 'dismissed' ? null : ordered.length === 0 ? (
        <Text style={styles.empty}>
          {failed
            ? 'Advice is not available right now.'
            : 'Nothing needs your attention here today.'}
        </Text>
      ) : (
        ordered.map((insight, index) => {
          const Icon = insight.severity === 'info' ? Info : AlertCircle;
          const iconColor =
            insight.severity === 'act_now'
              ? colors.error
              : insight.severity === 'heads_up'
                ? colors.warning
                : colors.primaryDark;

          const barStyle =
            insight.severity === 'act_now'
              ? styles.severityActNow
              : insight.severity === 'heads_up'
                ? styles.severityHeadsUp
                : styles.severityInfo;

          return (
            <View
              key={insight.insightType}
              style={[styles.row, index > 0 && styles.rowDivider]}
            >
              <View style={[styles.severityBar, barStyle]} />
              <Icon size={19} color={iconColor} strokeWidth={1.7} />
              <View style={styles.rowBody}>
                <Text style={styles.message}>{insight.message}</Text>
                <WhyLink explanation={insight.explanation} compact />
              </View>
              <DismissButton
                label={insight.message}
                onPress={() => (insight.severity === 'act_now' ? setAsking(insight) : dismiss(insight, null))}
              />
            </View>
          );
        })
      )}

      {view !== 'active' && (
        <View style={styles.rowDivider}>
          <Text style={styles.title}>Dismissed</Text>
          {dismissals.length === 0 ? (
            <Text style={styles.empty}>No advice has been dismissed for this zone.</Text>
          ) : (
            dismissals.map((d) => (
              <View key={d.id} style={styles.row} testID={`dismissed-insight-${d.id}`}>
                <View style={styles.rowBody}>
                  <Text style={styles.message}>{d.title}</Text>
                  <Text style={styles.dismissHint}>{dismissedLine(d, formatSast)}</Text>
                  {d.note ? <Text style={styles.dismissHint}>Note: {d.note}</Text> : null}
                  {!d.restoredAt && (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Restore ${d.title}`} onPress={() => restore(d.id)}>
                      <Text style={styles.confidenceBadge}>Restore</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      )}

      <DismissNoteSheet
        title={asking?.message ?? ''}
        visible={asking !== null}
        onCancel={() => setAsking(null)}
        onConfirm={(note) => { if (asking) dismiss(asking, note); setAsking(null); }}
      />
    </View>
  );
}
