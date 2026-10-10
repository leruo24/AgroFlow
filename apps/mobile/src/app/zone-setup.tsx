// Finish setup. Reached as /zone-setup?zoneId=123 from a Home card.
// The checklist of what today's advice is missing for one zone: planting date, soil, size,
// flow rate and (with a kit) the wet/dry setup. Each item saves on its own and the
// confidence at the top is re-read afterwards, so the farmer sees the advice get surer.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { router } from '@/lib/router';
import { useTheme } from '@/context/ThemeContext';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { WhyLink } from '@/components/WhySheet';
import { CalibrateSoilSheet } from '@/components/CalibrateSoilSheet';
import { RecommendedCard } from '@/components/RecommendedCard';
import { createTodayStyles } from '@/styles/todayStyles';
import { fetchFarmToday, saveZoneSetup, type TodayZone } from '@/services/agroFlowApi';
import { AREA_PRESETS, BOTTLE_LITRES, flowRateFromBottle, plantedWeeksAgo } from '@/lib/setupHelpers';

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export default function ZoneSetupScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const { farm } = useAgroFlow();
  const params = useLocalSearchParams<{ zoneId?: string }>();
  const zoneId = Number(params.zoneId);

  const [zone, setZone] = useState<TodayZone | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState('');
  const [customArea, setCustomArea] = useState('');
  const [seconds, setSeconds] = useState('');
  const [calibrating, setCalibrating] = useState(false);

  const load = useCallback(() => {
    if (!farm) return;
    fetchFarmToday(farm.id)
      .then((r) => {
        const found = r.zones.find((z) => z.zoneId === zoneId) ?? null;
        setZone(found);
        setLoadError(found ? null : 'This zone was not found on your farm.');
      })
      .catch(() => setLoadError('Could not load this zone right now.'));
  }, [farm, zoneId]);

  // Re-read on focus: coming back from the soil screen ticks Soil off.
  useFocusEffect(load);

  const save = useCallback(
    (key: string, body: Parameters<typeof saveZoneSetup>[1]) => {
      setBusy(key);
      setMessage(null);
      setError(null);
      saveZoneSetup(zoneId, body)
        .then((r) => {
          setMessage(r.message);
          load();
        })
        .catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : 'Could not save that right now.'))
        .finally(() => setBusy(null));
    },
    [zoneId, load]
  );

  const plantingDate = plantedWeeksAgo(Number(weeks), new Date());
  const area = Number(customArea.replace(',', '.'));
  const flow = flowRateFromBottle(Number(seconds.replace(',', '.')));
  const setup = zone?.setup;

  const Status = ({ done }: { done: boolean | undefined }) =>
    <Text style={done ? styles.done : styles.todo}>{done ? 'Done' : 'To do'}</Text>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={{ padding: 12 }}>
          <ArrowLeft size={22} color={colors.text} strokeWidth={1.8} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <ScreenHeader title="Finish setup" subtitle={zone?.name} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
        {!zone && !loadError ? <ActivityIndicator color={colors.primaryDark} /> : null}

        {zone?.confidence && (
          <View style={styles.badgeRow} accessibilityLabel={`Advice confidence: ${LEVEL_LABEL[zone.confidence.level]}. ${zone.confidence.reason}`}>
            <Text style={styles.badge}>{LEVEL_LABEL[zone.confidence.level]} confidence</Text>
            <WhyLink explanation={zone.confidenceExplanation} compact />
          </View>
        )}
        {zone?.confidence ? <Text style={styles.help}>{zone.confidence.reason}</Text> : null}

        {zone && (
          <>
            <View style={styles.item}>
              <View style={styles.itemHead}><Text style={styles.label}>Planting date</Text><Status done={setup?.plantingDate} /></View>
              <Text style={styles.help}>Planted about how many weeks ago?</Text>
              <TextInput accessibilityLabel="Weeks since planting" keyboardType="number-pad" value={weeks} onChangeText={setWeeks}
                placeholder="e.g. 3" placeholderTextColor={colors.textMuted} style={styles.input} />
              <Pressable accessibilityRole="button" accessibilityLabel="Save planting date"
                disabled={busy !== null || !plantingDate} onPress={() => plantingDate && save('planting', { plantingDate })}
                style={[styles.button, (busy !== null || !plantingDate) && styles.busy]}>
                <Text style={styles.buttonText}>Save</Text>
              </Pressable>
            </View>

            <View style={styles.item}>
              <View style={styles.itemHead}><Text style={styles.label}>Soil</Text><Status done={setup?.soil} /></View>
              <Pressable accessibilityRole="button"
                onPress={() => router.push({ pathname: '/zone-soil', params: { zoneId: String(zoneId), zoneName: zone.name } })}
                style={styles.ghost}>
                <Text style={styles.ghostText}>Choose soil</Text>
              </Pressable>
            </View>

            <View style={styles.item}>
              <View style={styles.itemHead}><Text style={styles.label}>Size</Text><Status done={setup?.area} /></View>
              <View style={styles.choices}>
                {AREA_PRESETS.map((p) => (
                  <Pressable key={p.key} accessibilityRole="button" disabled={busy !== null}
                    onPress={() => save('area', { areaM2: p.m2 })} style={[styles.choice, busy !== null && styles.busy]}>
                    <Text style={styles.choiceText}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput accessibilityLabel="Watered area in square metres" keyboardType="decimal-pad" value={customArea}
                onChangeText={setCustomArea} placeholder="Or the area in m²" placeholderTextColor={colors.textMuted} style={styles.input} />
              <Pressable accessibilityRole="button" accessibilityLabel="Save area" disabled={busy !== null || !(area > 0)}
                onPress={() => save('area', { areaM2: area })} style={[styles.button, (busy !== null || !(area > 0)) && styles.busy]}>
                <Text style={styles.buttonText}>Save area</Text>
              </Pressable>
            </View>

            <View style={styles.item}>
              <View style={styles.itemHead}><Text style={styles.label}>Flow rate</Text><Status done={setup?.flowRate} /></View>
              <Text style={styles.help}>
                Time how many seconds your tap or pump takes to fill a {BOTTLE_LITRES * 1000} mL bottle.
              </Text>
              <TextInput accessibilityLabel="Seconds to fill the bottle" keyboardType="decimal-pad" value={seconds}
                onChangeText={setSeconds} placeholder="Seconds, e.g. 15" placeholderTextColor={colors.textMuted} style={styles.input} />
              {flow != null ? <Text style={styles.help}>That is about {flow} litres a minute.</Text> : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Save flow rate" disabled={busy !== null || flow == null}
                onPress={() => flow != null && save('flow', { flowRateLpm: flow })}
                style={[styles.button, (busy !== null || flow == null) && styles.busy]}>
                <Text style={styles.buttonText}>Save flow rate</Text>
              </Pressable>
            </View>

            {setup?.hasKit && (
              <View style={styles.item}>
                <View style={styles.itemHead}><Text style={styles.label}>Soil sensor wet/dry setup</Text><Status done={setup.calibrated} /></View>
                <Pressable accessibilityRole="button" onPress={() => setCalibrating(true)} style={styles.ghost}>
                  <Text style={styles.ghostText}>Set up the sensor</Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}

        {/* Re-read after every save, so it follows the setup. */}
        {zone && <RecommendedCard key={JSON.stringify(zone.setup ?? null)} zoneId={zoneId} />}
      </ScrollView>

      {Number.isFinite(zoneId) && (
        <CalibrateSoilSheet zoneId={zoneId} visible={calibrating} onClose={() => setCalibrating(false)} onSaved={load} />
      )}
    </SafeAreaView>
  );
}
