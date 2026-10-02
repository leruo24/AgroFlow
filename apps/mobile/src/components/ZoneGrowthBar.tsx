import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { createZoneInsightsStyles } from '@/styles/zoneInsightsStyles';

type Props = {
  // Farmer-facing stage name: Establishing, Growing, Peak growth,
  // Nearing harvest or Season complete. The engine supplies it already
  // translated - no FAO stage names reach this component.
  stage: string | null | undefined;
  dayOfSeason: number | null | undefined;
  totalDays: number | null | undefined;
  cropLabel?: string | null;
};

// "Peak growth, day 62 of 140" with a progress bar.
//
// Renders nothing at all when the planting date is unknown, rather than a bar at
// zero: an empty bar reads as "the season has not started", which is a claim the
// app cannot make.
export function ZoneGrowthBar({ stage, dayOfSeason, totalDays, cropLabel }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createZoneInsightsStyles(colors), [colors]);

  if (!stage || !dayOfSeason || !totalDays || totalDays <= 0) return null;

  const progress = Math.max(0, Math.min(1, dayOfSeason / totalDays));
  const complete = dayOfSeason > totalDays;

  return (
    <View style={styles.growthCard}>
      <View style={styles.growthHeading}>
        <Text style={styles.growthStage}>{stage}</Text>
        <Text style={styles.growthDay}>
          {complete ? 'Season complete' : `day ${dayOfSeason} of ${totalDays}`}
        </Text>
      </View>

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel={
          complete
            ? `${cropLabel ?? 'Crop'} season is complete.`
            : `${cropLabel ?? 'Crop'}: ${stage}, day ${dayOfSeason} of ${totalDays}.`
        }
        accessibilityValue={{ min: 0, max: totalDays, now: Math.min(dayOfSeason, totalDays) }}
      >
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>

      {cropLabel ? <Text style={styles.growthCrop}>{cropLabel}</Text> : null}
    </View>
  );
}
