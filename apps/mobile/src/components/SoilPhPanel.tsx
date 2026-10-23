import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Radius, Spacing, Type } from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';
import { fetchSoilPh, logSoilPh, type SoilPhEntry } from '@/services/agroFlowApi';
import { useI18n } from '@/i18n';

export function SoilPhPanel({ zoneId }: { zoneId: number }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => StyleSheet.create({
    panel: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, borderRadius: Radius.sm, padding: Spacing.three, gap: Spacing.two },
    title: { color: colors.text, fontSize: Type.title, fontWeight: '600' },
    value: { color: colors.text, fontSize: 24, fontWeight: '600' },
    help: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 20 },
    input: { minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: Radius.sm, paddingHorizontal: Spacing.three, color: colors.text, backgroundColor: colors.surface },
    button: { minHeight: 48, borderRadius: Radius.sm, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center' },
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
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSoilPh(zoneId).then(r => { setEntries(r.entries); setError(null); })
      .catch(() => setError(t('ph.loadFailed')));
  }, [zoneId, t]);
  useEffect(load, [load]);

  const save = () => {
    const value = Number(ph.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > 14) {
      setError(t('ph.invalid')); return;
    }
    setBusy(true); setError(null); setSaved(null);
    // Offline, the reading is kept on the phone with the time it was taken and sent later.
    logSoilPh(zoneId, { ph: Math.round(value * 10) / 10, measuredAt: new Date().toISOString(), note: note.trim() || null })
      .then(sent => {
        setPh(''); setNote('');
        setSaved(sent.queued ? t('offline.savedForLater') : t('ph.saved'));
        if (!sent.queued) load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('ph.failed')))
      .finally(() => setBusy(false));
  };

  const latest = entries?.[0];
  return <View style={styles.panel}>
    <Text style={styles.title}>{t('ph.title')}</Text>
    {entries === null && !error ? <ActivityIndicator color={colors.primaryDark} /> : latest ? <>
      <Text style={styles.value}>{Number(latest.ph).toFixed(1)}</Text>
      <Text style={styles.help}>{t('ph.measured', { date: new Date(latest.measuredAt).toLocaleDateString() })}{latest.note ? ` — ${latest.note}` : ''}</Text>
    </> : <Text style={styles.help}>{t('ph.none')}</Text>}
    <TextInput accessibilityLabel={t('ph.label')} keyboardType="decimal-pad" value={ph} onChangeText={setPh} placeholder={t('ph.placeholder')} placeholderTextColor={colors.textMuted} style={styles.input} />
    <TextInput accessibilityLabel={t('ph.note')} value={note} onChangeText={setNote} maxLength={500} placeholder={t('ph.note')} placeholderTextColor={colors.textMuted} style={styles.input} />
    <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={[styles.button, busy && { opacity: 0.55 }]}>
      <Text style={styles.buttonText}>{busy ? t('common.saving') : t('ph.save')}</Text>
    </Pressable>
    {saved ? <Text accessibilityLiveRegion="polite" style={styles.success}>{saved}</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {(entries?.length ?? 0) > 1 ? <View style={styles.history}>
      <Text style={styles.help}>{t('ph.history')}</Text>
      {entries!.slice(1, 6).map(entry => <Text key={entry.id} style={styles.historyText}>
        {Number(entry.ph).toFixed(1)} · {new Date(entry.measuredAt).toLocaleDateString()}{entry.note ? ` · ${entry.note}` : ''}
      </Text>)}
    </View> : null}
  </View>;
}
