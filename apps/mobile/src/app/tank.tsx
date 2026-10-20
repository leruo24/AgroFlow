import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { router } from '@/lib/router';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Radius, Spacing, Type, Layout } from '@/constants/colors';
import { fetchTankStatus, logTankRefill, saveTankCapacity, type TankStatus } from '@/services/agroFlowApi';
import { useI18n } from '@/i18n';
import { useBottomPadding } from '@/hooks/useScreenPadding';

export default function TankScreen() {
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(false);
  const { farm } = useAgroFlow();
  const { colors } = useTheme();
  const { t } = useI18n();
  // From Home's "Log a tank refill": the litres box is ready for typing, one tap fewer.
  const { refill } = useLocalSearchParams<{ refill?: string }>();
  const styles = useMemo(() => StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    head: { flexDirection: 'row', alignItems: 'center' },
    back: { padding: Spacing.three, minWidth: 48, minHeight: 48, justifyContent: 'center' },
    content: { padding: Layout.gutter, gap: Spacing.three },
    section: { gap: Spacing.two, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    title: { color: colors.text, fontSize: Type.title, fontWeight: '600' },
    estimate: { color: colors.text, fontSize: 25, lineHeight: 32, fontWeight: '600' },
    help: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 20 },
    label: { color: colors.text, fontSize: Type.body, fontWeight: '600' },
    input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: Radius.sm, paddingHorizontal: Spacing.three, color: colors.text, fontSize: Type.body },
    button: { minHeight: 50, borderRadius: Radius.sm, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: colors.white, fontSize: Type.body, fontWeight: '600' },
    message: { color: colors.success, fontSize: Type.body, lineHeight: 22 },
    warning: { color: colors.warning, fontSize: Type.body, lineHeight: 22 },
    error: { color: colors.error, fontSize: Type.body, lineHeight: 22 },
  }), [colors]);
  const [status, setStatus] = useState<TankStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [capacity, setCapacity] = useState('');
  const [litres, setLitres] = useState('');
  const [waterPh, setWaterPh] = useState('');
  // Empty means "now", worked out when Save is pressed, so a form left open still logs the
  // right time. A farmer who refilled earlier types the time instead.
  const [refilledAt, setRefilledAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Focused once the tank has loaded (and has a size), not on mount, when it is still unknown.
  const litresInput = useRef<TextInput>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (refill !== '1' || focused.current || !status?.capacityLitres) return;
    focused.current = true;
    litresInput.current?.focus();
  }, [refill, status?.capacityLitres]);

  const load = useCallback(() => {
    if (!farm) { setLoading(false); return; }
    setLoading(true);
    fetchTankStatus(farm.id)
      .then(value => { setStatus(value); setCapacity(value.capacityLitres == null ? '' : String(value.capacityLitres)); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('tank.loadFailed')))
      .finally(() => setLoading(false));
  }, [farm, t]);
  useFocusEffect(load);

  const saveCapacity = () => {
    if (!farm) return;
    const value = Number(capacity.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) { setError(t('tank.sizeInvalid')); return; }
    setBusy(true); setError(null); setMessage(null);
    saveTankCapacity(farm.id, Math.round(value * 10) / 10)
      .then(value => { setStatus(value); setMessage(t('tank.sizeSaved')); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('tank.sizeFailed')))
      .finally(() => setBusy(false));
  };

  const saveRefill = () => {
    if (!farm || !status?.capacityLitres) { setError(t('tank.needSize')); return; }
    const amount = Number(litres.replace(',', '.'));
    const ph = waterPh.trim() ? Number(waterPh.replace(',', '.')) : null;
    const at = refilledAt.trim() ? new Date(refilledAt.trim()) : new Date();
    if (!Number.isFinite(amount) || amount <= 0) { setError(t('tank.litresInvalid')); return; }
    if (amount > status.capacityLitres) { setError(t('tank.litresTooMany')); return; }
    if (ph !== null && (!Number.isFinite(ph) || ph < 0 || ph > 14)) { setError(t('tank.phInvalid')); return; }
    if (Number.isNaN(at.getTime())) { setError(t('tank.whenInvalid')); return; }
    setBusy(true); setError(null); setMessage(null);
    // Offline, the refill is kept on the phone with its time and sent on reconnect.
    logTankRefill(farm.id, { litresAdded: Math.round(amount * 10) / 10, waterPh: ph === null ? null : Math.round(ph * 10) / 10, refilledAt: at.toISOString() })
      .then(sent => {
        setLitres(''); setWaterPh(''); setRefilledAt('');
        if (sent.queued) { setMessage(t('offline.savedForLater')); return; }
        setStatus(sent.result.status);
        setMessage(sent.result.comparison ?? t('tank.saved'));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('tank.refillFailed')))
      .finally(() => setBusy(false));
  };

  return <SafeAreaView style={styles.page} edges={['top']}>
    <View style={styles.head}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}><ArrowLeft size={22} color={colors.text} /></Pressable>
      <View style={{ flex: 1 }}><ScreenHeader title={t('tank.title')} subtitle={farm?.name} /></View>
    </View>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator color={colors.primaryDark} /> : status?.estimatedRemainingLitres != null ? <View style={styles.section}>
        <Text style={styles.estimate}>{t('home.tankLeft', { litres: Math.round(status.estimatedRemainingLitres) })}</Text>
        <Text style={styles.help}>{t('tank.estimateHelp')}</Text>
        {status.latestWaterPh != null ? <Text style={styles.help}>{t('tank.latestPh', { ph: Number(status.latestWaterPh).toFixed(1) })}</Text> : null}
        {status.waterPhWarning ? <Text style={styles.warning}>{status.waterPhWarning}</Text> : null}
      </View> : <Text style={styles.help}>{status?.capacityLitres ? t('tank.noRefill') : t('tank.notSetUp')}</Text>}

      {/* Logging a refill is the everyday job, so it comes first; the tank size is set once. */}
      <View style={styles.section}>
        <Text style={styles.title}>{t('tank.logRefill')}</Text>
        <Text style={styles.label}>{t('tank.litresAdded')}</Text>
        <TextInput ref={litresInput} accessibilityLabel={t('tank.litresAdded')} keyboardType="decimal-pad" value={litres} onChangeText={setLitres} placeholder={t('tank.litresPlaceholder')} placeholderTextColor={colors.textMuted} style={styles.input} />
        <Text style={styles.label}>{t('tank.waterPh')}</Text>
        <TextInput accessibilityLabel={t('tank.waterPh')} keyboardType="decimal-pad" value={waterPh} onChangeText={setWaterPh} placeholder={t('tank.phPlaceholder')} placeholderTextColor={colors.textMuted} style={styles.input} />
        <Text style={styles.label}>{t('tank.when')}</Text>
        <TextInput accessibilityLabel={t('tank.when')} value={refilledAt} onChangeText={setRefilledAt} autoCapitalize="none" placeholder={t('tank.whenNow')} placeholderTextColor={colors.textMuted} style={styles.input} />
        <Text style={styles.help}>{t('tank.whenHelp')}</Text>
        <Pressable accessibilityRole="button" disabled={busy || !status?.capacityLitres} onPress={saveRefill} style={[styles.button, (busy || !status?.capacityLitres) && { opacity: 0.55 }]}><Text style={styles.buttonText}>{busy ? t('common.saving') : t('tank.save')}</Text></Pressable>
        {!loading && !status?.capacityLitres ? <Text style={styles.help}>{t('tank.needSize')}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>{t('tank.size')}</Text>
        <TextInput accessibilityLabel={t('tank.sizeLabel')} keyboardType="decimal-pad" value={capacity} onChangeText={setCapacity} placeholder={t('tank.sizePlaceholder')} placeholderTextColor={colors.textMuted} style={styles.input} />
        <Pressable accessibilityRole="button" disabled={busy} onPress={saveCapacity} style={[styles.button, busy && { opacity: 0.55 }]}><Text style={styles.buttonText}>{t('tank.saveSize')}</Text></Pressable>
      </View>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
