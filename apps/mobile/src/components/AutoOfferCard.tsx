// "Turn on automatic watering?" (Part B decision): asked once per zone, only after the installer
// commissioned it (kit, wet/dry calibration, measured flow, an acknowledged test). Yes saves
// Automatic; Keep manual leaves it Manual. The answer is saved before the card goes.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { useI18n } from '@/i18n';
import { answerAutomaticOffer, type Journey } from '@/services/agroFlowApi';
import { isNetworkError } from '@/lib/connectivity';

export function AutoOfferCard({ journey, onAnswered }: { journey: Journey; onAnswered: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { refreshZones } = useAgroFlow();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zones = journey.zones.filter(z => z.offerAutomatic);
  if (zones.length === 0) return null;

  const answer = async (zoneId: number, value: 'automatic' | 'manual') => {
    if (busy !== null) return;
    setBusy(zoneId); setError(null);
    try {
      await answerAutomaticOffer(zoneId, value);
      refreshZones();
      onAnswered();
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    } finally {
      setBusy(null);
    }
  };

  return <>{zones.map(z => <View key={z.zoneId} style={styles.card} testID={`auto-offer-${z.zoneId}`}>
    <Text accessibilityRole="header" style={styles.title}>{t('auto.title', { zone: z.name })}</Text>
    <Text style={styles.body}>{t('auto.body')}</Text>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy !== null }} disabled={busy !== null}
        onPress={() => { void answer(z.zoneId, 'automatic'); }} style={styles.primary} testID={`auto-offer-yes-${z.zoneId}`}>
        <Text style={styles.primaryText}>{busy === z.zoneId ? t('common.saving') : t('auto.yes')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy !== null }} disabled={busy !== null}
        onPress={() => { void answer(z.zoneId, 'manual'); }} style={styles.secondary} testID={`auto-offer-no-${z.zoneId}`}>
        <Text style={styles.secondaryText}>{t('auto.keepManual')}</Text>
      </Pressable>
    </View>
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </View>)}</>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primaryDark, marginBottom: Spacing.three },
    title: { color: colors.text, fontSize: Type.title, fontWeight: '700' },
    body: { color: colors.textSecondary, fontSize: Type.body, lineHeight: 22 },
    row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
    primary: { flexGrow: 1, minHeight: 48, borderRadius: Radius.sm, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
    primaryText: { color: colors.white, fontSize: Type.body, fontWeight: '700' },
    secondary: { flexGrow: 1, minHeight: 48, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
    secondaryText: { color: colors.text, fontSize: Type.body, fontWeight: '600' },
    error: { color: colors.error, fontSize: Type.body },
  });
}
