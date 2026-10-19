import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { BlurSheet } from '@/components/BlurSheet';
import { createTodayStyles } from '@/styles/todayStyles';
import { logManualWatering, logSoilFeel, type SoilFeel } from '@/services/agroFlowApi';
import { WATERED_MINUTES } from '@/lib/setupHelpers';
import { useI18n, type TranslationKey } from '@/i18n';

type Props = {
  zoneId: number;
  zoneName: string;
  mode: 'water' | 'feel' | null;
  onClose: () => void;
  onSaved: () => void;
};

const FEELS: { key: SoilFeel; label: TranslationKey; hint: TranslationKey }[] = [
  { key: 'dry', label: 'log.dry', hint: 'log.dryHint' },
  { key: 'moist', label: 'log.moist', hint: 'log.moistHint' },
  { key: 'wet', label: 'log.wet', hint: 'log.wetHint' },
];

// "I watered" and "How does the soil feel?" for a farm without a kit, or with an offline
// kit. Both count in today's advice, are marked as entered by hand, and show in reports
// and history. It uses the single-flight write path, so a double tap logs one watering.
export function ManualLogSheet({ zoneId, zoneName, mode, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [litres, setLitres] = useState('');

  const close = useCallback(() => {
    setMessage(null);
    setError(null);
    setLitres('');
    onClose();
  }, [onClose]);

  // A soil check comes back as "sent" or "kept on the phone" (offline); a watering is sent now.
  const run = useCallback(
    (send: () => Promise<{ message: string } | { queued: true } | { queued: false; result: { message: string } }>) => {
      setBusy(true);
      setMessage(null);
      setError(null);
      send()
        .then((r) => {
          if ('queued' in r) {
            setMessage(r.queued ? t('offline.savedForLater') : r.result.message);
            if (!r.queued) onSaved();
            return;
          }
          setMessage(r.message);
          onSaved();
        })
        .catch((e: unknown) => {
          setError(e instanceof Error && e.message ? e.message : t('log.failed'));
        })
        .finally(() => setBusy(false));
    },
    [onSaved, t]
  );

  const litresNumber = Number(litres.replace(',', '.'));

  return (
    <BlurSheet
      visible={mode !== null}
      onClose={close}
      title={mode === 'feel' ? t('log.feelTitle', { zone: zoneName }) : t('log.wateredTitle', { zone: zoneName })}
    >
      <View style={styles.sheet}>
        {mode === 'water' ? (
          <>
            <Text style={styles.intro}>{t('log.howLong')}</Text>
            <View style={styles.choices}>
              {WATERED_MINUTES.map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  accessibilityLabel={t('log.wateredFor', { minutes: m })}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => run(() => logManualWatering(zoneId, { minutes: m }))}
                  style={[styles.choice, busy && styles.busy]}
                >
                  <Text style={styles.choiceText}>{t('log.minutes', { minutes: m })}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>{t('log.orLitres')}</Text>
            <TextInput
              accessibilityLabel={t('log.litresLabel')}
              keyboardType="decimal-pad"
              value={litres}
              onChangeText={setLitres}
              placeholder={t('log.litresPlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('log.saveLitres')}
              accessibilityState={{ disabled: busy || !(litresNumber > 0) }}
              disabled={busy || !(litresNumber > 0)}
              onPress={() => run(() => logManualWatering(zoneId, { litres: litresNumber }))}
              style={[styles.button, (busy || !(litresNumber > 0)) && styles.busy]}
            >
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>{t('log.saveLitres')}</Text>}
            </Pressable>
          </>
        ) : mode === 'feel' ? (
          <>
            <Text style={styles.intro}>{t('log.feelIntro')}</Text>
            <View style={styles.choices}>
              {FEELS.map((f) => (
                <Pressable
                  key={f.key}
                  accessibilityRole="button"
                  accessibilityLabel={t('log.feels', { feel: t(f.label).toLowerCase() })}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => run(() => logSoilFeel(zoneId, f.key))}
                  style={[styles.choice, busy && styles.busy]}
                >
                  <Text style={styles.choiceText}>{t(f.label)}</Text>
                  <Text style={styles.choiceHint}>{t(f.hint)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      </View>
    </BlurSheet>
  );
}
