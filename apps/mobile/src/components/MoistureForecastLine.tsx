import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, Type } from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';
import { fetchMoistureForecast, type MoistureForecast } from '@/services/agroFlowApi';

// One extra line under the zone's advice: the machine learning model's guess at when
// the soil will need water. It never replaces the advice above it, and it shows
// nothing at all when the zone has too little data or the request fails.
export function MoistureForecastLine({ zoneId }: { zoneId: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    box: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, borderRadius: Radius.sm, padding: Spacing.three, gap: Spacing.one },
    label: { color: colors.textSecondary, fontSize: Type.caption, fontWeight: '600' },
    text: { color: colors.text, fontSize: Type.body },
    note: { color: colors.textMuted, fontSize: Type.caption },
  }), [colors]);
  const [forecast, setForecast] = useState<MoistureForecast | null>(null);

  useEffect(() => {
    let live = true;
    fetchMoistureForecast(zoneId)
      .then(f => { if (live) setForecast(f); })
      .catch(() => { if (live) setForecast(null); });
    return () => { live = false; };
  }, [zoneId]);

  if (!forecast?.available || !forecast.text) return null;

  const notes = [
    forecast.simulatedData ? 'Simulated readings' : null,
    forecast.trainedOnSimulatedOnly ? 'Model trained on Simulated farm data' : null,
  ].filter(Boolean).join(' · ');

  return <View style={styles.box} accessibilityLabel={`${forecast.label}: ${forecast.text}`}>
    <Text style={styles.label}>{forecast.label}</Text>
    <Text style={styles.text}>{forecast.text}</Text>
    {notes ? <Text style={styles.note}>{notes}</Text> : null}
  </View>;
}
