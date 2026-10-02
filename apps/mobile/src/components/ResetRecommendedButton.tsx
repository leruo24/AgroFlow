import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { RotateCcw } from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import { createZoneInsightsStyles } from '@/styles/zoneInsightsStyles';
import { resetZoneToRecommended } from '@/services/agroFlowApi';

type Props = {
  zoneId: number;
  onReset?: (threshold: number, desired: number) => void;
};

// Sets this zone's watering levels back to the FAO-56 recommendation for its crop
// and soil.
//
// When something is missing the backend answers with the plain sentence saying
// what to add ("Do the wet and dry soil setup first"), and that sentence is shown
// as-is. The component does not try to work out what is missing itself - there
// would then be two places that could disagree about it.
export function ResetRecommendedButton({ zoneId, onReset }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createZoneInsightsStyles(colors), [colors]);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setBusy(true);
    setMessage(null);
    setError(null);

    resetZoneToRecommended(zoneId)
      .then((result) => {
        setMessage(result.message);
        onReset?.(result.threshold, result.desired);
      })
      .catch((e: unknown) => {
        setError(
          e instanceof Error && e.message
            ? e.message
            : 'Could not reset this zone right now.'
        );
      })
      .finally(() => setBusy(false));
  }, [zoneId, onReset]);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset watering levels to recommended"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={reset}
        style={[styles.resetButton, busy && styles.resetButtonBusy]}
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryDark} />
        ) : (
          <RotateCcw size={18} color={colors.primaryDark} strokeWidth={1.7} />
        )}
        <Text style={styles.resetButtonText}>Reset to recommended</Text>
      </Pressable>

      {message ? (
        <Text style={styles.resetResult} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.resetError} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
