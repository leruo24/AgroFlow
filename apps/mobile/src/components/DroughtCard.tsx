// Home's water budget and drought mode (GET/PUT /api/farmer/farms/{id}/drought).
// "You have about X L. At normal watering that lasts N days; in drought mode it lasts M days."
// When drought mode is on, each zone's priority for today: water fully, at a share, or skip
// (from the FAO yield response factor; the watering advice itself is unchanged). The farmer can
// switch drought mode on or off by hand, or leave it automatic. It never predicts a drought or
// claims an official declaration; the card says so.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { useI18n, type TranslationKey } from '@/i18n';
import { fetchDrought, setDroughtMode, type DroughtView, type DroughtZone } from '@/services/agroFlowApi';
import { isNetworkError, onReconnect } from '@/lib/connectivity';

type Mode = 'auto' | 'on' | 'off';

export function DroughtCard() {
  const { farm } = useAgroFlow();
  const farmId = farm?.id ?? null;
  const { colors } = useTheme();
  const { t } = useI18n();
  const [view, setView] = useState<DroughtView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const styles = useMemo(() => createStyles(colors), [colors]);

  const load = useCallback(() => {
    if (!farmId) return;
    fetchDrought(farmId).then(v => { setView(v); setError(null); }).catch(() => undefined);
  }, [farmId]);
  useEffect(() => { setView(null); load(); }, [load]);
  useFocusEffect(load);
  useEffect(() => onReconnect(load), [load]);

  if (!farm || !view) return null;
  const mode: Mode = view.override ?? 'auto';

  const choose = async (next: Mode) => {
    if (next === mode || busy) return;
    setBusy(true); setError(null);
    try {
      setView(await setDroughtMode(farm.id, next));
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    } finally {
      setBusy(false);
    }
  };

  return <View style={[styles.card, view.active && styles.cardOn]} testID="drought-card">
    <Text accessibilityRole="header" style={styles.title}>{view.active ? t('drought.on') : t('drought.budget')}</Text>
    {view.budget ? <Text style={styles.body} testID="drought-budget">{view.budget.text}</Text>
      : <Text style={styles.help}>{t('drought.noBudget')}</Text>}
    {view.active ? <>
      <Text style={styles.help} testID="drought-reason">{view.reason}</Text>
      {view.summary ? <Text style={styles.summary} testID="drought-summary">{view.summary}</Text> : null}
      {view.zones.map(z => <ZoneRow key={z.zoneId} z={z} styles={styles} t={t} />)}
    </> : null}
    <Text style={styles.help}>{t('drought.modeLabel')}</Text>
    <View style={styles.modes} accessibilityRole="radiogroup">
      {(['auto', 'on', 'off'] as const).map(m => <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: mode === m, disabled: busy }}
        onPress={() => { void choose(m); }} style={[styles.mode, mode === m && styles.modeOn]} testID={`drought-mode-${m}`}>
        <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>{t(`drought.mode.${m}` as TranslationKey)}</Text>
      </Pressable>)}
    </View>
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    <Text style={styles.help} testID="drought-honesty">{view.honesty}</Text>
  </View>;
}

type Styles = ReturnType<typeof createStyles>;
type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

function ZoneRow({ z, styles, t }: { z: DroughtZone; styles: Styles; t: T }) {
  const label = z.priority === 'reduced' ? t('drought.priority.reduced', { pct: Math.round(z.fraction * 100) })
    : z.priority === 'skip' ? t('drought.priority.skip') : t('drought.priority.full');
  const tone = z.priority === 'skip' ? styles.skip : z.priority === 'reduced' ? styles.reduced : styles.full;
  return <View style={styles.zone} testID={`drought-zone-${z.zoneId}`}>
    <View style={styles.zoneHead}>
      <Text style={styles.zoneName}>{z.zoneName}</Text>
      <Text style={[styles.badge, tone]}>{label}</Text>
    </View>
    {z.droughtLitres != null && z.droughtLitres > 0 ? <Text style={styles.body}>{t('drought.litres', { litres: Math.round(z.droughtLitres) })}</Text> : null}
    <Text style={styles.help}>{z.why}</Text>
  </View>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: Spacing.three },
    cardOn: { borderColor: colors.warning, borderWidth: 2 },
    title: { color: colors.text, fontSize: Type.title, fontWeight: '700' },
    body: { color: colors.text, fontSize: Type.body, lineHeight: 22 },
    help: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 20 },
    summary: { color: colors.text, fontSize: Type.body, lineHeight: 22, fontWeight: '600' },
    zone: { gap: 2, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    zoneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
    zoneName: { color: colors.text, fontSize: Type.body, fontWeight: '600', flexShrink: 1 },
    badge: { fontSize: Type.caption, fontWeight: '700', paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
    full: { color: colors.text, backgroundColor: colors.successBackground },
    reduced: { color: colors.text, backgroundColor: colors.warningBackground },
    skip: { color: colors.text, backgroundColor: colors.divider },
    modes: { flexDirection: 'row', gap: Spacing.one },
    mode: { flex: 1, minHeight: 44, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    modeOn: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
    modeText: { color: colors.text, fontSize: Type.caption, fontWeight: '600' },
    modeTextOn: { color: colors.white },
    error: { color: colors.error, fontSize: Type.body },
  });
}
