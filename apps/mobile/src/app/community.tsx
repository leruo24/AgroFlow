// Farmers nearby: community reports of pests, crop disease, fire, water problems and bad
// weather (docs/drought-community.md, Part 2).
//   - What nearby farms reported, by distance only ("about 18 km from your farm"); the
//     reporter is never shown. Every report says it has not been independently checked.
//   - "I'm seeing this too" (once per farmer; does not count towards the report limit).
//   - Fire: whoever reported or confirmed it can post updates (still burning, spreading
//     towards a direction, under control, out); "out" closes it.
//   - Add a report: what, which kind, how serious, a short note. Its place is the farm's saved
//     location (set by staff); the phone's location is never used. Up to 2 reports every 36
//     hours, shown before the farmer starts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';
import { router } from '@/lib/router';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { useI18n, type TranslationKey } from '@/i18n';
import {
  confirmCommunityReport, createCommunityReport, fetchCommunity, updateCommunityReport,
  type CommunityCategory, type CommunityLimit, type CommunitySeverity, type NearbyReport,
} from '@/services/agroFlowApi';
import { isNetworkError } from '@/lib/connectivity';

// The same lists as the API (AgroFlow.Domain CommunityCategories.Subtypes).
export const COMMUNITY_CATEGORIES: { category: CommunityCategory; subtypes: string[] }[] = [
  { category: 'pest', subtypes: ['locusts', 'fall_armyworm', 'aphids', 'unusual_insects'] },
  { category: 'disease', subtypes: ['suspected_crop_disease'] },
  { category: 'fire', subtypes: ['veld_fire', 'smoke_nearby'] },
  { category: 'water', subtypes: ['canal_not_flowing', 'borehole_dry', 'low_water', 'burst_pipe', 'possible_contamination'] },
  { category: 'weather', subtypes: ['hail', 'flooding', 'frost', 'extreme_wind', 'very_heavy_rain'] },
];
const SEVERITIES: CommunitySeverity[] = ['low', 'moderate', 'high'];
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const MAX_NOTE = 280;

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;
type Styles = ReturnType<typeof createStyles>;

const problem = (t: T, e: unknown) =>
  isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed');

export default function CommunityScreen() {
  const { farm } = useAgroFlow();
  const farmId = farm?.id ?? null;
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [reports, setReports] = useState<NearbyReport[] | null>(null);
  const [limit, setLimit] = useState<CommunityLimit | null>(null);
  const [unverified, setUnverified] = useState('');
  const [emergency, setEmergency] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!farmId) return;
    fetchCommunity(farmId)
      .then(r => { setReports(r.reports); setLimit(r.limit); setUnverified(r.unverified); setEmergency(r.emergency ?? null); setFailed(null); })
      .catch(e => setFailed(problem(t, e)));
  }, [farmId, t]);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(load);

  const confirm = async (r: NearbyReport) => {
    if (!farm) return;
    try {
      const res = await confirmCommunityReport(r.reportId, Number(farm.id));
      setNotice(res.message);
      load();
    } catch (e) {
      setNotice(problem(t, e));
    }
  };

  return <SafeAreaView style={styles.page} edges={['top']}>
    <View style={styles.head}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <ArrowLeft size={24} color={colors.text} />
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader title={t('community.title')} subtitle={t('community.subtitle')} />
      {notice ? <Text style={styles.ok} accessibilityLiveRegion="polite" testID="community-notice">{notice}</Text> : null}
      {adding && farm && limit
        ? <ReportForm t={t} styles={styles} farmId={Number(farm.id)} limit={limit} nearby={reports ?? []} emergency={emergency}
            onConfirm={r => { setAdding(false); void confirm(r); }}
            onDone={message => { setAdding(false); setNotice(message); load(); }} onCancel={() => setAdding(false)} />
        : <Pressable accessibilityRole="button" onPress={() => { setNotice(null); setAdding(true); }} style={styles.primary} testID="community-add"
            disabled={!limit}>
            <Text style={styles.primaryText}>{t('community.add')}</Text>
          </Pressable>}
      {limit && !adding ? <Text style={limit.allowed ? styles.help : styles.warning} testID="community-limit">{limit.message}</Text> : null}
      <Text accessibilityRole="header" style={styles.section}>{t('community.nearby')}</Text>
      {failed ? <Text style={styles.error}>{failed}</Text>
        : reports === null ? <ActivityIndicator color={colors.primaryDark} />
        : reports.length === 0 ? <Text style={styles.help} testID="community-empty">{t('community.none')}</Text>
        : reports.map(r => <ReportCard key={r.reportId} t={t} styles={styles} report={r} onConfirm={() => { void confirm(r); }} onUpdated={m => { setNotice(m); load(); }} />)}
      {unverified ? <Text style={styles.help}>{unverified}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

function ReportCard({ t, styles, report: r, onConfirm, onUpdated }: {
  t: T; styles: Styles; report: NearbyReport; onConfirm: () => void; onUpdated: (message: string) => void;
}) {
  const [direction, setDirection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fire = r.category === 'fire';
  const update = async (kind: 'still_burning' | 'spreading' | 'under_control' | 'out') => {
    setError(null);
    if (kind === 'spreading' && !direction) { setError(t('community.fire.pickDirection')); return; }
    try {
      const res = await updateCommunityReport(r.reportId, kind, kind === 'spreading' ? direction! : undefined);
      onUpdated(res.closed ? t('community.fire.closed') : t('community.fire.sent', { n: res.notifiedFarms }));
    } catch (e) {
      setError(problem(t, e));
    }
  };
  return <View style={[styles.card, r.downwind && styles.cardUrgent]} testID={`community-report-${r.reportId}`}>
    <View style={styles.cardHead}>
      <Text style={styles.cardTitle}>{r.label}</Text>
      <Text style={[styles.badge, r.severity === 'high' ? styles.badgeHigh : r.severity === 'moderate' ? styles.badgeMid : styles.badgeLow]}>
        {t(`community.severity.${r.severity}` as TranslationKey)}
      </Text>
    </View>
    {r.downwind ? <Text style={styles.urgent} testID={`community-downwind-${r.reportId}`}>{t('community.downwind')}</Text> : null}
    <Text style={styles.body}>{r.message}</Text>
    {r.similarFarms > 0 ? <Text style={styles.help}>{t('community.similar', { n: r.similarFarms + 1 })}</Text> : null}
    {r.confirmations > 0 ? <Text style={styles.help}>{t('community.confirmations', { n: r.confirmations })}</Text> : null}
    {r.updates.map((u, i) => <Text key={i} style={styles.help}>· {u}</Text>)}
    {r.mine ? <Text style={styles.help}>{t('community.yours')}</Text>
      : r.confirmed ? <Text style={styles.ok}>{t('community.alsoSeen')}</Text>
      : <Pressable accessibilityRole="button" onPress={onConfirm} style={styles.secondary} testID={`community-confirm-${r.reportId}`}>
          <Text style={styles.secondaryText}>{t('community.seeingToo')}</Text>
        </Pressable>}
    {fire && r.canUpdate ? <View style={styles.fireBox}>
      <Text style={styles.label}>{t('community.fire.update')}</Text>
      <View style={styles.chips}>
        {(['still_burning', 'under_control', 'out'] as const).map(k => <Pressable key={k} accessibilityRole="button" onPress={() => { void update(k); }}
          style={styles.chip} testID={`community-fire-${k}-${r.reportId}`}>
          <Text style={styles.chipText}>{t(`community.fire.${k}` as TranslationKey)}</Text>
        </Pressable>)}
      </View>
      <Text style={styles.help}>{t('community.fire.spreadingTowards')}</Text>
      <View style={styles.chips}>
        {DIRECTIONS.map(d => <Pressable key={d} accessibilityRole="radio" accessibilityState={{ checked: direction === d }} onPress={() => setDirection(d)}
          style={[styles.chip, direction === d && styles.chipOn]} testID={`community-fire-dir-${d}-${r.reportId}`}>
          <Text style={[styles.chipText, direction === d && styles.chipTextOn]}>{t(`community.dir.${d}` as TranslationKey)}</Text>
        </Pressable>)}
      </View>
      <Pressable accessibilityRole="button" onPress={() => { void update('spreading'); }} style={styles.secondary} testID={`community-fire-spreading-${r.reportId}`}>
        <Text style={styles.secondaryText}>{t('community.fire.spreading')}</Text>
      </Pressable>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View> : null}
  </View>;
}

function ReportForm({ t, styles, farmId, limit, nearby, emergency, onConfirm, onDone, onCancel }: {
  t: T; styles: Styles; farmId: number; limit: CommunityLimit; nearby: NearbyReport[]; emergency: string | null;
  onConfirm: (r: NearbyReport) => void; onDone: (message: string) => void; onCancel: () => void;
}) {
  const [category, setCategory] = useState<CommunityCategory | null>(null);
  const [subtype, setSubtype] = useState<string | null>(null);
  const [severity, setSeverity] = useState<CommunitySeverity | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subtypes = COMMUNITY_CATEGORIES.find(c => c.category === category)?.subtypes ?? [];
  // "I'm seeing this too": a report of the same kind already nearby can be confirmed instead.
  const similar = category ? nearby.filter(r => r.category === category && !r.mine && !r.confirmed) : [];

  const send = async () => {
    setError(null);
    if (!category) { setError(t('community.form.needCategory')); return; }
    if (!subtype) { setError(t('community.form.needSubtype')); return; }
    if (!severity) { setError(t('community.form.needSeverity')); return; }
    setBusy(true);
    try {
      const r = await createCommunityReport({ farmId, category, subtype, severity, description: note.trim() || undefined });
      onDone(t('community.form.sent', { n: r.notifiedFarms }));
    } catch (e) {
      setError(problem(t, e));
    } finally {
      setBusy(false);
    }
  };

  return <View style={styles.card} testID="community-form">
    <Text style={styles.cardTitle}>{t('community.form.title')}</Text>
    <Text style={limit.allowed ? styles.help : styles.warning} testID="community-form-limit">{limit.message}</Text>
    {!limit.allowed ? <Pressable accessibilityRole="button" onPress={onCancel} style={styles.secondary} testID="community-form-cancel">
      <Text style={styles.secondaryText}>{t('common.back')}</Text>
    </Pressable> : <>
      <Text style={styles.label}>{t('community.form.what')}</Text>
      <View style={styles.chips}>
        {COMMUNITY_CATEGORIES.map(c => <Pressable key={c.category} accessibilityRole="radio" accessibilityState={{ checked: category === c.category }}
          onPress={() => { setCategory(c.category); setSubtype(c.subtypes.length === 1 ? c.subtypes[0] : null); }}
          style={[styles.chip, category === c.category && styles.chipOn]} testID={`community-cat-${c.category}`}>
          <Text style={[styles.chipText, category === c.category && styles.chipTextOn]}>{t(`community.cat.${c.category}` as TranslationKey)}</Text>
        </Pressable>)}
      </View>
      {similar.length ? <View style={styles.fireBox} testID="community-similar">
        <Text style={styles.help}>{t('community.form.similar')}</Text>
        {similar.map(r => <Pressable key={r.reportId} accessibilityRole="button" onPress={() => onConfirm(r)} style={styles.secondary} testID={`community-similar-${r.reportId}`}>
          <Text style={styles.secondaryText}>{t('community.form.seeingTooThis', { what: r.label, km: Math.round(r.distanceKm) })}</Text>
        </Pressable>)}
      </View> : null}
      {subtypes.length > 1 ? <>
        <Text style={styles.label}>{t('community.form.which')}</Text>
        <View style={styles.chips}>
          {subtypes.map(s => <Pressable key={s} accessibilityRole="radio" accessibilityState={{ checked: subtype === s }} onPress={() => setSubtype(s)}
            style={[styles.chip, subtype === s && styles.chipOn]} testID={`community-sub-${s}`}>
            <Text style={[styles.chipText, subtype === s && styles.chipTextOn]}>{t(`community.sub.${s}` as TranslationKey)}</Text>
          </Pressable>)}
        </View>
      </> : null}
      <Text style={styles.label}>{t('community.form.howSerious')}</Text>
      <View style={styles.chips}>
        {SEVERITIES.map(s => <Pressable key={s} accessibilityRole="radio" accessibilityState={{ checked: severity === s }} onPress={() => setSeverity(s)}
          style={[styles.chip, severity === s && styles.chipOn]} testID={`community-sev-${s}`}>
          <Text style={[styles.chipText, severity === s && styles.chipTextOn]}>{t(`community.severity.${s}` as TranslationKey)}</Text>
        </Pressable>)}
      </View>
      <Text style={styles.label}>{t('community.form.note')}</Text>
      <TextInput value={note} onChangeText={v => setNote(v.slice(0, MAX_NOTE))} multiline style={[styles.input, styles.note]}
        accessibilityLabel={t('community.form.note')} testID="community-note" />
      <Text style={styles.help}>{t('community.form.count', { n: note.length, max: MAX_NOTE })}</Text>
      <Text style={styles.help} testID="community-form-place">{t('community.form.place')}</Text>
      {category === 'fire' && emergency ? <Text style={styles.urgent} testID="community-fire-danger">{t('community.form.fireDanger', { call: emergency })}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void send(); }} style={[styles.primary, busy && styles.disabled]} testID="community-send">
        <Text style={styles.primaryText}>{t('community.form.send')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onCancel} style={styles.secondary} testID="community-form-cancel">
        <Text style={styles.secondaryText}>{t('common.cancel')}</Text>
      </Pressable>
    </>}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite" testID="community-form-error">{error}</Text> : null}
  </View>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    head: { flexDirection: 'row', alignItems: 'center' },
    back: { padding: Spacing.three, minWidth: 48, minHeight: 48, justifyContent: 'center' },
    content: { padding: Spacing.four, paddingBottom: 80, gap: Spacing.three },
    section: { color: colors.text, fontSize: Type.title, fontWeight: '700', marginTop: Spacing.two },
    card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    cardUrgent: { borderColor: colors.error, borderWidth: 2 },
    cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
    cardTitle: { color: colors.text, fontSize: Type.title, fontWeight: '700', flexShrink: 1 },
    badge: { fontSize: Type.caption, fontWeight: '700', paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', color: colors.text },
    badgeHigh: { backgroundColor: colors.errorBackground },
    badgeMid: { backgroundColor: colors.warningBackground },
    badgeLow: { backgroundColor: colors.divider },
    body: { color: colors.text, fontSize: Type.body, lineHeight: 22 },
    help: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 20 },
    label: { color: colors.text, fontSize: Type.body, fontWeight: '600' },
    urgent: { color: colors.error, fontSize: Type.body, lineHeight: 22, fontWeight: '700' },
    warning: { color: colors.warning, fontSize: Type.body, lineHeight: 22, fontWeight: '600' },
    ok: { color: colors.success, fontSize: Type.body, lineHeight: 22 },
    error: { color: colors.error, fontSize: Type.body, lineHeight: 22 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
    chip: { minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
    chipText: { color: colors.text, fontSize: Type.body },
    chipTextOn: { color: colors.white, fontWeight: '700' },
    input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: Radius.sm, paddingHorizontal: Spacing.three, color: colors.text, fontSize: Type.body },
    note: { minHeight: 80, textAlignVertical: 'top', paddingTop: Spacing.two },
    primary: { minHeight: 52, borderRadius: Radius.sm, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
    primaryText: { color: colors.white, fontSize: Type.body, fontWeight: '700' },
    secondary: { minHeight: 48, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
    secondaryText: { color: colors.primaryDark, fontSize: Type.body, fontWeight: '600', textAlign: 'center' },
    fireBox: { gap: Spacing.two, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    disabled: { opacity: 0.5 },
  });
}
