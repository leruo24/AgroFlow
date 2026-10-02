import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { BlurSheet } from '@/components/BlurSheet';
import { createZoneInsightsStyles } from '@/styles/zoneInsightsStyles';
import { saveZoneCalibration } from '@/services/agroFlowApi';

type Props = {
  zoneId: number;
  visible: boolean;
  onClose: () => void;
  onSaved?: (point: 'wet' | 'dry', reading: number) => void;
};

// Teaches the sensor what wet and dry look like in this particular soil.
//
// The two points are saved on separate days by design - soaked soil and properly
// dry soil are a day or more apart - so this is two independent buttons rather
// than a wizard that has to be finished in one sitting.
//
// The reading itself comes from the server (the latest valid one for the zone);
// the app never sends a number, so there is nothing here that can fabricate a
// calibration point.
export function CalibrateSoilSheet({ zoneId, visible, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createZoneInsightsStyles(colors), [colors]);

  const [busy, setBusy] = useState<'wet' | 'dry' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    (point: 'wet' | 'dry') => {
      setBusy(point);
      setMessage(null);
      setError(null);

      saveZoneCalibration(zoneId, point)
        .then((result) => {
          setMessage(result.message);
          onSaved?.(point, result.reading);
        })
        .catch((e: unknown) => {
          // The backend's own words, including "Wet and dry readings are too
          // close. Try again."
          setError(
            e instanceof Error && e.message
              ? e.message
              : 'Could not save that reading right now.'
          );
        })
        .finally(() => setBusy(null));
    },
    [zoneId, onSaved]
  );

  return (
    <BlurSheet visible={visible} onClose={onClose} title="Set up your soil sensor">
      <View style={styles.sheet}>
        <Text style={styles.sheetIntro}>
          This teaches the sensor what wet and dry look like in your soil. Do the
          two steps on different days.
        </Text>

        <View style={styles.step}>
          <Text style={styles.stepLabel}>Step 1: wet soil</Text>
          <Text style={styles.stepHelp}>
            Soak the soil, wait a day, tap Save wet.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save the wet soil reading"
            accessibilityState={{ busy: busy === 'wet', disabled: busy !== null }}
            disabled={busy !== null}
            onPress={() => save('wet')}
            style={[styles.stepButton, busy !== null && styles.stepButtonBusy]}
          >
            {busy === 'wet' ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.stepButtonText}>Save wet</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.step}>
          <Text style={styles.stepLabel}>Step 2: dry soil</Text>
          <Text style={styles.stepHelp}>
            When the soil is properly dry, tap Save dry.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save the dry soil reading"
            accessibilityState={{ busy: busy === 'dry', disabled: busy !== null }}
            disabled={busy !== null}
            onPress={() => save('dry')}
            style={[styles.stepButton, busy !== null && styles.stepButtonBusy]}
          >
            {busy === 'dry' ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.stepButtonText}>Save dry</Text>
            )}
          </Pressable>
        </View>

        {message ? (
          <Text style={styles.sheetMessage} accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
        {error ? (
          <Text style={styles.sheetError} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </BlurSheet>
  );
}
