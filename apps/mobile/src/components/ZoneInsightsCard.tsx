import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { AlertCircle, Info, Lightbulb } from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import { createZoneInsightsStyles } from '@/styles/zoneInsightsStyles';
import {
  dismissZoneInsight,
  fetchZoneInsights,
  type ZoneInsight,
} from '@/services/agroFlowApi';

type Props = {
  zoneId: number;
  // Supply insights directly to skip the fetch - useful when a parent screen
  // has already loaded them.
  insights?: ZoneInsight[];
};

// Today's advice for one zone, act_now first, tap to dismiss.
//
// A dismissed insight disappears for the rest of the day. It is removed from the
// list straight away rather than after the round trip, because the farmer has
// already read it and a row that lingers looks broken; if the call fails it is
// put back and nothing is lost.
export function ZoneInsightsCard({ zoneId, insights: provided }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createZoneInsightsStyles(colors), [colors]);

  const [insights, setInsights] = useState<ZoneInsight[]>(provided ?? []);
  const [loading, setLoading] = useState(provided === undefined);
  const [failed, setFailed] = useState(false);

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
        setFailed(false);
      })
      .catch(() => {
        // The insights table may not exist yet. An empty card is the honest
        // answer - never a placeholder message pretending to be advice.
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

  const dismiss = useCallback(
    (insight: ZoneInsight) => {
      setInsights((current) =>
        current.filter((i) => i.insightType !== insight.insightType)
      );

      dismissZoneInsight(zoneId, insight.insightType).catch(() => {
        // Put it back: a failed dismiss must not silently hide advice.
        setInsights((current) =>
          current.some((i) => i.insightType === insight.insightType)
            ? current
            : [...current, insight]
        );
      });
    },
    [zoneId]
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

      {ordered.length === 0 ? (
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
            <Pressable
              key={insight.insightType}
              accessibilityRole="button"
              accessibilityLabel={`${insight.message} Tap to dismiss.`}
              onPress={() => dismiss(insight)}
              style={[styles.row, index > 0 && styles.rowDivider]}
            >
              <View style={[styles.severityBar, barStyle]} />
              <Icon size={19} color={iconColor} strokeWidth={1.7} />
              <View style={styles.rowBody}>
                <Text style={styles.message}>{insight.message}</Text>
                <Text style={styles.dismissHint}>Tap to dismiss</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}
