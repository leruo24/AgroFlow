// Soil type screen. Reached as /zone-soil?zoneId=123&soilType=loam
// Soil texture decides how much water the soil holds and so how often a zone needs
// watering, so we ask instead of assuming. Three large cards in plain words, with loam
// pre-selected as the most common garden soil and the default when the farmer is not sure.
// Each card's icon is drawn by components/SoilIcon.tsx from assets/soil/soil_*.svg.
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
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/lib/router';

import { useTheme } from '@/context/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { HelpButton } from '@/components/HelpButton';
import { SoilIcon } from '@/components/SoilIcon';
import { createZoneSoilStyles } from '@/styles/zoneSoilStyles';
import { saveZoneSoilType, type ZoneSoilType } from '@/services/agroFlowApi';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { Space } from '@/constants/colors';
import { useI18n } from '@/i18n';

// The "how it feels" lines are the usual field texture check (squeeze a handful), not
// FAO-56; FAO-56 only supplies the water-holding numbers.
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
  const { t } = useI18n();
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(false);
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
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
          style={{ padding: Space.md }}
        >
          <ArrowLeft size={22} color={colors.text} strokeWidth={1.8} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <ScreenHeader
            title={t('soilScreen.title')}
            subtitle={params.zoneName ? String(params.zoneName) : undefined}
          />
        </View>
        <HelpButton screen="zoneSoil" />
      </View>

      <ScrollView accessibilityRole="radiogroup" accessibilityLabel={t('soilScreen.title')} contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
        <Text style={styles.hint}>
          {t('soilScreen.notSure')} <Text style={styles.hintStrong}>{t('soilScreen.loam')}</Text>. It&apos;s the
          most common garden soil.
        </Text>

        {SOILS.map((soil) => {
          const isSelected = soil.key === selected;
          return (
            <Pressable
              key={soil.key}
              accessibilityRole="radio" aria-checked={isSelected}
              accessibilityState={{ checked: isSelected, selected: isSelected }}
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
          accessibilityLabel={t('soilScreen.save')}
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={save}
          style={[styles.saveButton, busy && styles.saveButtonBusy]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveButtonText}>{t('soilScreen.save')}</Text>
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
