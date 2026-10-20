import { DataState } from '@/components/DataState';
import { AppAlert as Alert } from '@/components/AppAlert';
import { BlurSheet } from '@/components/BlurSheet';

// The FAO-56 engine's farmer-facing pieces and page help, shown on this screen.
import { HelpButton } from '@/components/HelpButton';
import { ZoneInsightsCard } from '@/components/ZoneInsightsCard';
import { ZoneGrowthBar } from '@/components/ZoneGrowthBar';
import { ResetRecommendedButton } from '@/components/ResetRecommendedButton';
import { SoilPhPanel } from '@/components/SoilPhPanel';
import { fetchZoneInsights, type ZoneGrowth } from '@/services/agroFlowApi';
import { useConnectivity } from '@/lib/connectivity';
import { useZoneKit } from '@/hooks/useZoneKit';
import { defaultRunMinutes, zoneMaxRunMinutes } from '@/lib/runLimit';
import { useRunStatus, type RunState } from '@/hooks/useRunStatus';
import { ApiHttpError } from '@/services/agroFlowApi';
import { t, useI18n, type TranslationKey } from '@/i18n';
import { Card } from '@/components/ui/Card';
import { InfoGrid, type InfoItem } from '@/components/ui/InfoGrid';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { cropLabel, healthLabel, modeLabel, placeLabel, sensorLabel, tidy } from '@/lib/labels';
import { dayLabel } from '@/lib/setupHelpers';
// Dynamic Expo route: one screen for every irrigation zone, by route ID.
import {
  ArrowLeft,
  ChevronRight,
} from 'lucide-react-native';

import {
  useLocalSearchParams,
} from 'expo-router';
import { router } from '@/lib/router';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import {
  useAgroFlow,
} from '@/context/AgroFlowContext';

import {
  useTheme,
} from '@/context/ThemeContext';

import {
  createZoneDetailStyles,
} from '@/styles/zoneDetailStyles';

import {
  soilReadingText,
} from '@/lib/moistureDisplay';

const SCHEDULE_DAY_OPTIONS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];


type IrrigationModeSelection =
  | 'automatic'
  | 'scheduled'
  | 'manual';

const IRRIGATION_MODE_OPTIONS: {
  label: TranslationKey;
  value: IrrigationModeSelection;
}[] = [
  {
    label: 'zone.modeAutomatic',
    value: 'automatic',
  },
  {
    label: 'zone.modeScheduled',
    value: 'scheduled',
  },
  {
    label: 'zone.modeManual',
    value: 'manual',
  },
];

const MODE_KEYS: Record<string, TranslationKey> = {
  automatic: 'zone.modeAutomatic',
  scheduled: 'zone.modeScheduled',
  manual: 'zone.modeManual',
};

const RUN_STATE_KEYS: Record<RunState, TranslationKey> = {
  sent: 'run.sent',
  started: 'run.started',
  finished: 'run.finished',
  no_response: 'run.noResponse',
  failed: 'run.failed',
};

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  console.error('Zone action failed:', error);
  return fallback;
}

export default function ZoneControlScreen() {
  const {
    id,
  } =
    useLocalSearchParams<{
      id?:
        | string
        | string[];
    }>();

  const {
    colors,
  } = useTheme();

  // Re-renders this screen in the farmer's language; t() below reads the same choice.
  useI18n();
  // No tab bar on this screen: the bottom inset + 16.
  const bottomPad = useBottomPadding(false);

  // Watering needs the kit to hear the command now, so it is off while offline (never queued).
  const { online } = useConnectivity();

  const styles =
    useMemo(
      () =>
        createZoneDetailStyles(
          colors
        ),
      [
        colors,
      ]
    );

  const {
    zones, isZonesLoading, zonesError, isFarmLoading, farmError, refreshZones, refreshFarms,
    startManualIrrigation,
    stopManualIrrigation,
    updateIrrigationMode,
    updateZoneSettings,
    updateZoneSchedule,
  } = useAgroFlow();

  const [
    selectedMode,
    setSelectedMode,
  ] =
    useState<IrrigationModeSelection>(
      'automatic'
    );

  const [
    modeSaving,
    setModeSaving,
  ] =
    useState(false);

  // The kit stops every run at 5 minutes (SAFETY_MAX_RUN_MS in the firmware), so a manual
  // run is 1 to the zone's maximum run time (5 by default; staff set it) and starts at 5, or
  // at the maximum when that is lower.
  const [
    manualDuration,
    setManualDuration,
  ] =
    useState('5');

  const [
    isEditingZone,
    setIsEditingZone,
  ] =
    useState(false);

  const [
    settingsSaving,
    setSettingsSaving,
  ] =
    useState(false);

  const [
    zoneName,
    setZoneName,
  ] =
    useState('');

  const [
    zoneLocation,
    setZoneLocation,
  ] =
    useState('');

  const [
    zoneCrop,
    setZoneCrop,
  ] =
    useState('');

  const [
    plantingDate,
    setPlantingDate,
  ] =
    useState('');

  const [
    moistureThreshold,
    setMoistureThreshold,
  ] =
    useState('30');

  const [
    desiredMoisture,
    setDesiredMoisture,
  ] =
    useState('60');

  const [
    automationEnabled,
    setAutomationEnabled,
  ] =
    useState(true);

  const [
    weatherAdjustment,
    setWeatherAdjustment,
  ] =
    useState(true);

  const [
    isEditingSchedule,
    setIsEditingSchedule,
  ] =
    useState(false);

  const [
    scheduleSettingsSaving,
    setScheduleSettingsSaving,
  ] =
    useState(false);

  const [
    regularScheduleDays,
    setRegularScheduleDays,
  ] =
    useState<string[]>([]);

  const [
    regularScheduleStartTime,
    setRegularScheduleStartTime,
  ] =
    useState('05:30');

  const [
    regularScheduleDuration,
    setRegularScheduleDuration,
  ] =
    useState('20');

  // Growth and insights for the engine components below, fetched here so one request fills
  // both ZoneInsightsCard and the growth bar.
  const [zoneGrowth, setZoneGrowth] =
    useState<ZoneGrowth | null>(null);


  const routeId =
    Array.isArray(
      id
    )
      ? id[0]
      : id;

  // Convert to string so numeric Supabase IDs match Expo Router parameters.
  const zone =
    zones.find(
      (
        item
      ) =>
        String(
          item.id
        ) ===
        String(
          routeId
        )
    );

  // Water now needs a kit that is listening (the server refuses otherwise, 409).
  const kit = useZoneKit(zone?.id);

  // The duration box never starts above this zone's maximum run time.
  const zoneMaxRun = zoneMaxRunMinutes(zone?.maxRunMinutes);
  useEffect(() => {
    setManualDuration(current => (Number(current) > zoneMaxRun ? String(defaultRunMinutes(zoneMaxRun)) : current));
  }, [zoneMaxRun]);
  const kitBlocked = kit === 'none' || kit === 'offline';

  // The last Water now from this screen, followed until the kit reports it finished.
  const [run, setRun] = useState<{ id: string; seconds: number } | null>(null);
  const runState = useRunStatus(run?.id ?? null, run?.seconds ?? 0);

  useEffect(() => {
    if (
      !zone ||
      zone.irrigation
        .override.active
    ) {
      return;
    }

    setSelectedMode(
      zone.irrigation.mode
    );
  }, [
    zone?.id,
    zone?.irrigation.mode,
    zone?.irrigation.override.active,
  ]);

  // The growth summary for the bar below. A failure is silent and shows nothing: the
  // engine's advice is extra on this screen, so it must never take the page down.
  useEffect(() => {
    const numericId =
      Number(routeId);

    if (
      !Number.isFinite(
        numericId
      ) ||
      numericId <= 0
    ) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const result =
          await fetchZoneInsights(
            numericId
          );

        if (active) {
          setZoneGrowth(
            result.growth ?? null
          );
        }
      } catch {
        if (active) {
          setZoneGrowth(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    routeId,
  ]);

  if (
    !zone
  ) {
    return (
      <SafeAreaView
        style={
          styles.safeArea
        }
      >
        <View
          style={
            styles.notFound
          }
        >
          <DataState kind={isFarmLoading || isZonesLoading ? 'loading' : farmError || zonesError ? 'error' : 'empty'}
            title={isFarmLoading || isZonesLoading ? 'Loading zone' : farmError || zonesError ? 'Unable to load zone' : 'Zone not found'}
            description={isFarmLoading || isZonesLoading ? undefined : 'Return to Irrigation to select a zone in the current farm.'}
            onRetry={farmError ? refreshFarms : zonesError ? refreshZones : undefined} />
          <TouchableOpacity
            style={
              styles.primaryButton
            }
            onPress={() =>
              router.canGoBack() ? router.back() : router.navigate('/irrigation')
            }
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft
              size={24}
              color={colors.white}
              strokeWidth={2.25}
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const selectedZone =
    zone;

  const soil =
    selectedZone
      .sensors
      .soilMoisture;

  const environment =
    selectedZone
      .sensors
      .temperatureHumidity;

  const schedule =
    selectedZone
      .irrigation
      .schedule;

  const automation =
    selectedZone
      .irrigation
      .automation;

  const override =
    selectedZone
      .irrigation
      .override;

  const isOverrideActive =
    override.active;

  // A zone has (or had) a kit when any sensor has reported; with none, every reading says so.
  const hasKit = soil.status === 'Online' || environment.status === 'Online';
  // The kit does not report its valve yet, so "Unknown" would be the only answer.
  const relayText = !hasKit ? t('empty.noKit') : selectedZone.relay.status === 'Unknown' ? t('zone.relayNotReported') : tidy(selectedZone.relay.status);
  const liveMetrics: InfoItem[] = [
    {
      label: t('zone.soilMoisture'),
      value: hasKit ? soilReadingText(soil, t('empty.noReading')) : t('empty.noKit'),
      muted: soil.status !== 'Online',
      note: soil.status !== 'Online' ? undefined
        : soil.simulated ? t('zone.simulatedReading')
        : soil.calibrated ? t(`zone.moisture.${soil.moistureStatus}` as TranslationKey)
        : t('zone.doWetDry'),
    },
    {
      label: t('irrigation.temperature'),
      value: environment.status === 'Online' ? `${environment.temperature}${environment.temperatureUnit}` : hasKit ? t('empty.noReading') : '—',
      muted: environment.status !== 'Online',
    },
    {
      label: t('zone.humidity'),
      value: environment.status === 'Online' ? `${environment.humidity}${environment.humidityUnit}` : hasKit ? t('empty.noReading') : '—',
      muted: environment.status !== 'Online',
    },
    {
      // "(est.)" matters: there is no flow meter, so this is runtime x the zone's flow_rate_lpm.
      // A bare litre figure would look like a measurement.
      label: t('irrigation.waterToday'),
      value: selectedZone.water.usedTodayLitres != null ? `${selectedZone.water.usedTodayLitres} L (est.)` : t('empty.noWaterToday'),
      muted: selectedZone.water.usedTodayLitres == null,
    },
    {
      label: t('zone.waterSaved'),
      value: selectedZone.waterSavedLitres != null ? `${selectedZone.waterSavedLitres} L (est.)` : t('empty.noWatering'),
      muted: selectedZone.waterSavedLitres == null,
    },
    {
      label: t('irrigation.lastWatering'),
      value: /^\d{4}-\d{2}-\d{2}$/.test(selectedZone.irrigation.lastIrrigation.date) ? dayLabel(selectedZone.irrigation.lastIrrigation.date) : t('empty.noWatering'),
      muted: !/^\d{4}/.test(selectedZone.irrigation.lastIrrigation.date),
    },
  ];

  // The saved mode (Manual included); a one-off Water now run does not change it.
  const displayedBaseMode =
    selectedMode;

  const zoneSummaryRows = [
    [
      {
        label: 'Zone',
        value: selectedZone.name,
      },
      {
        label: 'Location',
        value: placeLabel(selectedZone.location) || t('empty.notSet'),
      },
    ],
    [
      {
        label: 'Crop',
        value: cropLabel(t, selectedZone.crop),
      },
      {
        label: 'Start At',
        value: `${automation.moistureThreshold}%`,
      },
    ],
    [
      {
        label: 'Stop At',
        value: `${automation.desiredMoisture}%`,
      },
      {
        label: 'Base Mode',
        value: modeLabel(t, displayedBaseMode),
      },
    ],
  ];

  const scheduleWeatherRows = [
    [
      {
        label: 'Start Time',
        value: schedule.startTime || t('empty.notSet'),
      },
      {
        label: 'Days',
        value: schedule.days.length ? schedule.days.join(' ') : t('empty.notSet'),
      },
      {
        label: 'Duration',
        value: schedule.durationMinutes > 0 ? `${schedule.durationMinutes} min` : t('empty.notSet'),
      },
    ],
    [
      {
        label: 'Forecast',
        value: selectedZone.weather.rainExpected ? 'Rain' : 'Clear',
      },
      {
        label: 'Rain',
        value: selectedZone.weather.rainExpected ? 'Yes' : 'No',
      },
      {
        label: 'Adjustment',
        value: automation.weatherAdjustment ? 'Enabled' : 'Disabled',
      },
    ],
  ];

  const systemStatusItems = [
    {
      label: 'Soil Sensor',
      value: hasKit ? sensorLabel(t, soil.status) : t('empty.noKit'),
    },
    {
      label: 'Temp/Humidity',
      value: hasKit ? sensorLabel(t, environment.status) : t('empty.noKit'),
    },
    {
      label: 'Relay',
      value: relayText,
    },
  ];

  async function handleModeChange(
    mode: IrrigationModeSelection
  ) {
    if (
      isOverrideActive ||
      modeSaving
    ) {
      return;
    }

    // Manual is a saved mode like the other two (AgroFlow then never waters this zone by
    // itself). It used to be a preview that was never saved, and a zone saved as manual
    // elsewhere read back as Automatic.
    if (
      mode ===
      selectedZone.irrigation.mode
    ) {
      setSelectedMode(
        mode
      );

      return;
    }

    setModeSaving(
      true
    );

    try {
      await updateIrrigationMode(
        selectedZone.id,
        mode
      );

      setSelectedMode(
        mode
      );
    } catch (
      error: unknown
    ) {
      Alert.alert(
        'Could Not Change Mode',
        getErrorMessage(
          error,
          'Check your connection and Supabase permissions, then try again.'
        )
      );
    } finally {
      setModeSaving(
        false
      );
    }
  }

  function handleStartManualRun() {
    const duration =
      Number(
        manualDuration
      );

    if (
      !Number.isFinite(
        duration
      ) ||
      duration <
        1 ||
      duration >
        zoneMaxRunMinutes(selectedZone.maxRunMinutes)
    ) {
      Alert.alert(
        t('zone.invalidDurationTitle'),
        t('zone.invalidDuration', { max: zoneMaxRunMinutes(selectedZone.maxRunMinutes) })
      );

      return;
    }

    Alert.alert(
      t('zone.startConfirmTitle', { zone: selectedZone.name }),
      t('zone.startConfirmBody', { minutes: duration }),
      [
        {
          text:
            t('common.cancel'),
          style:
            'cancel',
        },
        {
          text:
            t('zone.start'),
          onPress: async () => {
            try {
              const commandId = await startManualIrrigation(
                selectedZone.id,
                duration
              );
              if (commandId) setRun({ id: commandId, seconds: duration * 60 });
            } catch (error: unknown) {
              Alert.alert(
                t('zone.startFailed'),
                startErrorText(error)
              );
            }
          },
        },
      ]
    );
  }

  // The server's refusals in the farmer's language: 409 is "no kit connected" (none, or not
  // heard from), 400 says why the run was refused (for example longer than 5 minutes).
  function startErrorText(error: unknown) {
    if (error instanceof Error && error.message === t('offline.needsConnection')) return error.message;
    if (error instanceof ApiHttpError && error.status === 409) {
      return error.message.startsWith('No kit connected to this zone:') ? t('zone.kitOffline') : t('zone.noKit');
    }
    if (error instanceof ApiHttpError && error.status === 400) return error.message;
    return getErrorMessage(error, t('zone.commandFailed'));
  }

  function handleStopManualRun() {
    Alert.alert(
      t('zone.stopConfirmTitle', { zone: selectedZone.name }),
      t('zone.stopConfirmBody', { mode: t(MODE_KEYS[selectedZone.irrigation.mode] ?? 'zone.modeAutomatic').toLowerCase() }),
      [
        {
          text:
            t('common.cancel'),
          style:
            'cancel',
        },
        {
          text:
            t('zone.stop'),
          style:
            'destructive',
          onPress: async () => {
            try {
              await stopManualIrrigation(
                selectedZone.id
              );
            } catch (error: unknown) {
              Alert.alert(
                t('zone.stopFailed'),
                error instanceof Error && error.message === t('offline.needsConnection')
                  ? error.message
                  : getErrorMessage(error, t('zone.commandFailed'))
              );
            }
          },
        },
      ]
    );
  }

  function openScheduleEditor() {
    beginScheduleEditing();
  }

  function beginZoneEditing() {
    setZoneName(
      selectedZone.name
    );

    setZoneLocation(
      selectedZone.location ===
      'Not configured'
        ? ''
        : selectedZone.location
    );

    setZoneCrop(
      selectedZone.crop ===
      'Not configured'
        ? ''
        : selectedZone.crop
    );

    setPlantingDate(
      selectedZone.plantingDate ?? ''
    );

    setMoistureThreshold(
      String(
        automation.moistureThreshold
      )
    );

    setDesiredMoisture(
      String(
        automation.desiredMoisture
      )
    );

    setAutomationEnabled(
      automation.enabled
    );

    setWeatherAdjustment(
      automation.weatherAdjustment
    );

    setIsEditingZone(
      true
    );
  }

  function cancelZoneEditing() {
    setIsEditingZone(
      false
    );
  }

  async function saveZoneSettings() {
    const cleanedName =
      zoneName.trim();

    const cleanedLocation =
      zoneLocation.trim();

    const cleanedCrop =
      zoneCrop.trim();

    const cleanedPlantingDate =
      plantingDate.trim();

    const startThreshold =
      Number(
        moistureThreshold
      );

    const stopThreshold =
      Number(
        desiredMoisture
      );

    if (
      !cleanedName ||
      !cleanedLocation ||
      !cleanedCrop ||
      !cleanedPlantingDate
    ) {
      Alert.alert(
        'Missing Zone Details',
        'Enter a zone name, location, and crop type.'
      );

      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanedPlantingDate)) {
      Alert.alert(
        'Invalid Planting Date',
        'Enter the planting date in YYYY-MM-DD format.'
      );

      return;
    }

    const plantingDateValue =
      new Date(`${cleanedPlantingDate}T00:00:00`);

    const todayValue = new Date();

    const today =
      `${todayValue.getFullYear()}-${String(
        todayValue.getMonth() + 1
      ).padStart(2, '0')}-${String(
        todayValue.getDate()
      ).padStart(2, '0')}`;

    const isRealDate =
      plantingDateValue.getFullYear() ===
        Number(cleanedPlantingDate.slice(0, 4)) &&
      plantingDateValue.getMonth() + 1 ===
        Number(cleanedPlantingDate.slice(5, 7)) &&
      plantingDateValue.getDate() ===
        Number(cleanedPlantingDate.slice(8, 10));

    if (!isRealDate || cleanedPlantingDate > today) {
      Alert.alert(
        'Invalid Planting Date',
        'Planting date must be a valid date that is not in the future.'
      );

      return;
    }

    if (
      !Number.isFinite(
        startThreshold
      ) ||
      startThreshold <
        0 ||
      startThreshold >
        100 ||
      !Number.isFinite(
        stopThreshold
      ) ||
      stopThreshold <
        0 ||
      stopThreshold >
        100
    ) {
      Alert.alert(
        'Invalid Moisture Values',
        'Moisture values must be between 0 and 100.'
      );

      return;
    }

    if (
      startThreshold >=
      stopThreshold
    ) {
      Alert.alert(
        'Invalid Automation Range',
        'The start threshold must be lower than the desired moisture level.'
      );

      return;
    }

    setSettingsSaving(
      true
    );

    try {
      await updateZoneSettings(
        selectedZone.id,
        {
          name:
            cleanedName,
          location:
            cleanedLocation,
          crop:
            cleanedCrop,
          plantingDate:
            cleanedPlantingDate,
          moistureThreshold:
            startThreshold,
          desiredMoisture:
            stopThreshold,
          automationEnabled,
          weatherAdjustment,
        }
      );

      setIsEditingZone(
        false
      );

      Alert.alert(
        'Zone Updated',
        'The zone settings were saved to Supabase.'
      );
    } catch (
      error: unknown
    ) {
      console.error(
        'Failed to update zone:',
        error
      );

      Alert.alert(
        'Could Not Update Zone',
        getErrorMessage(
          error,
          'Check your connection and Supabase permissions, then try again.'
        )
      );
    } finally {
      setSettingsSaving(
        false
      );
    }
  }

  function beginScheduleEditing() {
    setRegularScheduleDays([
      ...schedule.days,
    ]);

    setRegularScheduleStartTime(
      schedule.startTime
    );

    setRegularScheduleDuration(
      String(
        schedule.durationMinutes
      )
    );

    setIsEditingSchedule(
      true
    );
  }

  function cancelScheduleEditing() {
    setIsEditingSchedule(
      false
    );
  }

  function toggleRegularScheduleDay(
    day: string
  ) {
    setRegularScheduleDays(
      (
        current
      ) =>
        current.includes(
          day
        )
          ? current.filter(
              (
                item
              ) =>
                item !==
                day
            )
          : [
              ...current,
              day,
            ]
    );
  }

  async function saveRegularSchedule() {
    const cleanedStartTime =
      regularScheduleStartTime.trim();

    const duration =
      Number(
        regularScheduleDuration
      );

    const orderedDays =
      SCHEDULE_DAY_OPTIONS.filter(
        (
          day
        ) =>
          regularScheduleDays.includes(
            day
          )
      );

    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(
        cleanedStartTime
      )
    ) {
      Alert.alert(
        'Invalid Start Time',
        'Enter the time as HH:MM, for example 05:30.'
      );

      return;
    }

    if (
      orderedDays.length ===
      0
    ) {
      Alert.alert(
        'Choose Irrigation Days',
        'Select at least one irrigation day.'
      );

      return;
    }

    if (
      !Number.isFinite(
        duration
      ) ||
      duration <
        1 ||
      duration >
        1440
    ) {
      Alert.alert(
        'Invalid Duration',
        'Enter a duration between 1 and 1440 minutes.'
      );

      return;
    }

    setScheduleSettingsSaving(
      true
    );

    try {
      await updateZoneSchedule(
        selectedZone.id,
        {
          enabled:
            displayedBaseMode ===
            'scheduled',
          days:
            orderedDays,
          startTime:
            cleanedStartTime,
          durationMinutes:
            duration,
        }
      );

      setIsEditingSchedule(
        false
      );

      Alert.alert(
        'Schedule Updated',
        'The regular irrigation schedule was saved to Supabase.'
      );
    } catch (
      error: unknown
    ) {
      console.error(
        'Failed to update schedule:',
        error
      );

      Alert.alert(
        'Could Not Update Schedule',
        getErrorMessage(
          error,
          'Check your connection and Supabase permissions, then try again.'
        )
      );
    } finally {
      setScheduleSettingsSaving(
        false
      );
    }
  }

  return (
    <SafeAreaView
      style={
        styles.safeArea
      }
      edges={[
        'top',
      ]}
    >
      <ScrollView
        style={
          styles.page
        }
        showsVerticalScrollIndicator={
          false
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomPad },
        ]}
      >
      <View
        style={
          styles.topBar
        }
      >
        <View
          style={
            styles.topBarContent
          }
        >
          <TouchableOpacity
            style={
              styles.backButton
            }
            onPress={() =>
              router.canGoBack() ? router.back() : router.navigate('/irrigation')
            }
            activeOpacity={
              0.7
            }
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft
              size={24}
              color={colors.text}
              strokeWidth={2.25}
            />
          </TouchableOpacity>

          <View
            style={
              styles.titleBlock
            }
          >
            <Text
              style={
                styles.zoneName
              }
              numberOfLines={
                2
              }
            >
              {
                selectedZone.name
              }
            </Text>

            <Text
              style={
                styles.zoneSubtitle
              }
              numberOfLines={
                2
              }
            >
              {[placeLabel(selectedZone.location), cropLabel(t, selectedZone.crop), selectedZone.size.value ? `${selectedZone.size.value} ${selectedZone.size.unit}` : ''].filter(Boolean).join(' · ')}
            </Text>
          </View>

          {/* Page help, in the same place every other screen puts it -
              beside the header's trailing element. It disappears entirely
              when the farmer turns page help off in Settings. */}
          <HelpButton screen="zoneDetail" />

          {selectedZone.isSimulated && (
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>SIMULATED</Text>
            </View>
          )}

          <View
            style={
              styles.statusBadge
            }
          >
            <Text
              style={
                styles.statusBadgeText
              }
            >
              {tidy(selectedZone.irrigation.status)}
            </Text>
          </View>
        </View>
      </View>

        <View
          style={
            styles.content
          }
        >
          <View
            style={
              styles.sectionHeading
            }
          >
            <Text
              style={
                styles.sectionTitle
              }
            >
              {t('zone.liveTitle')}
            </Text>

            <Text
              style={
                styles.sectionCaption
              }
            >
              {t('zone.liveCaption')}
            </Text>
          </View>

          <Card testID="zone-live">
            <InfoGrid items={liveMetrics} />
          </Card>

          {/* ------------------------------------------------------------
              THE ENGINE'S FARMER-FACING SURFACE

              Placed straight after the live readings, because the readings
              say what is happening and these say what to do about it - which
              is the order the screen is read in. Each piece renders nothing
              when its data is missing, so a zone with no crop, no planting
              date or no calibration shows exactly what it did before.
              ------------------------------------------------------------ */}

          <ZoneGrowthBar
            stage={zoneGrowth?.stage}
            dayOfSeason={zoneGrowth?.dayOfSeason}
            totalDays={zoneGrowth?.totalDays}
            cropLabel={zoneGrowth?.cropLabel}
          />

          <ZoneInsightsCard
            zoneId={Number(
              selectedZone.id
            )}
          />

          {/* Kit, soil and setup rows */}
          {/* Three navigation/action rows rather than three cards: each is
              a door to somewhere else, and a farmer scanning this screen
              should be able to tell them apart from the readings above at a
              glance. */}

          <TouchableOpacity
            style={
              styles.linkRow
            }
            onPress={() =>
              router.push({
                pathname: '/zone-hardware',
                params: {
                  zoneId: String(
                    selectedZone.id
                  ),
                  zoneName:
                    selectedZone.name,
                },
              })
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Your kit"
          >
            <View
              style={
                styles.linkRowCopy
              }
            >
              <Text
                style={
                  styles.linkRowTitle
                }
              >
                Your kit
              </Text>

              <Text
                style={
                  styles.linkRowHint
                }
              >
                Is it working, and change its WiFi
              </Text>
            </View>

            <ChevronRight
              size={20}
              color={colors.textMuted}
              strokeWidth={2}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.linkRow
            }
            onPress={() =>
              router.push({
                pathname: '/forecast',
                params: {
                  zoneId: String(
                    selectedZone.id
                  ),
                  zoneName:
                    selectedZone.name,
                },
              })
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="The week ahead"
          >
            <View
              style={
                styles.linkRowCopy
              }
            >
              <Text
                style={
                  styles.linkRowTitle
                }
              >
                The week ahead
              </Text>

              <Text
                style={
                  styles.linkRowHint
                }
              >
                Weather and watering advice for 7 days
              </Text>
            </View>

            <ChevronRight
              size={20}
              color={colors.textMuted}
              strokeWidth={2}
            />
          </TouchableOpacity>

          {/* The farmer changes the crop and planting date. */}
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() =>
              router.push({
                pathname: '/zone-crop',
                params: {
                  zoneId: String(selectedZone.id),
                  cropType: selectedZone.crop,
                  plantingDate: selectedZone.plantingDate ?? '',
                },
              })
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Crop and planting date"
          >
            <View style={styles.linkRowCopy}>
              <Text style={styles.linkRowTitle}>Crop and planting date</Text>
              <Text style={styles.linkRowHint}>What is growing, and since when</Text>
            </View>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>

          {/* The checklist of what this zone's advice is missing. */}
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() =>
              // One setup flow for the whole farm (app/setup.tsx), resumed where it was left.
              router.push('/setup' as never)
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Finish setup"
          >
            <View style={styles.linkRowCopy}>
              <Text style={styles.linkRowTitle}>Finish setup</Text>
              <Text style={styles.linkRowHint}>Planting date, size, flow rate - for surer advice</Text>
            </View>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.linkRow
            }
            onPress={() =>
              router.push({
                pathname: '/zone-soil',
                params: {
                  zoneId: String(
                    selectedZone.id
                  ),
                },
              })
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Soil type"
          >
            <View
              style={
                styles.linkRowCopy
              }
            >
              <Text
                style={
                  styles.linkRowTitle
                }
              >
                Soil type
              </Text>

              <Text
                style={
                  styles.linkRowHint
                }
              >
                How much water your soil holds
              </Text>
            </View>

            <ChevronRight
              size={20}
              color={colors.textMuted}
              strokeWidth={2}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.linkRow
            }
            onPress={() =>
              // The wet/dry setup now lives in the setup wizard's soil step.
              router.push('/setup?step=soil' as never)
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Teach the sensor your soil"
          >
            <View
              style={
                styles.linkRowCopy
              }
            >
              <Text
                style={
                  styles.linkRowTitle
                }
              >
                Teach the sensor your soil
              </Text>

              <Text
                style={
                  styles.linkRowHint
                }
              >
                Save a wet and a dry reading
              </Text>
            </View>

            <ChevronRight
              size={20}
              color={colors.textMuted}
              strokeWidth={2}
            />
          </TouchableOpacity>

          <SoilPhPanel zoneId={Number(selectedZone.id)} />

          <ResetRecommendedButton
            zoneId={Number(
              selectedZone.id
            )}
          />

          <View
            style={
              styles.panel
            }
          >
            <View
              style={
                styles.panelHeader
              }
            >
              <Text
                style={
                  styles.panelTitle
                }
              >
                {t('zone.irrigationControl')}
              </Text>

              <Text
                style={
                  styles.panelStatus
                }
              >
                {isOverrideActive
                  ? t('zone.manualCommandSent')
                  : selectedMode === 'manual'
                    ? t('zone.modeManual')
                    : displayedBaseMode === 'automatic'
                    ? t('zone.modeAutomatic')
                    : t('zone.modeScheduled')}
              </Text>
            </View>

            <View
              style={
                styles.controlSummary
              }
            >
              <View
                style={
                  styles.controlSummaryItem
                }
              >
                <Text
                  style={
                    styles.controlLabel
                  }
                >
                  {t('zone.mode')}
                </Text>

                <Text
                  style={
                    styles.controlValue
                  }
                >
                  {isOverrideActive
                    ? t('zone.manualRequest')
                    : selectedMode === 'manual'
                      ? t('zone.modeManual')
                      : displayedBaseMode === 'automatic'
                      ? t('zone.modeAutomatic')
                      : t('zone.modeScheduled')}
                </Text>
              </View>

              <View
                style={
                  styles.controlSummaryItem
                }
              >
                <Text
                  style={
                    styles.controlLabel
                  }
                >
                  {t('zone.relay')}
                </Text>

                <Text
                  style={
                    styles.controlValue
                  }
                >
                  {relayText}
                </Text>
              </View>

              <View
                style={
                  styles.controlSummaryItem
                }
              >
                <Text
                  style={
                    styles.controlLabel
                  }
                >
                  {t('zone.health')}
                </Text>

                <Text
                  style={
                    styles.controlValue
                  }
                  numberOfLines={
                    1
                  }
                >
                  {healthLabel(t, selectedZone.healthStatus)}
                </Text>
              </View>
            </View>

            <View
              style={
                styles.controlActions
              }
            >
              <Text style={styles.modeSelectorLabel}>
                {t('zone.irrigationMode')}
              </Text>

              <View style={styles.modeSelector}>
                {IRRIGATION_MODE_OPTIONS.map(
                  (
                    option
                  ) => {
                    const isSelected =
                      selectedMode ===
                      option.value;

                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.modeButton,
                          isSelected &&
                            styles.modeButtonSelected,
                        ]}
                        disabled={
                          modeSaving ||
                          isOverrideActive
                        }
                        onPress={() =>
                          handleModeChange(
                            option.value
                          )
                        }
                        accessibilityRole="button"
                        accessibilityState={{
                          selected:
                            isSelected,
                        }}
                      >
                        <Text
                          style={[
                            styles.modeButtonText,
                            isSelected &&
                              styles.modeButtonTextSelected,
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.85}
                        >
                          {t(option.label)}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                )}
              </View>

              {/* A one-off run is possible in every mode; it does not change the mode, and
                  the server holds automatic commands back for 30 minutes after it. */}
              <>
                  {!isOverrideActive && (
                    <>
                      <Text style={styles.inputLabel}>
                        {t('zone.duration')}
                      </Text>

                      <TextInput
                        value={manualDuration}
                        onChangeText={setManualDuration}
                        placeholder="5"
                        placeholderTextColor={colors.text}
                        keyboardType="number-pad"
                        maxLength={4}
                        style={styles.input}
                      />
                    </>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      isOverrideActive &&
                        styles.stopButton,
                      (!online || (kitBlocked && !isOverrideActive)) && styles.primaryButtonDisabled,
                    ]}
                    disabled={!online || (kitBlocked && !isOverrideActive)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !online || (kitBlocked && !isOverrideActive) }}
                    accessibilityHint={!online ? t('offline.needsConnection') : kitBlocked && !isOverrideActive ? t(kit === 'none' ? 'zone.noKit' : 'zone.kitOffline') : undefined}
                    testID="irrigate-button"
                    onPress={
                      isOverrideActive
                        ? handleStopManualRun
                        : handleStartManualRun
                    }
                  >
                    <Text style={styles.primaryButtonText}>
                      {isOverrideActive
                        ? t('zone.stopRun')
                        : t('zone.startRun')}
                    </Text>
                  </TouchableOpacity>
                  {!online ? (
                    <Text style={styles.offlineNote} accessibilityLiveRegion="polite">
                      {t('offline.needsConnection')}
                    </Text>
                  ) : null}
                  {runState ? (
                    <Text
                      style={[styles.offlineNote, runState === 'finished' && { color: colors.success }]}
                      accessibilityLiveRegion="polite"
                      testID="run-status"
                    >
                      {t(RUN_STATE_KEYS[runState])}
                    </Text>
                  ) : null}
                  {online && kitBlocked && !isOverrideActive ? (
                    <Text style={styles.offlineNote} accessibilityLiveRegion="polite" testID="irrigate-no-kit">
                      {t(kit === 'none' ? 'zone.noKit' : 'zone.kitOffline')}
                    </Text>
                  ) : null}
              </>

              {selectedMode === 'manual' ? (
                <Text style={styles.inputLabel}>
                  {t('zone.manualNote')}
                </Text>
              ) : selectedMode ===
                'scheduled' ? (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={openScheduleEditor}
                >
                  <Text style={styles.secondaryButtonText}>
                    {t('zone.editSchedule')}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={beginZoneEditing}
                >
                  <Text style={styles.secondaryButtonText}>
                    {t('zone.editThresholds')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View
            style={
              styles.panel
            }
          >
            <View
              style={
                styles.panelHeader
              }
            >
              <Text
                style={
                  styles.panelTitle
                }
              >
                Zone &amp; Automation
              </Text>

              <TouchableOpacity
                style={styles.textAction}
                onPress={beginZoneEditing}
                accessibilityRole="button"
                accessibilityLabel="Edit zone and automation"
              >
                <Text style={styles.textActionLabel}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.detailRows}>
              {zoneSummaryRows.flat().map((item) => (
                <View key={item.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Schedule &amp; Weather</Text>
              <View style={styles.headerActions}>
                <Text style={styles.panelStatus}>
                  {displayedBaseMode === 'scheduled'
                    ? 'Active'
                    : 'Saved'}
                </Text>

                <TouchableOpacity
                  style={styles.textAction}
                  onPress={beginScheduleEditing}
                  accessibilityRole="button"
                  accessibilityLabel="Edit regular irrigation schedule"
                >
                  <Text style={styles.textActionLabel}>Edit</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.detailRows}>
              {scheduleWeatherRows.flat().map((item) => (
                <View key={item.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>System Status</Text>
            </View>

            <View style={styles.detailRows}>
              {systemStatusItems.map((item) => (
                <View key={item.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          {selectedZone.alerts.length > 0 && (
            <View style={[styles.panel, styles.alertPanel]}>
              <View style={styles.alertHeader}>
                <Text style={styles.panelTitle}>Zone Alerts</Text>

                <View style={styles.alertCountBadge}>
                  <Text style={styles.alertCountText}>
                    {selectedZone.alerts.length}
                  </Text>
                </View>
              </View>

              {selectedZone.alerts.map((zoneAlert, index) => (
                <View
                  key={zoneAlert.id}
                  style={[
                    styles.alertRow,
                    index === selectedZone.alerts.length - 1 &&
                      styles.alertRowLast,
                  ]}
                >
                  <Text style={styles.alertType}>
                    {zoneAlert.type === 'warning'
                      ? 'ATTENTION'
                      : zoneAlert.type.toUpperCase()}
                  </Text>

                  <Text style={styles.alertMessage}>
                    {zoneAlert.message}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <BlurSheet visible={isEditingZone} onClose={() => { if (!settingsSaving) cancelZoneEditing(); }} title="Edit Zone & Automation">
              <View
                style={
                  styles.inlineForm
                }
              >
                <Text style={styles.inputLabel}>Zone Name</Text>
                <TextInput
                  value={zoneName}
                  onChangeText={setZoneName}
                  editable={!settingsSaving}
                  placeholder="Zone 1"
                  placeholderTextColor={colors.text}
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>Location</Text>
                <TextInput
                  value={zoneLocation}
                  onChangeText={setZoneLocation}
                  editable={!settingsSaving}
                  placeholder="North Field"
                  placeholderTextColor={colors.text}
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>Crop Type</Text>
                <TextInput
                  value={zoneCrop}
                  onChangeText={setZoneCrop}
                  editable={!settingsSaving}
                  placeholder="Tomatoes"
                  placeholderTextColor={colors.text}
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>Planting Date</Text>
                <TextInput
                  value={plantingDate}
                  onChangeText={setPlantingDate}
                  editable={!settingsSaving}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.text}
                  style={styles.input}
                  maxLength={10}
                  autoCapitalize="none"
                />

                <View style={styles.inputRow}>
                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>Start At (%)</Text>
                    <TextInput
                      value={moistureThreshold}
                      onChangeText={setMoistureThreshold}
                      editable={!settingsSaving}
                      keyboardType="decimal-pad"
                      placeholder="30"
                      placeholderTextColor={colors.text}
                      style={styles.input}
                    />
                  </View>

                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>Stop At (%)</Text>
                    <TextInput
                      value={desiredMoisture}
                      onChangeText={setDesiredMoisture}
                      editable={!settingsSaving}
                      keyboardType="decimal-pad"
                      placeholder="60"
                      placeholderTextColor={colors.text}
                      style={styles.input}
                    />
                  </View>
                </View>

                <View style={styles.switchRow}>
                  <View style={styles.switchCopy}>
                    <Text style={styles.switchTitle}>Weather Adjustment</Text>
                    <Text style={styles.switchDescription}>
                      Delay automatic irrigation when rain is expected.
                    </Text>
                  </View>
                  <Switch
                    value={weatherAdjustment}
                    onValueChange={setWeatherAdjustment}
                    disabled={settingsSaving}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.white}
                  />
                </View>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    settingsSaving && styles.disabledButton,
                  ]}
                  disabled={settingsSaving}
                  onPress={saveZoneSettings}
                >
                  <Text style={styles.primaryButtonText}>
                    {settingsSaving ? 'Saving...' : 'Save Changes'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.outlineButton}
                  disabled={settingsSaving}
                  onPress={cancelZoneEditing}
                >
                  <Text style={styles.outlineButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
      </BlurSheet>
      <BlurSheet visible={isEditingSchedule} onClose={() => { if (!scheduleSettingsSaving) cancelScheduleEditing(); }} title="Edit Schedule">
              <View style={styles.inlineForm}>
                <Text style={styles.inputLabel}>Irrigation Days</Text>

                <View style={styles.scheduleDayRow}>
                  {SCHEDULE_DAY_OPTIONS.map((day) => {
                    const isSelected =
                      regularScheduleDays.includes(day);

                    return (
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.scheduleDayButton,
                          isSelected && styles.scheduleDayButtonSelected,
                        ]}
                        onPress={() => toggleRegularScheduleDay(day)}
                        disabled={scheduleSettingsSaving}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text
                          style={[
                            styles.scheduleDayText,
                            isSelected && styles.scheduleDayTextSelected,
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.8}
                        >
                          {day}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.inputRow}>
                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>Start Time</Text>
                    <TextInput
                      style={styles.input}
                      value={regularScheduleStartTime}
                      onChangeText={setRegularScheduleStartTime}
                      placeholder="05:30"
                      placeholderTextColor={colors.text}
                      autoCapitalize="none"
                      maxLength={5}
                      editable={!scheduleSettingsSaving}
                    />
                  </View>

                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>Duration (minutes)</Text>
                    <TextInput
                      style={styles.input}
                      value={regularScheduleDuration}
                      onChangeText={setRegularScheduleDuration}
                      placeholder="20"
                      placeholderTextColor={colors.text}
                      keyboardType="number-pad"
                      maxLength={4}
                      editable={!scheduleSettingsSaving}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    scheduleSettingsSaving && styles.disabledButton,
                  ]}
                  disabled={scheduleSettingsSaving}
                  onPress={saveRegularSchedule}
                >
                  <Text style={styles.primaryButtonText}>
                    {scheduleSettingsSaving ? 'Saving...' : 'Save Schedule'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.outlineButton}
                  disabled={scheduleSettingsSaving}
                  onPress={cancelScheduleEditing}
                >
                  <Text style={styles.outlineButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
      </BlurSheet>

    </SafeAreaView>
  );
}

