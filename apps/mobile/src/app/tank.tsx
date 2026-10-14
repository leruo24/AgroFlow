import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';
import { router } from '@/lib/router';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Radius, Spacing, Type } from '@/constants/colors';
import { fetchTankStatus, logTankRefill, saveTankCapacity, type TankStatus } from '@/services/agroFlowApi';

export default function TankScreen() {
  const { farm } = useAgroFlow();
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    head: { flexDirection: 'row', alignItems: 'center' },
    back: { padding: Spacing.three },
    content: { padding: Spacing.four, paddingBottom: 80, gap: Spacing.three },
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
  const [refilledAt, setRefilledAt] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!farm) { setLoading(false); return; }
    setLoading(true);
    fetchTankStatus(farm.id)
      .then(value => { setStatus(value); setCapacity(value.capacityLitres == null ? '' : String(value.capacityLitres)); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load tank details.'))
      .finally(() => setLoading(false));
  }, [farm]);
  useFocusEffect(load);

  const saveCapacity = () => {
    if (!farm) return;
    const value = Number(capacity.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) { setError('Tank size must be greater than 0 litres.'); return; }
    setBusy(true); setError(null); setMessage(null);
    saveTankCapacity(farm.id, Math.round(value * 10) / 10)
      .then(value => { setStatus(value); setMessage('Tank size saved.'); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save the tank size.'))
      .finally(() => setBusy(false));
  };

  const saveRefill = () => {
    if (!farm || !status?.capacityLitres) { setError('Set the tank size before logging a refill.'); return; }
    const amount = Number(litres.replace(',', '.'));
    const ph = waterPh.trim() ? Number(waterPh.replace(',', '.')) : null;
    const at = new Date(refilledAt);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Litres added must be greater than 0.'); return; }
    if (amount > status.capacityLitres) { setError('Litres added cannot be greater than the tank size.'); return; }
    if (ph !== null && (!Number.isFinite(ph) || ph < 0 || ph > 14)) { setError('pH must be between 0 and 14.'); return; }
    if (Number.isNaN(at.getTime())) { setError('Enter a valid refill date and time.'); return; }
    setBusy(true); setError(null); setMessage(null);
    logTankRefill(farm.id, { litresAdded: Math.round(amount * 10) / 10, waterPh: ph === null ? null : Math.round(ph * 10) / 10, refilledAt: at.toISOString() })
      .then(result => {
        setStatus(result.status); setLitres(''); setWaterPh(''); setRefilledAt(new Date().toISOString());
        setMessage(result.comparison ?? 'Refill logged.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not log the refill.'))
      .finally(() => setBusy(false));
  };

  return <SafeAreaView style={styles.page} edges={['top']}>
    <View style={styles.head}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}><ArrowLeft size={22} color={colors.text} /></Pressable>
      <View style={{ flex: 1 }}><ScreenHeader title="Water tank" subtitle={farm?.name} /></View>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator color={colors.primaryDark} /> : status?.estimatedRemainingLitres != null ? <View style={styles.section}>
        <Text style={styles.estimate}>About {Math.round(status.estimatedRemainingLitres)} L left — estimate</Text>
        <Text style={styles.help}>Based on the last refill minus recorded pump runtime × each zone’s flow rate.</Text>
        {status.latestWaterPh != null ? <Text style={styles.help}>Latest water pH: {Number(status.latestWaterPh).toFixed(1)}</Text> : null}
        {status.waterPhWarning ? <Text style={styles.warning}>{status.waterPhWarning}</Text> : null}
      </View> : <Text style={styles.help}>{status?.capacityLitres ? 'No refill logged yet.' : 'Tank tracking is not set up yet.'}</Text>}

      <View style={styles.section}>
        <Text style={styles.title}>Tank size</Text>
        <TextInput accessibilityLabel="Tank size in litres" keyboardType="decimal-pad" value={capacity} onChangeText={setCapacity} placeholder="Capacity in litres" placeholderTextColor={colors.textMuted} style={styles.input} />
        <Pressable accessibilityRole="button" disabled={busy} onPress={saveCapacity} style={[styles.button, busy && { opacity: 0.55 }]}><Text style={styles.buttonText}>Save tank size</Text></Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Log a refill</Text>
        <Text style={styles.label}>Litres added</Text>
        <TextInput accessibilityLabel="Litres added" keyboardType="decimal-pad" value={litres} onChangeText={setLitres} placeholder="e.g. 750" placeholderTextColor={colors.textMuted} style={styles.input} />
        <Text style={styles.label}>Water pH (optional)</Text>
        <TextInput accessibilityLabel="Water pH" keyboardType="decimal-pad" value={waterPh} onChangeText={setWaterPh} placeholder="0.0 to 14.0" placeholderTextColor={colors.textMuted} style={styles.input} />
        <Text style={styles.label}>Date and time</Text>
        <TextInput accessibilityLabel="Refill date and time" value={refilledAt} onChangeText={setRefilledAt} autoCapitalize="none" style={styles.input} />
        <Text style={styles.help}>Defaults to now. You can replace it with another ISO date and time.</Text>
        <Pressable accessibilityRole="button" disabled={busy || !status?.capacityLitres} onPress={saveRefill} style={[styles.button, (busy || !status?.capacityLitres) && { opacity: 0.55 }]}><Text style={styles.buttonText}>{busy ? 'Saving…' : 'Log refill'}</Text></Pressable>
      </View>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
