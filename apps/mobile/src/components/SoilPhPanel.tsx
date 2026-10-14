import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Radius, Spacing, Type } from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';
import { fetchSoilPh, logSoilPh, type SoilPhEntry } from '@/services/agroFlowApi';

export function SoilPhPanel({ zoneId }: { zoneId: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    panel: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, borderRadius: Radius.sm, padding: Spacing.three, gap: Spacing.two },
    title: { color: colors.text, fontSize: Type.title, fontWeight: '600' },
    value: { color: colors.text, fontSize: 24, fontWeight: '600' },
    help: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 20 },
    input: { minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: Radius.sm, paddingHorizontal: Spacing.three, color: colors.text, backgroundColor: colors.surface },
    button: { minHeight: 48, borderRadius: Radius.sm, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: colors.white, fontSize: Type.body, fontWeight: '600' },
    error: { color: colors.error, fontSize: Type.caption },
    success: { color: colors.primaryDark, fontSize: Type.caption },
    history: { paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    historyText: { color: colors.text, fontSize: Type.body },
  }), [colors]);
  const [entries, setEntries] = useState<SoilPhEntry[] | null>(null);
  const [ph, setPh] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    fetchSoilPh(zoneId).then(r => { setEntries(r.entries); setError(null); })
      .catch(() => setError('Could not load soil pH history.'));
  }, [zoneId]);
  useEffect(load, [load]);

  const save = () => {
    const value = Number(ph.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > 14) {
      setError('pH must be between 0 and 14.'); return;
    }
    setBusy(true); setError(null); setSaved(false);
    logSoilPh(zoneId, { ph: Math.round(value * 10) / 10, measuredAt: new Date().toISOString(), note: note.trim() || null })
      .then(() => { setPh(''); setNote(''); setSaved(true); load(); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save soil pH.'))
      .finally(() => setBusy(false));
  };

  const latest = entries?.[0];
  return <View style={styles.panel}>
    <Text style={styles.title}>Soil pH</Text>
    {entries === null && !error ? <ActivityIndicator color={colors.primaryDark} /> : latest ? <>
      <Text style={styles.value}>{Number(latest.ph).toFixed(1)}</Text>
      <Text style={styles.help}>Measured {new Date(latest.measuredAt).toLocaleDateString()}{latest.note ? ` — ${latest.note}` : ''}</Text>
    </> : <Text style={styles.help}>No soil pH has been logged for this zone.</Text>}
    <TextInput accessibilityLabel="Soil pH" keyboardType="decimal-pad" value={ph} onChangeText={setPh} placeholder="pH, e.g. 6.8" placeholderTextColor={colors.textMuted} style={styles.input} />
    <TextInput accessibilityLabel="Soil pH note" value={note} onChangeText={setNote} maxLength={500} placeholder="Optional note" placeholderTextColor={colors.textMuted} style={styles.input} />
    <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={[styles.button, busy && { opacity: 0.55 }]}>
      <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Log soil pH'}</Text>
    </Pressable>
    {saved ? <Text accessibilityLiveRegion="polite" style={styles.success}>Soil pH saved.</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {(entries?.length ?? 0) > 1 ? <View style={styles.history}>
      <Text style={styles.help}>History</Text>
      {entries!.slice(1, 6).map(entry => <Text key={entry.id} style={styles.historyText}>
        {Number(entry.ph).toFixed(1)} · {new Date(entry.measuredAt).toLocaleDateString()}{entry.note ? ` · ${entry.note}` : ''}
      </Text>)}
    </View> : null}
  </View>;
}
