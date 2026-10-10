import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { BlurSheet } from '@/components/BlurSheet';
import { createTodayStyles } from '@/styles/todayStyles';
import { logManualWatering, logSoilFeel, type SoilFeel } from '@/services/agroFlowApi';
import { WATERED_MINUTES } from '@/lib/setupHelpers';

type Props = {
  zoneId: number;
  zoneName: string;
  mode: 'water' | 'feel' | null;
  onClose: () => void;
  onSaved: () => void;
};

const FEELS: { key: SoilFeel; label: string; hint: string }[] = [
  { key: 'dry', label: 'Dry', hint: 'Crumbles, no dampness on your finger' },
  { key: 'moist', label: 'Moist', hint: 'Cool and holds together' },
  { key: 'wet', label: 'Wet', hint: 'Sticky, water on your finger' },
];

// "I watered" and "How does the soil feel?" for a farm without a kit, or with an offline
// kit. Both count in today's advice, are marked as entered by hand, and show in reports
// and history. It uses the single-flight write path, so a double tap logs one watering.
export function ManualLogSheet({ zoneId, zoneName, mode, onClose, onSaved }: Props) {
  const { colors } = useTheme();
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

  const run = useCallback(
    (send: () => Promise<{ message: string }>) => {
      setBusy(true);
      setMessage(null);
      setError(null);
      send()
        .then((r) => {
          setMessage(r.message);
          onSaved();
        })
        .catch((e: unknown) => {
          setError(e instanceof Error && e.message ? e.message : 'Could not save that right now.');
        })
        .finally(() => setBusy(false));
    },
    [onSaved]
  );

  const litresNumber = Number(litres.replace(',', '.'));

  return (
    <BlurSheet
      visible={mode !== null}
      onClose={close}
      title={mode === 'feel' ? `How does the soil feel? ${zoneName}` : `I watered ${zoneName}`}
    >
      <View style={styles.sheet}>
        {mode === 'water' ? (
          <>
            <Text style={styles.intro}>About how long did you water?</Text>
            <View style={styles.choices}>
              {WATERED_MINUTES.map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  accessibilityLabel={`I watered for ${m} minutes`}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => run(() => logManualWatering(zoneId, { minutes: m }))}
                  style={[styles.choice, busy && styles.busy]}
                >
                  <Text style={styles.choiceText}>{m} min</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Or roughly how many litres?</Text>
            <TextInput
              accessibilityLabel="Litres watered"
              keyboardType="decimal-pad"
              value={litres}
              onChangeText={setLitres}
              placeholder="e.g. 10"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save litres watered"
              accessibilityState={{ disabled: busy || !(litresNumber > 0) }}
              disabled={busy || !(litresNumber > 0)}
              onPress={() => run(() => logManualWatering(zoneId, { litres: litresNumber }))}
              style={[styles.button, (busy || !(litresNumber > 0)) && styles.busy]}
            >
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save litres</Text>}
            </Pressable>
          </>
        ) : mode === 'feel' ? (
          <>
            <Text style={styles.intro}>Push a finger into the soil, about two knuckles deep.</Text>
            <View style={styles.choices}>
              {FEELS.map((f) => (
                <Pressable
                  key={f.key}
                  accessibilityRole="button"
                  accessibilityLabel={`The soil feels ${f.label.toLowerCase()}`}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => run(() => logSoilFeel(zoneId, f.key))}
                  style={[styles.choice, busy && styles.busy]}
                >
                  <Text style={styles.choiceText}>{f.label}</Text>
                  <Text style={styles.choiceHint}>{f.hint}</Text>
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
