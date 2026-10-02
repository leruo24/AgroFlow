// Soil type screen. Reached as /zone-soil?zoneId=123&soilType=loam
//
// Soil texture decides how much water the soil can hold and therefore how often
// a zone needs watering, so it is worth asking the farmer rather than assuming.
// Three large cards, plain words, loam pre-selected because it is the most common
// garden soil and the documented assumption for the demo tubs.
//
// ICONS: each card carries its soil icon, rendered with react-native-svg by
// components/SoilIcon.tsx from the artwork in assets/soil/soil_*.svg. The
// drawing commands are the provided ones, unchanged.
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/context/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { HelpButton } from '@/components/HelpButton';
import { SoilIcon } from '@/components/SoilIcon';
import { createZoneSoilStyles } from '@/styles/zoneSoilStyles';
import { saveZoneSoilType, type ZoneSoilType } from '@/services/agroFlowApi';

// Copy is fixed by the spec. The "how it feels" lines are the common field
// texture check (squeeze a handful and see what it does), not FAO-56 - FAO-56
// supplies the water-holding numbers, not the feel descriptions.
const SOILS: {
  key: ZoneSoilType;
  title: string;
  feel: string;
  means: string;
}[] = [
  {
    key: 'sandy',
    title: 'Sandy',
    feel: 'Gritty, falls apart when squeezed.',
    means: 'Drains fast. Needs water more often, in smaller amounts.',
  },
  {
    key: 'loam',
    title: 'Loam / garden soil',
    feel: 'Soft and crumbly, holds shape loosely.',
    means: 'Holds water well. The best all-rounder.',
  },
  {
    key: 'clay',
    title: 'Clay',
    feel: 'Sticky when wet, hard and cracked when dry.',
    means: 'Holds water a long time. Water less often, but slowly.',
  },
];

export default function ZoneSoilScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createZoneSoilStyles(colors), [colors]);

  const params = useLocalSearchParams<{ zoneId?: string; soilType?: string; zoneName?: string }>();
  const zoneId = Number(params.zoneId);

  // Loam is the default when the zone has no soil type saved yet.
  const initial = SOILS.some((s) => s.key === params.soilType)
    ? (params.soilType as ZoneSoilType)
    : 'loam';

  const [selected, setSelected] = useState<ZoneSoilType>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(() => {
    if (!Number.isFinite(zoneId)) {
      setError('This screen needs a zone. Open it from the zone page.');
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);

    saveZoneSoilType(zoneId, selected)
      .then((result) => setMessage(result.message))
      .catch((e: unknown) =>
        setError(
          e instanceof Error && e.message
            ? e.message
            : 'Could not save the soil type right now.'
        )
      )
      .finally(() => setBusy(false));
  }, [zoneId, selected]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={{ padding: 12 }}
        >
          <ArrowLeft size={22} color={colors.text} strokeWidth={1.8} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <ScreenHeader
            title="Soil type"
            subtitle={params.zoneName ? String(params.zoneName) : undefined}
          />
        </View>
        <HelpButton screen="zoneSoil" />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hint}>
          Not sure? Pick <Text style={styles.hintStrong}>Loam</Text>. It&apos;s the
          most common garden soil.
        </Text>

        {SOILS.map((soil) => {
          const isSelected = soil.key === selected;
          return (
            <Pressable
              key={soil.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${soil.title}. ${soil.feel} ${soil.means}`}
              onPress={() => setSelected(soil.key)}
              style={[styles.card, isSelected && styles.cardSelected]}
            >
              <SoilIcon kind={soil.key} size={48} />
              <View style={styles.cardBody}>
                <View style={styles.cardHeading}>
                  <Text style={styles.cardTitle}>{soil.title}</Text>
                  {isSelected ? (
                    <Check size={20} color={colors.primaryDark} strokeWidth={2.2} />
                  ) : null}
                </View>
                <Text style={styles.cardFeel}>{soil.feel}</Text>
                <Text style={styles.cardMeans}>{soil.means}</Text>
              </View>
            </Pressable>
          );
        })}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save soil type"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={save}
          style={[styles.saveButton, busy && styles.saveButtonBusy]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveButtonText}>Save soil type</Text>
          )}
        </Pressable>

        {message ? (
          <Text style={styles.message} accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Text style={styles.sourceNote}>
          How each soil holds water comes from FAO Irrigation and Drainage Paper 56,
          Table 19. The &quot;how it feels&quot; descriptions are the usual hand
          texture check, not from that paper.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
