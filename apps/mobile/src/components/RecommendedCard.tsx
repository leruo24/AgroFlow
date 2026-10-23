import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { createTodayStyles } from '@/styles/todayStyles';
import { useI18n } from '@/i18n';
import {
  fetchRecommendedSettings,
  resetZoneToRecommended,
  type RecommendedSettings,
} from '@/services/agroFlowApi';

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

type Props = {
  zoneId: number;
  // Pass it in to skip the fetch; the crop screen gets one back on save.
  recommendation?: RecommendedSettings | null;
};

// "Recommended for you": the server's sentence, how sure it is, and Use these settings /
// Keep my own. Use these settings saves through "Reset to recommended", so the card and
// the saved threshold always match.
export function RecommendedCard({ zoneId, recommendation }: Props) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);

  const [rec, setRec] = useState<RecommendedSettings | null>(recommendation ?? null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (recommendation !== undefined) {
      setRec(recommendation);
      setHidden(false);
      return;
    }
    let active = true;
    fetchRecommendedSettings(zoneId)
      .then((r) => active && setRec(r))
      .catch(() => active && setRec(null));
    return () => {
      active = false;
    };
  }, [zoneId, recommendation]);

  const apply = useCallback(() => {
    setBusy(true);
    setMessage(null);
    setError(null);
    resetZoneToRecommended(zoneId)
      .then((r) => setMessage(r.message))
      .catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : 'Could not save these settings right now.'))
      .finally(() => setBusy(false));
  }, [zoneId]);

  if (!rec || !rec.available || hidden) return null;

  return (
    <View style={styles.card} testID="recommended-card">
      <Text style={styles.zoneName}>{t('recommended.title')}</Text>
      <Text style={styles.help}>{rec.text}</Text>
      {rec.confidence && (
        <View style={styles.badgeRow} accessibilityLabel={`Confidence: ${LEVEL_LABEL[rec.confidence.level]}. ${rec.confidence.reason}`}>
          <Text style={styles.badge}>{LEVEL_LABEL[rec.confidence.level]} confidence</Text>
        </View>
      )}
      {rec.canApply === false && rec.applyNote ? <Text style={styles.help}>{rec.applyNote}</Text> : null}
      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || rec.canApply === false }}
          disabled={busy || rec.canApply === false}
          onPress={apply}
          style={[styles.button, (busy || rec.canApply === false) && styles.busy]}
        >
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>{t('recommended.use')}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setHidden(true)} style={styles.ghost}>
          <Text style={styles.ghostText}>{t('recommended.keep')}</Text>
        </Pressable>
      </View>
      {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}
