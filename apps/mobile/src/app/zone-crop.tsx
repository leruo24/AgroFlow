// Crop and planting date. Reached as /zone-crop?zoneId=123&cropType=potato&plantingDate=2026-09-01
// On save the zone updates in the shared database (the admin sees it straight away), the
// server records "Crop changed from Citrus to Potato by {name}", and "Recommended for you"
// shows the new crop's settings.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/lib/router';
import { useTheme } from '@/context/ThemeContext';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RecommendedCard } from '@/components/RecommendedCard';
import { createTodayStyles } from '@/styles/todayStyles';
import { changeZoneCrop, type RecommendedSettings } from '@/services/agroFlowApi';
import { ZONE_CROPS, dayLabel, shiftDate } from '@/lib/setupHelpers';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { Space } from '@/constants/colors';

export default function ZoneCropScreen() {
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(false);
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const { refreshZones } = useAgroFlow();
  const params = useLocalSearchParams<{ zoneId?: string; cropType?: string; plantingDate?: string }>();
  const zoneId = Number(params.zoneId);
  const today = new Date().toISOString().slice(0, 10);

  const [crop, setCrop] = useState<string>(
    ZONE_CROPS.some((c) => c.value === params.cropType) ? String(params.cropType) : ''
  );
  const [planted, setPlanted] = useState<string | null>(
    params.plantingDate && /^\d{4}-\d{2}-\d{2}$/.test(String(params.plantingDate)) ? String(params.plantingDate) : null
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendedSettings | null>(null);

  const save = useCallback(() => {
    if (!crop) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    changeZoneCrop(zoneId, { cropType: crop, plantingDate: planted })
      .then((r) => {
        setMessage(r.message);
        setRecommendation(r.recommendation);
        refreshZones();
      })
      .catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : 'Could not save right now.'))
      .finally(() => setBusy(false));
  }, [zoneId, crop, planted, refreshZones]);

  const step = (days: number) => setPlanted((p) => shiftDate(p ?? today, days, today));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={{ padding: Space.md }}>
          <ArrowLeft size={22} color={colors.text} strokeWidth={1.8} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <ScreenHeader title="Crop and planting date" />
        </View>
      </View>

      <ScrollView contentContainerStyle={[{ padding: Space.lg, gap: Space.sm }, { paddingBottom: bottomPad }]}>
        <Text style={styles.label}>Crop</Text>
        <View style={styles.choices} accessibilityRole="radiogroup">
          {ZONE_CROPS.map((c) => (
            <Pressable
              key={c.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: crop === c.value }}
              onPress={() => setCrop(c.value)}
              style={[styles.choice, crop === c.value && styles.choiceSelected]}
            >
              <Text style={styles.choiceText}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.item}>
          <Text style={styles.label}>Planted on</Text>
          <Text style={styles.action} accessibilityLiveRegion="polite">{planted ? dayLabel(planted) : 'Not set'}</Text>
          <View style={styles.choices}>
            {[
              { label: '− 1 week', days: -7 },
              { label: '− 1 day', days: -1 },
              { label: '+ 1 day', days: 1 },
              { label: '+ 1 week', days: 7 },
            ].map((b) => (
              <Pressable key={b.label} accessibilityRole="button" accessibilityLabel={`Planting date ${b.label}`}
                onPress={() => step(b.days)} style={styles.choice}>
                <Text style={styles.choiceText}>{b.label}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Not sure of the planting date"
              onPress={() => setPlanted(null)} style={styles.choice}>
              <Text style={styles.choiceText}>Not sure</Text>
            </Pressable>
          </View>
          <Text style={styles.help}>Not sure? Leave it: the advice then assumes the crop is at its thirstiest.</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save crop and planting date"
          accessibilityState={{ disabled: busy || !crop }}
          disabled={busy || !crop}
          onPress={save}
          style={[styles.button, (busy || !crop) && styles.busy]}
        >
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save</Text>}
        </Pressable>

        {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}

        {recommendation && <RecommendedCard zoneId={zoneId} recommendation={recommendation} />}
      </ScrollView>
    </SafeAreaView>
  );
}
